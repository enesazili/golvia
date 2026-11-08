import { handleAuth, accountConfiguration, continueEmail } from '@/server/auth';
import { json } from '@/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!accountConfiguration().database || !accountConfiguration().secret || !accountConfiguration().origin) return json({ error: 'Hesap hizmeti henüz yapılandırılmadı.' }, 503);
  return handleAuth(request);
}
export async function POST(request: Request) {
  if (!accountConfiguration().database || !accountConfiguration().secret || !accountConfiguration().origin) return json({ error: 'Hesap hizmeti henüz yapılandırılmadı.' }, 503);
  if (new URL(request.url).pathname === '/api/auth/continue/email') return continueEmail(request);
  return handleAuth(request);
}
