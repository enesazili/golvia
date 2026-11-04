import { DatabaseSync } from 'node:sqlite';
import type { WdEntity } from './transform.ts';
import { entityIds } from './transform.ts';
export type Role = 'player' | 'team' | 'country';
export type Job = { kind: 'entity'; id: string; role: Role } | { kind: 'discover'; scope: 'players' | 'clubs' | 'national'; after: string; prefix: string } | { kind: 'members'; id: string; after: string };
export type Stored = { entity: WdEntity; roles: Role[]; retrieved: string };
export function jobKey(job: Job) { return JSON.stringify(job); }
export class Checkpoint {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(key TEXT PRIMARY KEY,payload TEXT NOT NULL,done INTEGER NOT NULL DEFAULT 0,failures INTEGER NOT NULL DEFAULT 0,error TEXT);
      CREATE TABLE IF NOT EXISTS entities(id TEXT PRIMARY KEY,payload TEXT NOT NULL,retrieved TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS roles(id TEXT NOT NULL,role TEXT NOT NULL,PRIMARY KEY(id,role));
      CREATE TABLE IF NOT EXISTS targets(id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS legacy(path TEXT PRIMARY KEY,payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS jobs_pending ON jobs(done);
      CREATE INDEX IF NOT EXISTS jobs_pending_kind_role ON jobs(done,json_extract(payload,'$.kind'),json_extract(payload,'$.role'));
      CREATE INDEX IF NOT EXISTS roles_by_role ON roles(role,id);
    `);
    const version = this.db.prepare("SELECT value FROM meta WHERE key='schema'").get();
    if (version && version.value !== '1') throw new Error('Unsupported checkpoint version');
    this.db.prepare("INSERT OR IGNORE INTO meta VALUES('schema','1')").run();
    const check = this.db.prepare('PRAGMA quick_check').get();
    if (check?.quick_check !== 'ok') throw new Error('Checkpoint integrity check failed; do not overwrite it');
    // Add references from checkpoints created before target prioritization.
    this.transaction(() => {
      for (const row of this.db.prepare("SELECT e.payload FROM entities e JOIN roles r ON r.id=e.id WHERE r.role='player'").iterate()) {
        for (const id of entityIds(JSON.parse(String(row.payload)), 'P54')) this.db.prepare('INSERT OR IGNORE INTO targets VALUES(?)').run(id);
      }
    });
  }
  transaction(fn: () => void) {
    this.db.exec('BEGIN IMMEDIATE');
    try { fn(); this.db.exec('COMMIT'); } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  enqueue(job: Job) { this.db.prepare('INSERT OR IGNORE INTO jobs(key,payload) VALUES(?,?)').run(jobKey(job), JSON.stringify(job)); }
  // Call inside a transaction when restoring a previously committed checkpoint job.
  restoreCompleted(job: Job, additions: Job[], entity?: WdEntity, retrieved?: string) {
    if (job.kind === 'entity' && (!entity || entity.id !== job.id || !entity.claims || !Number.isSafeInteger(entity.lastrevid) || !/^\d{4}-\d{2}-\d{2}$/.test(retrieved ?? ''))) throw new Error('Completed entity has no valid cached payload');
    if (job.kind !== 'entity' && entity) throw new Error('Unexpected entity for page job');
    this.enqueue(job);
    if (entity) {
      this.db.prepare('INSERT OR IGNORE INTO entities VALUES(?,?,?)').run(entity.id, JSON.stringify(entity), retrieved!);
      if (job.kind === 'entity') this.db.prepare('INSERT OR IGNORE INTO roles VALUES(?,?)').run(job.id, job.role);
      if (job.kind === 'entity' && job.role === 'player') for (const id of entityIds(entity, 'P54')) this.db.prepare('INSERT OR IGNORE INTO targets VALUES(?)').run(id);
    }
    for (const next of additions) this.enqueue(next);
    this.db.prepare('UPDATE jobs SET done=1,error=NULL WHERE key=?').run(jobKey(job));
  }
  pending(): Job[] { return this.db.prepare('SELECT payload FROM jobs WHERE done=0 ORDER BY rowid').all().map(r => JSON.parse(String(r.payload))); }
  next(excluded: Set<string>, schedule: 'references' | 'members' | 'balanced' = 'references'): Job | undefined {
    // Resolve referenced teams/countries before the large discovery backlog. This is a
    // scheduling change only: already completed jobs and cached entities stay intact.
    const waitingPlayers = schedule === 'balanced' ? Number(this.db.prepare("SELECT count(*) AS n FROM jobs WHERE done=0 AND json_extract(payload,'$.kind')='entity' AND json_extract(payload,'$.role')='player'").get()!.n) : 0;
    const pendingMembers = schedule === 'balanced' ? Number(this.db.prepare("SELECT count(*) AS n FROM jobs WHERE done=0 AND json_extract(payload,'$.kind')='members'").get()!.n) : 0;
    const focus = schedule === 'balanced' ? (pendingMembers && waitingPlayers < 100 ? 'members' : waitingPlayers ? 'players' : 'references') : schedule;
    const sql = `SELECT key,payload FROM jobs WHERE done=0 ORDER BY
      ${focus === 'members' ? "CASE WHEN json_extract(payload,'$.kind')='members' THEN -2 ELSE 0 END," : ''}
      ${focus === 'players' ? "CASE WHEN json_extract(payload,'$.kind')='entity' AND json_extract(payload,'$.role')='player' THEN -2 ELSE 0 END," : ''}
      CASE WHEN json_extract(payload,'$.kind')='entity' AND json_extract(payload,'$.role')='team'
                AND json_extract(payload,'$.id') IN (SELECT id FROM targets) THEN -1
           WHEN json_extract(payload,'$.kind')='entity' AND json_extract(payload,'$.role') IN ('team','country') THEN 0
           WHEN json_extract(payload,'$.kind')='entity' AND json_extract(payload,'$.role')='player' THEN 1
           ELSE 2 END, rowid`;
    for (const row of this.db.prepare(sql).iterate()) if (!excluded.has(String(row.key))) return JSON.parse(String(row.payload));
  }
  entity(id: string): WdEntity | undefined { const row = this.db.prepare('SELECT payload FROM entities WHERE id=?').get(id); return row ? JSON.parse(String(row.payload)) : undefined; }
  commit(job: Job, additions: Job[], entity?: WdEntity, beforeCommit?: () => void) {
    this.transaction(() => {
      if (entity) this.db.prepare('INSERT INTO entities VALUES(?,?,?) ON CONFLICT(id) DO NOTHING').run(entity.id, JSON.stringify(entity), new Date().toISOString().slice(0, 10));
      if (job.kind === 'entity') this.db.prepare('INSERT OR IGNORE INTO roles VALUES(?,?)').run(job.id, job.role);
      if (entity && job.kind === 'entity' && job.role === 'player') for (const id of entityIds(entity, 'P54')) this.db.prepare('INSERT OR IGNORE INTO targets VALUES(?)').run(id);
      for (const next of additions) this.enqueue(next);
      this.db.prepare('UPDATE jobs SET done=1,error=NULL WHERE key=?').run(jobKey(job));
      beforeCommit?.();
    });
  }
  failed(job: Job, error: unknown) { this.db.prepare('UPDATE jobs SET failures=failures+1,error=? WHERE key=?').run(String(error).slice(0, 500), jobKey(job)); }
  records(): Stored[] {
    const roles = new Map<string, Role[]>();
    for (const row of this.db.prepare('SELECT id,role FROM roles ORDER BY id,role').iterate()) {
      const id = String(row.id);
      const list = roles.get(id) ?? [];
      list.push(row.role as Role);
      roles.set(id, list);
    }
    return this.db.prepare('SELECT * FROM entities ORDER BY id').all().map(r => ({ entity: JSON.parse(String(r.payload)), retrieved: String(r.retrieved), roles: roles.get(String(r.id)) ?? [] }));
  }
  stats() { const r = this.db.prepare('SELECT count(*) AS total,coalesce(sum(done),0) AS completed,coalesce(sum(CASE WHEN done=0 AND failures>0 THEN 1 ELSE 0 END),0) AS failed FROM jobs').get()!; return { total: Number(r.total), completed: Number(r.completed), pending: Number(r.total) - Number(r.completed), failed: Number(r.failed) }; }
  preserveLegacy(path: string, payload: unknown) { this.db.prepare('INSERT OR IGNORE INTO legacy VALUES(?,?)').run(path, JSON.stringify(payload)); }
  legacy() { return this.db.prepare('SELECT path,payload FROM legacy ORDER BY path').all().map(r => ({ path: String(r.path), data: JSON.parse(String(r.payload)) as unknown })); }
  acquire() {
    this.transaction(() => {
      const owner = this.db.prepare("SELECT value FROM meta WHERE key='owner'").get();
      if (owner) {
        let alive = true;
        try { process.kill(Number(owner.value), 0); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ESRCH') alive = false; }
        if (alive) throw new Error('Another collector owns this checkpoint');
      }
      this.db.prepare("INSERT INTO meta VALUES('owner',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(process.pid));
    });
  }
  release() { this.db.prepare("DELETE FROM meta WHERE key='owner' AND value=?").run(String(process.pid)); }
  close() { this.db.close(); }
}
