import { Checkpoint, jobKey, type Job } from './store.ts';
import { entityIds, type WdEntity } from './transform.ts';
export interface Transport { json(url: string): Promise<unknown> }
const PAGE = 100;
export function relatedJobs(job: Extract<Job, { kind: 'entity' }>, entity: WdEntity): Job[] {
  if (job.role === 'player') return entityIds(entity, 'P54').map(id => ({ kind: 'entity', id, role: 'team' }));
  if (job.role === 'team') return [...new Set([...entityIds(entity, 'P17'), ...entityIds(entity, 'P1532')])].map(id => ({ kind: 'entity', id, role: 'country' }));
  return [];
}
export function discoveryJobs(): Job[] {
  // Q-ID prefixes partition large scans. No nationality, birth/death or current-career restriction.
  return (['players', 'clubs', 'national'] as const).flatMap(scope => Array.from({ length: 9 }, (_, i): Job => ({ kind: 'discover', scope, prefix: `Q${i + 1}`, after: '' })));
}
export function queryFor(job: Exclude<Job, { kind: 'entity' }>): string {
  if (job.after && !/^Q\d+$/.test(job.after)) throw new Error('Invalid cursor');
  if (job.kind === 'members' && !/^Q\d+$/.test(job.id)) throw new Error('Invalid team ID');
  const pattern = job.kind === 'members' ? `?item wdt:P31 wd:Q5; p:P54/ps:P54 wd:${job.id} .`
    : job.scope === 'players' ? '?item wdt:P31 wd:Q5; wdt:P106/wdt:P279* wd:Q937857 .'
    : `?item wdt:P31/wdt:P279* wd:${job.scope === 'clubs' ? 'Q476028' : 'Q6979593'} .`;
  if (job.kind === 'discover' && !/^Q[1-9]$/.test(job.prefix)) throw new Error('Invalid partition');
  return `PREFIX wd: <http://www.wikidata.org/entity/> PREFIX wdt: <http://www.wikidata.org/prop/direct/> PREFIX p: <http://www.wikidata.org/prop/> PREFIX ps: <http://www.wikidata.org/prop/statement/>
SELECT DISTINCT ?item WHERE { ${pattern}
${job.kind === 'discover' ? `FILTER(STRSTARTS(STR(?item), "http://www.wikidata.org/entity/${job.prefix}"))` : ''}
${job.after ? `FILTER(STR(?item) > "http://www.wikidata.org/entity/${job.after}")` : ''}
} ORDER BY STR(?item) LIMIT ${PAGE}`;
}
export async function processJob(store: Checkpoint, transport: Transport, job: Job) {
  if (job.kind === 'entity') {
    if (!/^Q\d+$/.test(job.id)) throw new Error('Invalid entity ID');
    let entity = store.entity(job.id);
    if (!entity) {
      const raw = await transport.json(`https://www.wikidata.org/wiki/Special:EntityData/${job.id}.json`);
      entity = (raw as { entities?: Record<string, WdEntity> })?.entities?.[job.id];
      if (!entity || entity.id !== job.id || !entity.claims || !Number.isSafeInteger(entity.lastrevid)) throw new Error(`Invalid or missing entity: ${job.id}`);
    }
    store.commit(job, relatedJobs(job, entity), entity);
  } else {
    const raw = await transport.json(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(queryFor(job))}`);
    const rows = (raw as { results?: { bindings?: { item?: { value?: string } }[] } })?.results?.bindings;
    if (!Array.isArray(rows)) throw new Error('Malformed SPARQL result; not an empty successful page');
    const ids = rows.map(row => {
      const match = /^https?:\/\/www.wikidata.org\/entity\/(Q\d+)$/.exec(row.item?.value ?? '');
      if (!match) throw new Error('Invalid SPARQL entity'); return match[1];
    });
    if (ids.length > PAGE || ids.some((id, i) => id <= job.after || (i > 0 && id <= ids[i - 1]))) throw new Error('Non-monotonic or duplicate page');
    const next: Job[] = [];
    for (const id of ids) {
      const role = job.kind === 'members' || job.scope === 'players' ? 'player' : 'team';
      next.push({ kind: 'entity', id, role });
    }
    if (ids.length === PAGE) next.push({ ...job, after: ids.at(-1)! });
    store.commit(job, next);
  }
}
export async function collect(store: Checkpoint, transport: Transport, maxTasks: number, signal?: AbortSignal, concurrency = 1, schedule: 'references' | 'members' | 'balanced' = 'references') {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 3) throw new Error('concurrency must be 1..3');
  const attempted = new Set<string>(); let failed = 0;
  const worker = async () => {
    while (!signal?.aborted && attempted.size < maxTasks) {
      const job = store.next(attempted, schedule);
      if (!job) break;
      attempted.add(jobKey(job));
      try { await processJob(store, transport, job); }
      catch (error) { if (signal?.aborted) break; store.failed(job, error); failed++; }
      if (attempted.size % 25 === 0) console.log(JSON.stringify({ progress: store.stats(), attempted: attempted.size }));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, maxTasks) }, worker));
  return { attempted: attempted.size, runFailures: failed, ...store.stats() };
}

