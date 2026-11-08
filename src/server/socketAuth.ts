import { accountConfiguration, activeSession } from './auth.ts';
import { TERMS_VERSION } from '../lib/legal.ts';

export function hasAccountCookie(cookie?: string): boolean {
  return /(?:^|;\s*)(?:__Secure-|__Host-)?better-auth\.session_token=/.test(cookie ?? '');
}

export async function socketAccount(cookie?: string): Promise<string | null> {
  return (await socketIdentity(cookie))?.id ?? null;
}
export async function socketIdentity(cookie?: string): Promise<{ id: string; name: string } | null> {
  if (!hasAccountCookie(cookie)) return null;
  const config = accountConfiguration();
  if (!config.database || !config.secret || !config.origin) throw new Error('Account service unavailable');
  const session = await activeSession(new Headers({ cookie: cookie! }));
  return session?.user?.emailVerified && session.user.termsVersion === TERMS_VERSION ? { id: session.user.id, name: session.user.name } : null;
}
