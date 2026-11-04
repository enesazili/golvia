import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Checkpoint, type Job } from './wikidata/store.ts';
import { collect } from './wikidata/collector.ts';
import { WikidataClient } from './wikidata/client.ts';
import { transform } from './wikidata/transform.ts';
import { atomicJson, preserveLegacy } from './wikidata/files.ts';
import { validateDataset } from '../src/server/football/importer.ts';
import { prepareTop100, reuseCachedJobs, top100Progress, validateTop100Catalog } from './wikidata/top100.ts';

export async function main(args = process.argv.slice(2)) {
  const flag = (name: string, fallback: string) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] ?? fallback : fallback; };
  const mode = flag('mode', 'legacy');
  if (!['legacy', 'top100'].includes(mode)) throw new Error('mode must be legacy or top100');
  const top100 = mode === 'top100';
  const out = resolve(flag('out', top100 ? 'data/football-top100-a.json' : 'data/football-wikidata.json'));
  const dbPath = resolve(flag('checkpoint', top100 ? 'data/.wikidata-top100-a.sqlite' : 'data/.wikidata-state.sqlite'));
  const seedPath = resolve('data/football.seed.json');
  const samePath = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (samePath(out, seedPath) || samePath(out, dbPath) || samePath(dbPath, seedPath)) throw new Error('Output/checkpoint must not overwrite seed or each other');
  if (top100) {
    const protectedPaths = ['data/.wikidata-state.sqlite', 'data/.wikidata-curated.sqlite', 'data/.wikidata-top100.sqlite', 'data/football-wikidata.json', 'data/football-curated.json', 'data/football-top100.json', 'data/football.reviewed.json'].map(path => resolve(path));
    if (protectedPaths.some(path => samePath(dbPath, path) || samePath(out, path))) throw new Error('Top 100 mode cannot overwrite existing checkpoints or datasets');
  }
  const maxTasks = Number(flag('max-tasks', '50'));
  if (!Number.isSafeInteger(maxTasks) || maxTasks < 0 || maxTasks > 10000) throw new Error('max-tasks must be 0..10000');
  const concurrency = Number(flag('concurrency', '1'));
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 3) throw new Error('concurrency must be 1..3');
  const offline = args.includes('--offline');
  const abort = new AbortController();
  const stop = () => abort.abort(new Error('Collection interrupted'));
  // No live request is possible without a real configured contact; never use the example address.
  const client = offline ? undefined : new WikidataClient({ userAgent: process.env.WIKIDATA_USER_AGENT ?? '', signal: abort.signal });
  const seed: unknown = JSON.parse(await readFile(seedPath, 'utf8')); validateDataset(seed);
  await mkdir(dirname(dbPath), { recursive: true }); await mkdir(dirname(out), { recursive: true });
  const store = new Checkpoint(dbPath);
  let acquired = false;
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    store.acquire(); acquired = true;
    if (!top100) await preserveLegacy(store, resolve('data/.wikidata-progress.json'), out);
    const catalogPath = resolve(flag('catalog', top100 ? 'data/club-catalog.top100.json' : 'data/club-catalog.json'));
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as {
      clubs: { id: string; name: string; tier: 'A' | 'B' }[];
      nationalTeams?: { id: string; name: string }[];
    };
    if (!Array.isArray(catalog.clubs) || !catalog.clubs.length) {
      throw new Error('Kulüp kataloğu boş veya geçersiz');
    }
    let reuse = 0;
    if (top100) {
      validateTop100Catalog(catalog);
      prepareTop100(store, catalog, resolve('data/.wikidata-top100.sqlite'));
      reuse = reuseCachedJobs(store, ['data/.wikidata-top100.sqlite', 'data/.wikidata-curated.sqlite', 'data/.wikidata-state.sqlite'].map(path => resolve(path)));
    } else {
      const jobs = catalogJobs(catalog);
      store.transaction(() => { for (const job of jobs) store.enqueue(job); });
    }
    const run = client ? await collect(store, client, maxTasks, abort.signal, concurrency, top100 ? 'balanced' : 'references') : { attempted: 0, runFailures: 0, ...store.stats() };
    const output = transform(store.records(), seed);
    validateDataset(output);
    let progress: ReturnType<typeof top100Progress> | undefined;
    if (top100) { validateTop100Catalog(catalog); progress = top100Progress(store, catalog); }
    const collection = { checkpointVersion: 1, ...run, reusedCachedJobs: reuse, startedClubs: progress?.startedClubs, completedClubs: progress?.completedClubs, pendingClubs: progress?.pendingClubs, scope: top100 ? 'Top 100 A-club members plus their player P54 team references; no general discovery' : 'Configured catalog targets plus any pending jobs already in the checkpoint; not all football history', complete: run.pending === 0 && !abort.signal.aborted, interrupted: abort.signal.aborted, liveRequestsEnabled: !offline };
    // One atomic export includes data, quarantine, provenance and progress summary.
    await atomicJson(out, { ...output, collection, legacyReview: store.legacy() });
    console.log(JSON.stringify({ output: out, ...output.counts, ...collection }, null, 2));
    if (args.includes('--progress') && progress) console.log(JSON.stringify(progress.clubs, null, 2));
    if (run.failed) process.exitCode = 1;
    if (abort.signal.aborted) process.exitCode = 130;
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    if (acquired) store.release(); store.close();
  }
}
export function catalogJobs(catalog: { clubs: { id: string; tier: 'A' | 'B' }[]; nationalTeams?: { id: string }[] }): Job[] {
  const jobs: Job[] = [];
  for (const club of catalog.clubs) {
    if (!/^Q\d+$/.test(club.id) || !['A', 'B'].includes(club.tier)) throw new Error('Katalogda geçersiz kulüp');
    jobs.push({ kind: 'entity', id: club.id, role: 'team' });
    if (club.tier === 'A') jobs.push({ kind: 'members', id: club.id, after: '' });
  }
  for (const team of catalog.nationalTeams ?? []) {
    if (!/^Q\d+$/.test(team.id)) throw new Error('Katalogda geçersiz millî takım');
    jobs.push({ kind: 'entity', id: team.id, role: 'team' });
  }
  return jobs;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}

