import { accountConfiguration, activeSession } from './auth.ts';

export function hasAccountCookie(cookie?: string): boolean {
  return /(?:^|;\s*)(?:__Secure-|__Host-)?better-auth\.session_token=/.test(cookie ?? '');
}

export async function socketAccount(cookie?: string): Promise<string | null> {
  if (!hasAccountCookie(cookie)) return null;
  const config = accountConfiguration();
  if (!config.database || !config.secret || !config.origin) throw new Error('Account service unavailable');
  const session = await activeSession(new Headers({ cookie: cookie! }));
  return session?.user?.id ?? null;
}
