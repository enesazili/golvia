export function publicOrigin() {
  const value = process.env.GOLVIA_PUBLIC_ORIGIN;
  if (!value) {
    if (process.env.NODE_ENV === 'production') throw new Error('GOLVIA_PUBLIC_ORIGIN is required in production');
    return undefined;
  }
  const url = new URL(value);
  if (url.origin !== value || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) throw new Error('GOLVIA_PUBLIC_ORIGIN must be an HTTPS origin in production');
  return url.origin;
}

export function socketOrigins() {
  const origin = publicOrigin();
  const configured = process.env.WS_ORIGINS?.split(',').map(value => value.trim()).filter(Boolean) ?? [];
  if (process.env.NODE_ENV === 'production' && (!origin || configured.some(value => {
    try { const url = new URL(value); return url.protocol !== 'https:' || url.origin !== value; }
    catch { return true; }
  }))) throw new Error('Production socket origins must be HTTPS origins');
  return new Set(origin ? [origin, ...configured] : configured.length ? configured : ['http://127.0.0.1:3000', 'http://localhost:3000', 'http://127.0.0.1:3211', 'http://localhost:3211']);
}
