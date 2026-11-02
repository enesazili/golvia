import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { importDataset } from '../src/server/football/importer.ts';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required; copy .env.example to .env');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const command = process.argv[2];
  if (command === 'migrate') {
    const client = await pool.connect();
    try { await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(3212026)'); await client.query(await readFile(new URL('../src/server/football/schema.sql', import.meta.url), 'utf8')); await client.query('COMMIT'); }
    catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  } else if (command === 'import') {
    const path = process.argv[3] ?? new URL('../data/football.seed.json', import.meta.url);
    await importDataset(pool, JSON.parse(await readFile(path, 'utf8')));
  } else throw new Error('Use migrate or import [path]');
  console.log(`Database ${command}: OK`);
} finally { await pool.end(); }
