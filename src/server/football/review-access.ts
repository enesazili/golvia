import { createHash, timingSafeEqual } from 'node:crypto';

export function reviewAvailable(mode: string | undefined, connection: string | undefined) {
  if (mode !== 'development' || !connection) return false;
  try { const url = new URL(connection); return ['127.0.0.1','localhost','::1'].includes(url.hostname) && url.pathname === '/golvia_stage'; }
  catch { return false; }
}

export function reviewAuthorized(request: Request, token: string | undefined) {
  if (!token || token.length < 32) return false;
  const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  const a = Buffer.from(supplied), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a,b);
}

export function reviewActor(token: string | undefined, configured: string | undefined) {
  const actor = configured?.trim();
  if (actor && actor.length >= 3 && actor.length <= 120 && !/[\r\n]/.test(actor)) return actor;
  if (!token) return 'local-reviewer';
  return `local-${createHash('sha256').update(token).digest('hex').slice(0, 12)}`;
}

const attempts = new Map<string, number[]>();
export function reviewRateLimited(key: string, now = Date.now(), limit = 30, windowMs = 60_000) {
  const recent = (attempts.get(key) ?? []).filter(time => now - time < windowMs);
  if (recent.length >= limit) { attempts.set(key, recent); return true; }
  recent.push(now); attempts.set(key, recent);
  if (attempts.size > 1000) for (const [entry, times] of attempts) if (!times.some(time => now - time < windowMs)) attempts.delete(entry);
  return false;
}
