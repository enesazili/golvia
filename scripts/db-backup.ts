import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';

/**
 * PostgreSQL backup with an isolated restore verification.
 *   npm run db:backup                    # custom-format dump under .local/backups
 *   npm run db:backup -- --restore-test  # dump, restore into golvia_restore_test, compare counts
 *
 * Credentials are passed through libpq environment variables, never as command arguments or logs.
 */
const adminUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_ADMIN_URL or DATABASE_URL required');
const source = new URL(adminUrl);
const restoreTarget = 'golvia_restore_test';
const withRestore = process.argv.includes('--restore-test');

function pgBinary(name: string) {
  const fileName = `${name}${process.platform === 'win32' ? '.exe' : ''}`;
  const candidates = [
    process.env.PG_BIN ? join(process.env.PG_BIN, fileName) : undefined,
    resolve('.local/postgres/server/pgsql/bin', fileName),
  ].filter((value): value is string => !!value);
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return fileName; // fall back to PATH
}

function libpqEnv(database: string) {
  return {
    ...process.env,
    PGHOST: source.hostname,
    PGPORT: source.port || '5432',
    PGUSER: decodeURIComponent(source.username),
    PGPASSWORD: decodeURIComponent(source.password),
    PGDATABASE: database,
    PGCONNECT_TIMEOUT: '5',
  };
}

function run(binary: string, args: string[], database: string) {
  const result = spawnSync(binary, args, { env: libpqEnv(database), encoding: 'utf8' });
  if (result.error) throw new Error(`${binary} could not start`);
  if (result.status !== 0) throw new Error(`${binary} failed with exit code ${result.status}`);
  return result;
}

async function counts(database: string) {
  const target = new URL(source); target.pathname = `/${database}`;
  const client = new Pool({ connectionString: target.toString(), max: 1 });
  try {
    const entities = await client.query('SELECT count(*)::int AS n FROM football_entity');
    const careers = await client.query('SELECT count(*)::int AS n FROM football_career');
    const playable = await client.query('SELECT count(*)::int AS n FROM football_career WHERE verified AND appeared');
    const links = await client.query('SELECT count(*)::int AS n FROM football_link');
    const sources = await client.query('SELECT count(*)::int AS n FROM football_source');
    const version = await client.query('SELECT version FROM football_dataset WHERE id = 1');
    const users = await client.query('SELECT count(*)::int AS n FROM golvia_auth."user"').catch(() => ({ rows: [{ n: -1 }] }));
    const journal = await client.query('SELECT count(*)::int AS n FROM golvia_match').catch(() => ({ rows: [{ n: -1 }] }));
    return {
      entities: entities.rows[0].n, careers: careers.rows[0].n, playable: playable.rows[0].n,
      links: links.rows[0].n, sources: sources.rows[0].n, version: version.rows[0]?.version ?? 'none',
      authUsers: users.rows[0].n, matches: journal.rows[0].n,
    };
  } finally { await client.end(); }
}

const backupDir = resolve('.local/backups');
mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const file = join(backupDir, `golvia-${stamp}.dump`);
run(pgBinary('pg_dump'), ['--format=custom', '--no-owner', '--file', file], source.pathname.slice(1));
console.log(`Backup written: ${file}`);

if (withRestore) {
  if (!restoreTarget.endsWith('_restore_test')) throw new Error('Restore target must be an isolated *_restore_test database');
  run(pgBinary('pg_restore'), ['--clean', '--if-exists', '--no-owner', '--dbname', restoreTarget, file], restoreTarget);
  const before = await counts(source.pathname.slice(1));
  const after = await counts(restoreTarget);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error(`Restore verification mismatch: source=${JSON.stringify(before)} restored=${JSON.stringify(after)}`);
  }
  console.log(`Restore verification: OK (${after.entities} entities, ${after.careers} careers, ${after.links} links, dataset ${after.version})`);
}
