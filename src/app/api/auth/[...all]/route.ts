import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth, accountConfiguration } from '@/server/auth';
import { json } from '@/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!accountConfiguration().database || !accountConfiguration().secret || !accountConfiguration().origin) return json({ error: 'Hesap hizmeti henüz yapılandırılmadı.' }, 503);
  return toNextJsHandler(getAuth()).GET(request);
}
export async function POST(request: Request) {
  if (!accountConfiguration().database || !accountConfiguration().secret || !accountConfiguration().origin) return json({ error: 'Hesap hizmeti henüz yapılandırılmadı.' }, 503);
  return toNextJsHandler(getAuth()).POST(request);
}
