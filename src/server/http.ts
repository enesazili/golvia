import { SessionError } from './game/service';
import type { Action } from './game/engine';
import { publicOrigin } from './config';
export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}
export function failure(error: unknown) {
  if (error instanceof SessionError) return json({ error: error.message }, error.status);
  console.error('Golvia request failed', { kind: error instanceof Error ? error.name : 'unknown' });
  return json({ error: 'Sunucuya şu anda erişilemiyor.' }, 503);
}
export async function body(request: Request, limit = 2048): Promise<Record<string, unknown>> {
  // Next may normalize request.url to localhost; Host retains the browser's actual origin.
  const expectedOrigin = publicOrigin() ?? `${new URL(request.url).protocol}//${request.headers.get('host') ?? new URL(request.url).host}`;
  if (request.headers.get('origin') !== expectedOrigin) throw new SessionError(403, 'İstek kaynağı doğrulanamadı.');
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new SessionError(415, 'JSON gerekli.');
  const reader = request.body?.getReader();
  if (!reader) throw new SessionError(400, 'İstek boş.');
  let length = 0; const parts: Uint8Array[] = [];
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > limit) { await reader.cancel(); throw new SessionError(413, 'İstek çok büyük.'); } parts.push(value); }
    const data: unknown = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid');
    return data as Record<string, unknown>;
  } catch (error) { if (error instanceof SessionError) throw error; throw new SessionError(400, 'Geçersiz JSON.'); }
}
export function parseAction(data: Record<string, unknown>): Action {
  if (Object.keys(data).some(k => !['requestId', 'round', 'attempt', 'type', 'id'].includes(k)) ||
    typeof data.requestId !== 'string' || !/^[a-zA-Z0-9:-]{1,80}$/.test(data.requestId) ||
    typeof data.id !== 'string' || !/^[a-zA-Z0-9:_-]{1,80}$/.test(data.id) ||
    !Number.isSafeInteger(data.round) || (data.round as number) < 1 || !Number.isSafeInteger(data.attempt) || (data.attempt as number) < 1 ||
    !['ready', 'choose', 'answer'].includes(data.type as string) || (data.type === 'ready' && data.id !== 'ready')) throw new SessionError(400, 'Geçersiz oyuncu eylemi.');
  return data as Action;
}
export function credentials(request: Request) {
  const value = request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith('golvia-practice='))?.slice('golvia-practice='.length);
  if (!value || !/^[0-9a-f-]{36}\.[0-9a-f]{64}$/.test(value)) throw new SessionError(401, 'Önce antrenman başlat.');
  const [id, token] = value.split('.'); return { id, token };
}
