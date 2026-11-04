import { DatabaseSync } from 'node:sqlite';
import { Checkpoint, type Job } from './store.ts';
import { relatedJobs } from './collector.ts';
import { entityIds, type WdEntity } from './transform.ts';

type Club = { id: string; name: string; tier: 'A'; rank: number; country: string };
export type Top100Catalog = { clubs: Club[]; nationalTeams?: unknown[] };
type Cached = { entity: WdEntity; retrieved: string };

export function validateTop100Catalog(input: unknown): asserts input is Top100Catalog {
  const catalog = input as Top100Catalog;
  if (!catalog || !Array.isArray(catalog.clubs) || catalog.clubs.length !== 100 || (catalog.nationalTeams?.length ?? 0) !== 0) throw new Error('Top 100 catalog must contain exactly 100 clubs and no national teams');
  const ids = new Set<string>(), ranks = new Set<number>();
  for (const club of catalog.clubs) {
    if (!/^Q\d+$/.test(club.id) || club.tier !== 'A' || typeof club.name !== 'string' || !club.name.trim() || typeof club.country !== 'string' || !club.country.trim() || !Number.isInteger(club.rank) || club.rank < 1 || club.rank > 100 || ids.has(club.id) || ranks.has(club.rank)) throw new Error('Invalid or duplicate Top 100 club');
    ids.add(club.id); ranks.add(club.rank);
  }
}

function openReadOnly(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  db.exec('PRAGMA query_only=ON');
  return db;
}

function cached(db: DatabaseSync, id: string): Cached | undefined {
  const row = db.prepare('SELECT payload,retrieved FROM entities WHERE id=?').get(id);
  if (!row) return;
  return { entity: JSON.parse(String(row.payload)) as WdEntity, retrieved: String(row.retrieved) };
}

function checkCatalogEntity(club: Club, value: Cached | undefined) {
  if (!value || value.entity.id !== club.id) throw new Error(`Top 100 club ${club.id} has no cached identity for offline audit`);
  const entity = value.entity;
  const types = entityIds(entity, 'P31');
  const labels = [entity.labels?.en?.value, entity.labels?.tr?.value, entity.descriptions?.en?.value, entity.descriptions?.tr?.value].filter(Boolean).join(' ');
  if (!types.some(id => ['Q476028', 'Q103229495'].includes(id)) || types.includes('Q2412834') || /\b(women|woman|female|femenino|feminine|reserve|academy|under[- ]?\d{2}|u[- ]?\d{2})\b|kadın/i.test(labels)) throw new Error(`Top 100 club ${club.id} needs manual identity review`);
}

/** Copy only the scoped Top 100 checkpoint's jobs. Other checkpoints are entity caches only. */
export function prepareTop100(store: Checkpoint, catalog: Top100Catalog, sourcePath: string) {
  validateTop100Catalog(catalog);
  const source = openReadOnly(sourcePath);
  try {
    const allowed = new Set(catalog.clubs.map(club => club.id));
    for (const club of catalog.clubs) checkCatalogEntity(club, cached(source, club.id));
    const rows = source.prepare('SELECT payload,done FROM jobs ORDER BY rowid').all().map(row => ({ job: JSON.parse(String(row.payload)) as Job, done: Number(row.done) === 1 }));
    if (rows.some(({ job }) => job.kind === 'discover' || (job.kind === 'members' && !allowed.has(job.id)))) throw new Error('Source checkpoint contains out-of-scope discovery jobs');
    const before = store.stats();
    store.transaction(() => {
      for (const club of catalog.clubs) {
        store.enqueue({ kind: 'entity', id: club.id, role: 'team' });
        store.enqueue({ kind: 'members', id: club.id, after: '' });
      }
      // Restore entity jobs first; completed member pages are marked done only
      // after their queued players have been restored in this same transaction.
      for (const { job, done } of rows.filter(row => row.job.kind === 'entity')) {
        store.enqueue(job);
        if (done && job.kind === 'entity') {
          const record = cached(source, job.id);
          if (!record) throw new Error(`Completed job ${job.id} has no cached entity`);
          store.restoreCompleted(job, relatedJobs(job, record.entity), record.entity, record.retrieved);
        }
      }
      for (const { job, done } of rows.filter(row => row.job.kind === 'members')) {
        store.enqueue(job);
        if (done) store.restoreCompleted(job, []);
      }
    });
    const after = store.stats();
    return { sourceJobs: rows.length, sourceCompleted: rows.filter(row => row.done).length, addedJobs: after.total - before.total, reusedEntities: Number(store.db.prepare('SELECT count(*) AS n FROM entities').get()!.n) };
  } finally { source.close(); }
}

/** Resolve already queued IDs from old checkpoints without importing their job queues. */
export function reuseCachedJobs(store: Checkpoint, paths: string[]) {
  const sources = paths.map(openReadOnly);
  let reused = 0;
  try {
    while (true) {
      let progressed = false;
      for (const job of store.pending()) {
        if (job.kind !== 'entity') continue;
        const record = sources.map(db => cached(db, job.id)).filter((value): value is Cached => !!value).sort((a, b) => b.entity.lastrevid - a.entity.lastrevid)[0];
        if (!record) continue;
        store.transaction(() => store.restoreCompleted(job, relatedJobs(job, record.entity), record.entity, record.retrieved));
        reused++; progressed = true;
      }
      if (!progressed) return reused;
    }
  } finally { for (const db of sources) db.close(); }
}

export function top100Progress(store: Checkpoint, catalog: Top100Catalog) {
  const rows = new Map(catalog.clubs.map(club => [club.id, { id: club.id, rank: club.rank, name: club.name, pages: 0, completedPages: 0, failures: 0 }]));
  for (const row of store.db.prepare("SELECT payload,done,failures FROM jobs WHERE json_extract(payload,'$.kind')='members'").iterate()) {
    const job = JSON.parse(String(row.payload)) as Job;
    if (job.kind !== 'members') continue;
    const club = rows.get(job.id);
    if (!club) throw new Error(`Out-of-scope member job: ${job.id}`);
    club.pages++;
    club.completedPages += Number(row.done);
    club.failures += Number(row.failures);
  }
  const clubs = [...rows.values()].sort((a, b) => a.rank - b.rank);
  return { startedClubs: clubs.filter(c => c.completedPages > 0).length,
    completedClubs: clubs.filter(c => c.pages > 0 && c.pages === c.completedPages).length,
    pendingClubs: clubs.filter(c => c.pages === 0 || c.pages !== c.completedPages).length, clubs };
}
