import { pool, football } from '@/server/db';
import { json } from '@/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get('check') !== 'ready') return json({ status: 'up' });
  try { await pool.query('SELECT 1'); await football.catalog(); if (process.env.BETTER_AUTH_URL) await pool.query('SELECT 1 FROM golvia_auth."user" LIMIT 1'); return json({ status: 'ready' }); }
  catch { return json({ status: 'unavailable' }, 503); }
}
