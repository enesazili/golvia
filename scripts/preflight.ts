import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { publicOrigin, socketOrigins } from '../src/server/config.ts';

if (process.env.NODE_ENV !== 'production') throw new Error('Set NODE_ENV=production for the production processes');

const warnings: string[] = [];
const origin = publicOrigin();
socketOrigins();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.startsWith('postgresql://') && !databaseUrl?.startsWith('postgres://')) throw new Error('DATABASE_URL must be a PostgreSQL URL');

const authConfigured = !!process.env.BETTER_AUTH_URL || !!process.env.BETTER_AUTH_SECRET;
if (authConfigured) {
  if (process.env.BETTER_AUTH_URL !== origin) throw new Error('BETTER_AUTH_URL must equal GOLVIA_PUBLIC_ORIGIN');
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32 || /replace-with|example/i.test(secret)) throw new Error('BETTER_AUTH_SECRET must be at least 32 random characters');
}
const smtpConfigured = !!process.env.SMTP_URL || !!process.env.SMTP_FROM;
if (smtpConfigured && (!process.env.SMTP_URL || !process.env.SMTP_FROM)) throw new Error('SMTP_URL and SMTP_FROM must be set together');
if (authConfigured && !smtpConfigured) warnings.push('SMTP is not configured: account signup, verification and password reset stay disabled.');
if (!authConfigured) warnings.push('Better Auth is not configured: accounts are unavailable, guest play is unaffected.');

try { await readFile(new URL('../.next/BUILD_ID', import.meta.url), 'utf8'); }
catch { throw new Error('Production build missing; run npm run build first'); }

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000 });
try {
  await pool.query('SELECT 1');
  const required = ['football_dataset', 'football_entity', 'football_career', 'football_link', 'golvia_match'];
  if (authConfigured) required.push('golvia_auth."user"', 'golvia_auth.session');
  for (const table of required) {
    // Table names come from this fixed list, never from user input.
    const result = await pool.query(`SELECT to_regclass($1) IS NOT NULL AS present`, [table.includes('.') ? table.replaceAll('"', '') : `public.${table}`]);
    if (!result.rows[0]?.present) throw new Error(`Database migration missing for ${table}; run npm run db:migrate${table.startsWith('golvia_auth') ? ' and npm run db:auth:migrate' : ''}`);
  }
  const version = await pool.query('SELECT version FROM football_dataset WHERE id = 1');
  if (!version.rows[0]?.version) warnings.push('No football dataset imported yet; matches will fail until npm run db:import runs.');
} catch (error) {
  if (error instanceof Error && /migration missing|dataset/.test(error.message)) throw error;
  throw new Error(`PostgreSQL check failed (${error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unavailable'})`);
} finally { await pool.end(); }

if (process.env.GOLVIA_READINESS_URL) {
  const target = new URL('/api/health?check=ready', process.env.GOLVIA_READINESS_URL).toString();
  const response = await fetch(target, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Readiness check failed with HTTP ${response.status}`);
}

console.log('Golvia production configuration: OK');
for (const warning of warnings) console.warn(`WARN: ${warning}`);
