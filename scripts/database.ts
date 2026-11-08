import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { importDataset } from '../src/server/football/importer.ts';
const adminUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_ADMIN_URL or DATABASE_URL required; copy .env.example to .env');
const pool = new Pool({ connectionString: adminUrl, max: 1 });
try {
  const command = process.argv[2];
  if (command === 'migrate' || command === 'auth-migrate') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(3212026)');
      const files = command === 'migrate'
        ? ['../src/server/auth/schema.sql', '../src/server/football/schema.sql', '../src/server/match/schema.sql', '../src/server/competitive/schema.sql', '../src/server/social/schema.sql']
        : ['../src/server/auth/schema.sql'];
      for (const file of files) await client.query(await readFile(new URL(file, import.meta.url), 'utf8'));
      await client.query('COMMIT');
    }
    catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  } else if (command === 'import') {
    const path = process.argv[3];
    if (!path) throw new Error('Explicit dataset path required. Example: npm run db:import -- data/football.reviewed.json');
    await importDataset(pool, JSON.parse(await readFile(path, 'utf8')));
  } else throw new Error('Use migrate, auth-migrate or import [path]');
  console.log(`Database ${command}: OK`);
} finally { await pool.end(); }
