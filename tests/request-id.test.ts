import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestId } from '../src/features/game/request-id.ts';

test('browser request ID works when randomUUID is unavailable on LAN HTTP', () => {
  let seed = 0;
  const source = { getRandomValues: (bytes: Uint8Array) => { for (let i = 0; i < bytes.length; i++) bytes[i] = seed++; return bytes; } };
  const first = requestId(source), second = requestId(source);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(first, second);
});
test('browser request ID uses randomUUID when available and fails closed without secure randomness', () => {
  assert.equal(requestId({ randomUUID: () => 'provided-id' }), 'provided-id');
  assert.throws(() => requestId({}), /Güvenli rastgelelik/);
});
