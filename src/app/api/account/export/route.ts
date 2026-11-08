import { activeSession } from '@/server/auth';
import { competitive, pool } from '@/server/db';
import { failure, json } from '@/server/http';
export async function GET(request: Request) {
  try {
    const session = await activeSession(request.headers);
    if (!session) return json({ error: 'Giriş yapmalısın.' }, 401);
    const { id } = session.user;
    const user = (await pool.query('SELECT id,name,email,"emailVerified",username,"createdAt","termsVersion","termsAcceptedAt" FROM golvia_auth."user" WHERE id=$1', [id])).rows[0];
    const sessions = (await pool.query('SELECT "createdAt","expiresAt","ipAddress","userAgent" FROM golvia_auth.session WHERE "userId"=$1', [id])).rows;
    const competition = await competitive.profile(id);
    const history = (await pool.query('SELECT m.*,p.seat,p.elo_before,p.elo_after FROM competitive_participant p JOIN competitive_match m ON m.id=p.match_id WHERE p.user_id=$1 ORDER BY m.started_at DESC', [id])).rows;
    return json({ exportedAt: new Date().toISOString(), user, sessions, ratings: competition.ratings, history }, 200, { 'Content-Disposition': 'attachment; filename="golvia-verilerim.json"', 'X-Content-Type-Options': 'nosniff' });
  } catch (error) { return failure(error); }
}
