import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { publicOrigin, socketOrigins } from '../src/server/config.ts';
import { emailConfiguration } from '../src/server/email.ts';

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
if (!process.env.RESEND_API_KEY && !process.env.EMAIL_FROM && smtpConfigured && (!process.env.SMTP_URL || !process.env.SMTP_FROM)) throw new Error('SMTP_URL and SMTP_FROM must be set together');
if (!!process.env.RESEND_API_KEY !== !!process.env.EMAIL_FROM) throw new Error('RESEND_API_KEY and EMAIL_FROM must be set together');
const email = emailConfiguration();
if (authConfigured && email.testDomain) warnings.push('Resend test domain is not eligible for public accounts; signup, verification and reset stay disabled. Use a verified sending domain.');
else if (authConfigured && !email.provider) warnings.push('Email delivery is unavailable: configure RESEND_API_KEY and EMAIL_FROM on Render; signup, verification and reset stay disabled.');
if (!authConfigured) warnings.push('Better Auth is not configured: accounts are unavailable, guest play is unaffected.');
if (!!process.env.GOOGLE_CLIENT_ID !== !!process.env.GOOGLE_CLIENT_SECRET) throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together');
if (['LEGAL_CONTROLLER_NAME', 'LEGAL_CONTACT', 'LEGAL_HOSTING_LOCATION', 'LEGAL_RETENTION_POLICY'].some(key => !process.env[key])) warnings.push('Legal documents are drafts: controller, contact, hosting and retention facts need completion and legal review.');

try { await readFile(new URL('../.next/BUILD_ID', import.meta.url), 'utf8'); }
catch { throw new Error('Production build missing; run npm run build first'); }

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000 });
try {
  await pool.query('SELECT 1');
  const required = ['football_dataset', 'football_entity', 'football_career', 'football_link', 'golvia_match', 'competitive_rating', 'competitive_match', 'competitive_participant'];
  if (authConfigured) required.push('golvia_auth."user"', 'golvia_auth.session', 'golvia_auth.email_verification','social_friendship','social_block','social_invite','social_match','social_notification','social_message','social_chat_read');
  for (const table of required) {
    // Table names come from this fixed list, never from user input.
    const result = await pool.query(`SELECT to_regclass($1) IS NOT NULL AS present`, [table.includes('.') ? table.replaceAll('"', '') : `public.${table}`]);
    if (!result.rows[0]?.present) throw new Error(`Database migration missing for ${table}; run npm run db:migrate${table.startsWith('golvia_auth') ? ' and npm run db:auth:migrate' : ''}`);
  }
  if (authConfigured) {
    const socialColumns = await pool.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND table_name='social_invite' AND column_name IN ('kind','source_match')");
    if(socialColumns.rows[0].n!==2)throw new Error('Database migration missing for social chat/rematches; run npm run db:migrate after backup');
    const columns = await pool.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='golvia_auth' AND table_name='user' AND column_name IN ('termsVersion','termsAcceptedAt')");
    if (columns.rows[0].n !== 2) throw new Error('Database migration missing for account terms; run npm run db:auth:migrate after backup');
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
