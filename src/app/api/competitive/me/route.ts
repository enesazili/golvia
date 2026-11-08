import { activeSession } from '@/server/auth';
import { competitive } from '@/server/db';
import { failure, json } from '@/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const session = await activeSession(request.headers);
    if (!session?.user.emailVerified) return json({ error: 'Doğrulanmış hesabınla giriş yap.' }, 401);
    return json(await competitive.profile(session.user.id, Number(new URL(request.url).searchParams.get('page') ?? '1')));
  } catch (error) { return failure(error); }
}
