import { activeSession } from '@/server/auth';
import { competitive } from '@/server/db';
import { failure, json } from '@/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try { const session = await activeSession(request.headers); return json(await competitive.leaderboard(params.get('mode') ?? '3-2-1', Number(params.get('page') ?? '1'), 20, session?.user.id ?? null)); }
  catch (error) { return failure(error); }
}
