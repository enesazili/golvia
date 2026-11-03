import { accountConfiguration, getAuth } from './auth.ts';

export function hasAccountCookie(cookie?: string): boolean {
  return /(?:^|;\s*)(?:__Secure-|__Host-)?better-auth\.session_token=/.test(cookie ?? '');
}

export async function socketAccount(cookie?: string): Promise<string | null> {
  if (!hasAccountCookie(cookie)) return null;
  const config = accountConfiguration();
  if (!config.database || !config.secret || !config.origin) throw new Error('Account service unavailable');
  const session = await getAuth().api.getSession({ headers: new Headers({ cookie: cookie! }) });
  if (!session?.user || session.user.status !== 'active') return null;
  return session.user.id;
}
