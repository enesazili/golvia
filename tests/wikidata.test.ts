import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { Checkpoint, type Job } from '../scripts/wikidata/store.ts';
import { collect, discoveryJobs, queryFor } from '../scripts/wikidata/collector.ts';
import { catalogJobs } from '../scripts/wikidata-fetch.ts';
import { WikidataClient, validateUserAgent } from '../scripts/wikidata/client.ts';
import { classifyTeam, names, transform, type WdEntity, type Statement } from '../scripts/wikidata/transform.ts';
import { atomicJson, preserveLegacy } from '../scripts/wikidata/files.ts';
import { validateDataset } from '../src/server/football/importer.ts';
import { normalize } from '../src/server/football/normalize.ts';
import { prepareTop100, reuseCachedJobs, top100Progress, validateTop100Catalog } from '../scripts/wikidata/top100.ts';
import type { Dataset } from '../src/server/football/types.ts';
const value = (id: string) => ({ mainsnak: { datavalue: { value: { id } } } });
const rawPlayer: WdEntity = { id: 'Q1', lastrevid: 11, labels: { tr: { value: 'İlhan Şükür' }, en: { value: 'Ilhan Sukur' } }, aliases: { tr: [{ value: 'Kral' }] }, claims: { P31: [value('Q5')], P54: [{ id: 'Q1$first', ...value('Q2') }, { id: 'Q1$second', ...value('Q2'), qualifiers: { P580: [{ datavalue: { value: { time: '+2005-00-00T00:00:00Z', precision: 9 } } }] } }], P1449: [{ mainsnak: { datavalue: { value: { text: 'The King', language: 'en' } } } }] } };
const rawTeam: WdEntity = { id: 'Q2', lastrevid: 22, labels: { tr: { value: 'Örnek Kulüp' } }, claims: { P31: [value('Q476028')] } };
const seed: Dataset = { version: 'synthetic-only', sources: [{ id: 'test', url: 'https://test.invalid/source', license: 'CC0-1.0', retrieved: '2026-11-01' }], entities: [{ id: 'Q2', kind: 'club', name: 'Örnek Kulüp', aliases: [], level: 'senior', sourceId: 'test' }], careers: [] };
test('P54 membership cannot become playable without separate reviewed evidence', () => {
  const d: Dataset = structuredClone(seed);
  d.entities.push({ id: 'Q1', kind: 'player', name: 'Test oyuncusu', aliases: [], sourceId: 'test' });
  d.careers.push({ id: 'membership', playerId: 'Q1', teamId: 'Q2', appeared: true, verified: true, sourceId: 'test', evidenceId: 'test' });
  assert.throws(() => validateDataset(d), /separate reviewed match evidence/);
  d.sources.push({ id: 'review', url: 'https://test.invalid/match', license: 'reference-only', retrieved: '2026-11-01' });
  d.careers[0].evidenceId = 'review';
  assert.doesNotThrow(() => validateDataset(d));
  d.origin = 'wikidata-candidates';
  assert.throws(() => validateDataset(d), /Candidate membership/);
});

test('committed data and progress survive a hard process kill; incomplete transaction rolls back', { timeout: 20000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'golvia-checkpoint-test-'));
  try {
    for (const mode of ['committed', 'uncommitted']) {
      const path = join(dir, `${mode}.sqlite`);
      const child = fork(new URL('./fixtures/checkpoint-child.ts', import.meta.url), [path, mode], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      try {
        await Promise.race([once(child, 'message'), once(child, 'exit').then(() => { throw new Error('Child exited before checkpoint'); })]);
        const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
        const restored = new Checkpoint(path);
        try { restored.acquire(); assert.equal(!!restored.entity('Q1'), mode === 'committed'); assert.equal(restored.stats().completed, mode === 'committed' ? 1 : 0); restored.release(); }
        finally { restored.close(); }
      } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('resume reuses saved entities, preserves multiple career statements and deduplicates players', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'golvia-checkpoint-test-'));
  const path = join(dir, 'resume.sqlite'); let store = new Checkpoint(path); let calls = 0;
  const transport = { json: async (url: string) => { calls++; const e = url.includes('Q1.json') ? rawPlayer : rawTeam; return { entities: { [e.id]: e } }; } };
  try {
    const job: Job = { kind: 'entity', id: 'Q1', role: 'player' };
    store.enqueue(job); store.enqueue(job); await collect(store, transport, 1); store.close();
    store = new Checkpoint(path);
    assert.deepEqual(store.pending(), [{ kind: 'entity', id: 'Q2', role: 'team' }]);
    await collect(store, transport, 10);
    assert.equal(calls, 2); assert.equal(store.records().length, 2); assert.equal(store.stats().pending, 0);
    await collect(store, transport, 10); assert.equal(calls, 2);
    const output = transform(store.records(), seed); validateDataset(output);
    assert.equal(output.counts.players, 1); assert.equal(output.careers.length, 2);
    assert.notEqual(output.careers[0].id, output.careers[1].id); assert.equal(output.careers[1].fromYear, 2005);
    assert.ok(output.careers.every(c => !c.appeared && !c.verified));
    assert.equal(store.pending().some(j => j.kind === 'members'), false);
    store.enqueue({ kind: 'entity', id: 'Q2', role: 'country' });
    await collect(store, transport, 1);
    assert.equal(calls, 2);
    assert.deepEqual(store.records().find(r => r.entity.id === 'Q2')?.roles, ['country', 'team']);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});
test('only A catalog clubs start member discovery; P54 references only enqueue team entities', async () => {
  const jobs = catalogJobs({ clubs: [{ id: 'Q2', tier: 'A' }, { id: 'Q3', tier: 'B' }], nationalTeams: [{ id: 'Q4' }] });
  assert.deepEqual(jobs.filter(j => j.kind === 'members'), [{ kind: 'members', id: 'Q2', after: '' }]);
  const store = new Checkpoint(':memory:');
  try {
    const player: Job = { kind: 'entity', id: 'Q1', role: 'player' };
    store.enqueue(player);
    await collect(store, { json: async () => ({ entities: { Q1: rawPlayer } }) }, 1);
    assert.deepEqual(store.pending(), [{ kind: 'entity', id: 'Q2', role: 'team' }]);
  } finally { store.close(); }
});
test('Top 100 checkpoint reuses scoped pages and cached P54 teams without carrying global discovery', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'golvia-top100-test-'));
  const oldPath = join(dir, 'old.sqlite'), globalPath = join(dir, 'global.sqlite'), newPath = join(dir, 'new.sqlite');
  const catalog = { clubs: Array.from({ length: 100 }, (_, i) => ({ id: `Q${i + 2}`, name: `Club ${i + 2}`, tier: 'A' as const, rank: i + 1, country: 'Test' })), nationalTeams: [] };
  const source = new Checkpoint(oldPath);
  try {
    for (const club of catalog.clubs) {
      const job: Job = { kind: 'entity', id: club.id, role: 'team' };
      source.enqueue(job);
      source.commit(job, [], { ...rawTeam, id: club.id, labels: { en: { value: club.name } } });
    }
    const member: Job = { kind: 'members', id: 'Q2', after: '' };
    source.enqueue(member); source.commit(member, []);
    const player: Job = { kind: 'entity', id: 'Q1', role: 'player' };
    source.enqueue(player); source.commit(player, [], { ...rawPlayer, claims: { ...rawPlayer.claims, P54: [value('Q150')] } });
  } finally { source.close(); }
  const global = new Checkpoint(globalPath);
  try {
    global.enqueue({ kind: 'discover', scope: 'players', after: '', prefix: 'Q1' });
    const team: Job = { kind: 'entity', id: 'Q150', role: 'team' };
    global.enqueue(team); global.commit(team, [], { ...rawTeam, id: 'Q150' });
  } finally { global.close(); }
  let fresh = new Checkpoint(newPath);
  try {
    assert.doesNotThrow(() => validateTop100Catalog(catalog));
    assert.throws(() => validateTop100Catalog({ ...catalog, clubs: [...catalog.clubs.slice(0, 99), catalog.clubs[0]] }), /duplicate/);
    const first = prepareTop100(fresh, catalog, oldPath);
    assert.equal(first.reusedEntities, 101);
    assert.equal(reuseCachedJobs(fresh, [globalPath]), 1);
    assert.equal(fresh.entity('Q150')?.id, 'Q150');
    assert.equal(fresh.pending().some(job => job.kind === 'discover' || (job.kind === 'members' && job.id === 'Q150')), false);
    assert.equal(fresh.pending().filter(job => job.kind === 'members').length, 99);
    const progress = top100Progress(fresh, catalog);
    assert.equal(progress.startedClubs, 1);
    assert.equal(progress.completedClubs, 1);
    assert.equal(progress.pendingClubs, 99);
    const total = fresh.stats().total;
    fresh.close(); fresh = new Checkpoint(newPath);
    prepareTop100(fresh, catalog, oldPath);
    assert.equal(reuseCachedJobs(fresh, [globalPath]), 0);
    assert.equal(fresh.stats().total, total);
    assert.equal(fresh.entity('Q150')?.id, 'Q150');
  } finally { fresh.close(); await rm(dir, { recursive: true, force: true }); }
});
test('failed or malformed queries remain pending and succeed on a later run', async () => {
  const store = new Checkpoint(':memory:');
  try {
    store.enqueue({ kind: 'members', id: 'Q2', after: '' });
    const first = await collect(store, { json: async () => { throw new Error('timeout'); } }, 10); assert.equal(first.completed, 0); assert.equal(first.failed, 1);
    await collect(store, { json: async () => ({}) }, 10); assert.equal(store.stats().completed, 0);
    await collect(store, { json: async () => ({ results: { bindings: [] } }) }, 10); assert.equal(store.stats().completed, 1);
  } finally { store.close(); }
});

test('bounded workers claim distinct jobs and checkpoint each completion', async () => {
  const store = new Checkpoint(':memory:');
  let active = 0, peak = 0, requests = 0;
  try {
    for (let id = 1; id <= 5; id++) store.enqueue({ kind: 'entity', id: `Q${id}`, role: 'team' });
    const transport = { json: async (url: string) => {
      active++; peak = Math.max(peak, active); requests++;
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      const id = /\/(Q\d+)\.json$/.exec(url)![1];
      return { entities: { [id]: { ...rawTeam, id } } };
    } };
    const result = await collect(store, transport, 5, undefined, 2);
    assert.equal(result.completed, 5); assert.equal(result.pending, 0);
    assert.equal(requests, 5); assert.equal(peak, 2);
    await collect(store, transport, 5, undefined, 2);
    assert.equal(requests, 5);
    await assert.rejects(collect(store, transport, 1, undefined, 5), /concurrency/);
  } finally { store.close(); }
});

test('Top 100 scheduling starts member discovery before reference teams', async () => {
  const store = new Checkpoint(':memory:');
  try {
    store.enqueue({ kind: 'entity', id: 'Q2', role: 'team' });
    store.enqueue({ kind: 'members', id: 'Q3', after: '' });
    assert.deepEqual(store.next(new Set()), { kind: 'entity', id: 'Q2', role: 'team' });
    assert.deepEqual(store.next(new Set(), 'members'), { kind: 'members', id: 'Q3', after: '' });
    assert.deepEqual(store.next(new Set(), 'balanced'), { kind: 'members', id: 'Q3', after: '' });
    for (let id = 4; id <= 103; id++) store.enqueue({ kind: 'entity', id: `Q${id}`, role: 'player' });
    assert.deepEqual(store.next(new Set(), 'balanced'), { kind: 'entity', id: 'Q4', role: 'player' });
  } finally { store.close(); }
});

test('concurrent Wikidata requests reserve separate rate-limit slots', async () => {
  const delays: number[] = [];
  const client = new WikidataClient({ userAgent: 'GolviaTest/1.0 (https://test.invalid/contact)', interval: 2500,
    now: () => 1000, sleep: async ms => { delays.push(ms); }, fetcher: async () => Response.json({ ok: true }) });
  await Promise.all([client.json('https://test.invalid/1'), client.json('https://test.invalid/2')]);
  assert.deepEqual(delays, [0, 2500]);
});
test('checkpoint write failure rolls back entity and completion marker together', () => {
  const store = new Checkpoint(':memory:');
  try {
    const job: Job = { kind: 'entity', id: 'Q1', role: 'player' }; store.enqueue(job);
    assert.throws(() => store.commit(job, [], rawPlayer, () => { throw new Error('write failed'); }), /write failed/);
    assert.equal(store.entity('Q1'), undefined); assert.equal(store.stats().pending, 1);
  } finally { store.close(); }
});
test('atomic export failure leaves the previous file intact', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'golvia-checkpoint-test-')); const path = join(dir, 'out.json');
  try { await atomicJson(path, { old: true }); await assert.rejects(atomicJson(path, { old: false }, async () => { throw new Error('disk failure'); })); assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { old: true }); }
  finally { await rm(dir, { recursive: true, force: true }); }
});
test('legacy completion-only progress never skips lost records; saved legacy payload is preserved', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'golvia-checkpoint-test-')); const store = new Checkpoint(':memory:');
  try {
    const progress = join(dir, 'progress.json'), out = join(dir, 'legacy.json');
    await atomicJson(progress, { completedTeams: ['Q2'] }); await atomicJson(out, { entities: [rawPlayer] });
    await preserveLegacy(store, progress, out); await preserveLegacy(store, progress, out);
    assert.equal(store.stats().pending, 1); assert.equal(store.stats().completed, 0); assert.equal(store.legacy().length, 2);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});
test('429 Retry-After is respected; transient exhaustion throws instead of succeeding with empty data', async () => {
  const delays: number[] = []; let requests = 0;
  const options = { userAgent: 'GolviaTest/1.0 (https://test.invalid/contact)', interval: 0, retries: 2, random: () => 0, sleep: async (ms: number) => { delays.push(ms); } };
  const client = new WikidataClient({ ...options, fetcher: async () => ++requests === 1 ? new Response('', { status: 429, headers: { 'retry-after': '9' } }) : Response.json({ ok: true }) });
  assert.deepEqual(await client.json('https://test.invalid'), { ok: true }); assert.ok(delays.includes(9000));
  const bad = new WikidataClient({ ...options, fetcher: async () => new Response('', { status: 503 }) }); await assert.rejects(bad.json('https://test.invalid'), /503/);
  let permanentCalls = 0; const permanent = new WikidataClient({ ...options, fetcher: async () => { permanentCalls++; return new Response('', { status: 400 }); } });
  await assert.rejects(permanent.json('https://test.invalid')); assert.equal(permanentCalls, 1);
  assert.throws(() => validateUserAgent('GolviaBot/1.0 (contact@example.com)')); assert.throws(() => validateUserAgent(''));
});
test('unknown, generic national and reserve teams are never promoted to professional senior teams', () => {
  assert.equal(classifyTeam(rawTeam).category, 'club-candidate');
  assert.equal(classifyTeam({ ...rawTeam, claims: { P31: [value('Q6979593')] } }).status, 'needs-review');
  assert.equal(classifyTeam({ ...rawTeam, claims: { P31: [value('Q476028'), value('Q2412834')] } }).category, 'reserve');
  assert.equal(classifyTeam({ ...rawTeam, labels: { en: { value: 'Portugal U21' } }, claims: { P31: [value('Q135408445')] } }).category, 'youth-national');
  assert.equal(classifyTeam({ ...rawTeam, labels: { en: { value: 'Academy under-19' } } }).category, 'academy');
  assert.equal(classifyTeam({ ...rawTeam, claims: { P31: [value('Q476028'), value('Q20639856'), value('Q10651067')] } }).category, 'professional-club');
  assert.equal(classifyTeam({ ...rawTeam, claims: { P31: [value('Q20639856')], P641: [value('Q2736')] } }).category, 'professional-club');
  assert.equal(classifyTeam({ ...rawTeam, claims: { P31: [value('Q20639856')] } }).status, 'needs-review');
  const reviewed = structuredClone(seed.entities[0]);
  assert.equal(classifyTeam({ ...rawTeam, id: reviewed.id }, reviewed).category, 'professional-club');
  const senior = { ...reviewed, id: 'Q267245', kind: 'national_team' as const, countryId: 'Q45' };
  assert.equal(classifyTeam({ ...rawTeam, id: senior.id, claims: { P31: [value('Q6979593')] } }, senior).category, 'senior-national');
  assert.equal(classifyTeam({ ...rawTeam, id: senior.id, labels: { en: { value: 'Portugal U21' } }, claims: { P31: [value('Q6979593')] } }, senior).status, 'needs-review');
});
test('existing queued team and country records take priority without redownloading cached entities', async () => {
  const store = new Checkpoint(':memory:'); let calls = 0;
  try {
    store.enqueue({ kind: 'entity', id: 'Q1', role: 'player' });
    store.enqueue({ kind: 'entity', id: 'Q2', role: 'team' });
    assert.deepEqual(store.next(new Set()), { kind: 'entity', id: 'Q2', role: 'team' });
    const transport = { json: async () => { calls++; return { entities: { Q2: rawTeam } }; } };
    await collect(store, transport, 1);
    assert.equal(store.stats().completed, 1);
    assert.equal(calls, 1);
    store.enqueue({ kind: 'entity', id: 'Q2', role: 'country' });
    await collect(store, transport, 1);
    assert.equal(calls, 1);
  } finally { store.close(); }
});
test('P54 targets from an existing checkpoint outrank unrelated discovery teams', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'golvia-targets-')); const path = join(dir, 'state.sqlite');
  try {
    let store = new Checkpoint(path);
    store.enqueue({ kind: 'entity', id: 'Q1', role: 'player' });
    store.commit({ kind: 'entity', id: 'Q1', role: 'player' }, [], rawPlayer);
    store.enqueue({ kind: 'entity', id: 'Q99', role: 'team' });
    store.enqueue({ kind: 'entity', id: 'Q2', role: 'team' });
    store.close();
    store = new Checkpoint(path);
    assert.deepEqual(store.next(new Set()), { kind: 'entity', id: 'Q2', role: 'team' });
    store.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('missing teams, unknown dates, loan qualifiers and references remain available for review', () => {
  const statement: Statement = { ...value('Q999'), id: 'Q1$loan', qualifiers: { P580: [{ datavalue: { value: { time: '+1900-00-00T00:00:00Z', precision: 7 } } }], P1642: [{ datavalue: { value: { id: 'Q123' } } }] }, references: [{ snaks: { P854: [{ datavalue: { value: 'https://test.invalid/evidence' } }] } }] };
  const p = { ...rawPlayer, claims: { ...rawPlayer.claims, P54: [statement] } };
  const output = transform([{ entity: p, roles: ['player'], retrieved: '2026-11-01' }], seed);
  assert.equal(output.careers.length, 0); assert.equal(output.counts.careers, 1);
  const record = output.review[0].record as { fromYear?: number; provenance: { qualifiers: unknown; references: unknown } };
  assert.equal(record.fromYear, undefined); assert.deepEqual(record.provenance.qualifiers, statement.qualifiers); assert.deepEqual(record.provenance.references, statement.references);
});
test('Turkish and English labels, aliases, nicknames and initials are retained by ID', () => {
  const result = names(rawPlayer); assert.equal(result.name, 'İlhan Şükür'); assert.ok(result.aliases.includes('The King')); assert.ok(result.aliases.includes('Kral')); assert.ok(result.aliases.includes('Ilhan Sukur'));
  assert.equal(normalize(result.name), 'ilhan sukur');
  const second = { ...rawPlayer, id: 'Q3' }; const output = transform([rawPlayer, second].map(entity => ({ entity, roles: ['player'], retrieved: '2026-11-01' })), seed); assert.equal(output.counts.players, 2);
});
test('discovery includes club-only and historic players, stable cursor pages, no current/national restriction', () => {
  const jobs = discoveryJobs(); assert.equal(jobs.length, 27);
  const playerJob = jobs.find(j => j.kind === 'discover' && j.scope === 'players')!;
  assert.ok(playerJob.kind === 'discover'); const query = queryFor(playerJob);
  assert.match(query, /P106/); assert.doesNotMatch(query, /\b(?:P570|P582|P27|P54)\b/);
  assert.match(queryFor({ kind: 'members', id: 'Q2', after: 'Q15' }), /p:P54\/ps:P54/);
  assert.throws(() => queryFor({ kind: 'members', id: 'injected }', after: '' }));
});


