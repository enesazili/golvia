import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
const origin = process.env.TEST_BASE_URL;
if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('Set TEST_BASE_URL to the running local Golvia server');
test('competitive HTTP reads validate pagination, protect profiles and expose no client rating write', async () => {
  const board = await fetch(`${origin}/api/competitive?mode=3-2-1&page=1`);
  assert.equal(board.status, 200); assert.equal(board.headers.get('cache-control'), 'no-store');
  assert.ok(Array.isArray((await board.json()).items));
  assert.equal((await fetch(`${origin}/api/competitive?mode=invalid`)).status, 400);
  assert.equal((await fetch(`${origin}/api/competitive?page=-1`)).status, 400);
  assert.equal((await fetch(`${origin}/api/competitive/me`)).status, 401);
  assert.equal((await fetch(`${origin}/api/account/export`)).status, 401);
  const { TERMS_VERSION } = await import('../src/lib/legal.ts');
  assert.equal((await fetch(`${origin}/api/account/terms`, { method: 'POST', headers: { origin: origin!, 'content-type': 'application/json' }, body: JSON.stringify({ termsAccepted: true, termsVersion: TERMS_VERSION }) })).status, 401);
  assert.equal((await fetch(`${origin}/api/competitive`, { method: 'POST', body: JSON.stringify({ elo: 9999 }) })).status, 405);
});
test('HTTP training contract: identity, secrecy, validation, retries and database search', async () => {
  const post = (data: unknown, cookie = '', source = origin) => fetch(`${origin}/api/practice`, { method: 'POST', headers: { origin: source!, 'content-type': 'application/json', cookie }, body: JSON.stringify(data) });
  assert.equal((await fetch(`${origin}/api/practice`)).status, 401);
  assert.equal((await post({ type: 'create' }, '', 'https://invalid.example')).status, 403);
  const created = await post({ type: 'create' }); assert.equal(created.status, 201);
  const setCookie = created.headers.get('set-cookie')!; assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Strict/);
  const cookie = setCookie.split(';')[0]; const data = await created.json();
  assert.equal(data.tokens, undefined); assert.equal(data.view.phase, 'ready'); assert.equal(data.view.choices[1], null);
  const base = { round: data.view.round, attempt: data.view.attempt };
  const prepared = await post({ ...base, type: 'ready', id: 'ready', requestId: 'ready' }, cookie);
  assert.equal(prepared.status, 200); assert.equal((await prepared.json()).view.phase, 'countdown');
  assert.equal((await post({ ...base, type: 'choose', id: 'Q45', requestId: 'spoof', score: 3 }, cookie)).status, 400);
  let view = data.view;
  const selectionEnd = Date.now() + 5000;
  while (view.phase !== 'select' && Date.now() < selectionEnd) { await delay(75); view = (await (await fetch(`${origin}/api/practice`, { headers: { cookie } })).json()).view; }
  assert.equal(view.phase, 'select');
  const choose = await post({ ...base, type: 'choose', id: 'Q45', requestId: 'choose' }, cookie);
  assert.equal(choose.status, 200); assert.equal((await choose.json()).view.choices[1], null);
  const search = await fetch(`${origin}/api/football?kind=player&q=CR7`);
  assert.equal(search.headers.get('cache-control'), 'no-store'); const found = await search.json();
  assert.equal(found.items[0].id, 'Q11571'); assert.equal(found.items[0].links, undefined);
  assert.deepEqual((await (await fetch(`${origin}/api/football?kind=player&q=`)).json()).items, []);
  assert.deepEqual((await (await fetch(`${origin}/api/football?kind=player&q=i`)).json()).items, []);
  assert.deepEqual((await (await fetch(`${origin}/api/football?kind=player&q=ibra`)).json()).items, []);
  assert.ok((await (await fetch(`${origin}/api/football?kind=selection&q=real`)).json()).items.length <= 8);
  assert.equal((await fetch(`${origin}/api/football?kind=invalid`)).status, 400);
  const end = Date.now() + 7000;
  while (view.phase !== 'answer' && Date.now() < end) { await delay(75); view = (await (await fetch(`${origin}/api/practice`, { headers: { cookie } })).json()).view; }
  assert.equal(view.phase, 'answer'); assert.equal(view.choices[0], 'Q45'); assert.ok(view.choices[1]);
  const wrong = { ...base, type: 'answer', id: 'Q615', requestId: 'wrong' };
  const incorrect = await post(wrong, cookie); assert.equal(incorrect.status, 200);
  const feedback = await incorrect.json(); assert.equal(feedback.receipt.code, 'incorrect'); assert.equal(feedback.view.phase, 'answer');
  await delay(400);
  const answer = { ...base, type: 'answer', id: view.choices[1] === 'Q7156' ? 'Q483145' : 'Q11571', requestId: 'answer' };
  const results = await Promise.all(Array.from({ length: 8 }, async () => (await post(answer, cookie)).json()));
  for (const result of results) { assert.deepEqual(result.view.score, [1, 0]); assert.deepEqual(result.receipt, results[0].receipt); }
  assert.equal((await post({ ...answer, requestId: 'second' }, cookie)).status, 409);
  assert.equal((await post({ ...answer, id: 'Q615' }, cookie)).status, 409);
});
