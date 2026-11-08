import { activeSession } from '@/server/auth';
import { pool } from '@/server/db';
import { body, failure, json } from '@/server/http';
import { acceptsTerms, TERMS_VERSION } from '@/lib/legal';
export async function POST(request: Request) {
  try {
    const data = await body(request);
    if (!acceptsTerms(data)) return json({ error: 'Güncel koşulların kabulü gerekli.' }, 400);
    const session = await activeSession(request.headers);
    if (!session) return json({ error: 'Giriş yapmalısın.' }, 401);
    await pool.query('UPDATE golvia_auth."user" SET "termsVersion"=$2,"termsAcceptedAt"=now() WHERE id=$1', [session.user.id, TERMS_VERSION]);
    return json({ accepted: true });
  } catch (error) { return failure(error); }
}
