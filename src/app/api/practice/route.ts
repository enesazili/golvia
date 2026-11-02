import { matches } from '@/server/runtime';
import { body, credentials, failure, json, parseAction } from '@/server/http';
import { SessionError } from '@/server/game/service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Bounded local training API; no public matchmaking or second-seat credential exposure.
const creations: number[] = [];
export async function POST(request: Request) {
  try {
    const data = await body(request);
    if (data.type === 'create' && Object.keys(data).length === 1) {
      const now = Date.now();
      while (creations[0] < now - 60_000) creations.shift();
      if (creations.length >= 30) throw new SessionError(429, 'Bir dakika sonra yeniden dene.');
      creations.push(now);
      const session = await matches.create(true);
      const result = await matches.transact(session.id, session.tokens[0]);
      return json(result, 201, { 'Set-Cookie': `golvia-practice=${session.id}.${session.tokens[0]}; HttpOnly; SameSite=Strict; Path=/api/practice; Max-Age=1800${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}` });
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
