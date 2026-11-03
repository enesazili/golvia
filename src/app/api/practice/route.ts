import { matches } from '@/server/runtime';
import { body, credentials, failure, json, parseAction } from '@/server/http';
import { SessionError } from '@/server/game/service';
import { publicOrigin } from '@/server/config';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Bounded local training API; no public matchmaking or second-seat credential exposure.
type Creation = { at: number; ip: string };
const creations: Creation[] = [];
const PER_IP_LIMIT = 30;
const GLOBAL_LIMIT = 300;
export async function POST(request: Request) {
  try {
    const data = await body(request);
    if (data.type === 'create' && Object.keys(data).length === 1) {
      const now = Date.now();
      const ip = request.headers.get('x-real-ip')?.trim() || 'unknown';
      while (creations[0] && creations[0].at < now - 60_000) creations.shift();
      if (creations.length >= GLOBAL_LIMIT || creations.filter(item => item.ip === ip).length >= PER_IP_LIMIT) throw new SessionError(429, 'Bir dakika sonra yeniden dene.');
      creations.push({ at: now, ip });
      const session = await matches.create(true);
      const result = await matches.transact(session.id, session.tokens[0]);
      return json(result, 201, { 'Set-Cookie': `golvia-practice=${session.id}.${session.tokens[0]}; HttpOnly; SameSite=Strict; Path=/api/practice; Max-Age=1800${(publicOrigin() ?? new URL(request.url).origin).startsWith('https:') ? '; Secure' : ''}` });
    }
    const action = parseAction(data);
    const { id, token } = credentials(request);
    const result = await matches.transact(id, token, action);
    return json(result, result.receipt?.accepted ? 200 : 409);
  } catch (error) { return failure(error); }
}
export async function GET(request: Request) {
  try { const { id, token } = credentials(request); return json(await matches.transact(id, token)); }
  catch (error) { return failure(error); }
}
