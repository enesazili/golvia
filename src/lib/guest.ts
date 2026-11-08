export function guestName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  return name.length >= 2 && name.length <= 24 && /^[\p{L}\p{M}\p{N} ._-]+$/u.test(name) ? name : null;
}
