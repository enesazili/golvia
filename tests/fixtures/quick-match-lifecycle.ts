import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
const state: unknown[] = [], refs: { current: unknown }[] = [];
let stateIndex = 0, refIndex = 0;
mock.module('react', { namedExports: {
  useState(initial: unknown) { const i = stateIndex++; if (!(i in state)) state[i] = initial; return [state[i], (value: unknown) => { state[i] = value; }]; },
  useRef(initial: unknown) { const i = refIndex++; return refs[i] ??= { current: initial }; },
  useCallback(fn: unknown) { return fn; }, useEffect() {},
} });
let acknowledgement: object = { status: 200 };
class Connection extends EventEmitter {
  io = new EventEmitter(); auth = {}; disconnected = false;
  connect() {} disconnect() { this.disconnected = true; this.emit('disconnect', 'io client disconnect'); }
  timeout() { return this; } async emitWithAck() { return acknowledgement; }
}
const connections: Connection[] = [];
mock.module('socket.io-client', { namedExports: { io() { const socket = new Connection(); connections.push(socket); return socket; } } });
const store = () => { const values = new Map(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }; };
Object.assign(globalThis, { sessionStorage: store(), localStorage: store(), location: { origin: 'https://golvia.test', protocol: 'https:', hostname: 'golvia.test' } });
const { useQuickMatch } = await import('../../src/hooks/useQuickMatch.ts');
function render() {
  stateIndex = 0; refIndex = 0;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- Test driver uses mocked React dispatchers.
  return useQuickMatch();
}
test('finished and forfeit results retain their opponent until dismissed, then new matches start clean', async () => {
  let match = render(); await match.start('ranked');
  const socket = connections.at(-1)!;
  socket.emit('matchFound', { matchId: 'first', opponentId: 'old', opponentName: 'Eski Rakip', seat: 0, kind: 'ranked' });
  socket.emit('opponentDisconnected', { deadline: 10000 });
  socket.emit('rankedResult', { matchId: 'first', status: 'completed', reason: 'forfeit' });
  match = render(); assert.equal(match.opponentName, 'Eski Rakip'); assert.equal(match.status, 'forfeit'); assert.equal(match.opponentId, null);
  acknowledgement = { status: 200, result: { matchId: 'first', status: 'completed', reason: 'forfeit' } };
  assert.equal(await match.cancel(), true);
  match = render(); assert.equal(match.opponentName, 'Rakip'); assert.equal(match.opponentId, null); assert.equal(match.opponentDeadline, null); assert.equal(match.ranked, undefined); assert.equal(match.matchId, null);
  socket.emit('matchFound', { matchId: 'stale', opponentId: 'old', opponentName: 'Stale' });
  await match.start('ranked'); match = render(); assert.equal(match.opponentName, 'Rakip'); assert.equal(match.opponentId, null);
  const next = connections.at(-1)!;
  next.emit('matchFound', { matchId: 'next', opponentId: 'new', opponentName: 'Yeni Rakip', seat: 1, kind: 'ranked' });
  next.emit('rankedResult', { matchId: 'first', status: 'completed', reason: 'forfeit' });
  match = render(); assert.equal(match.opponentName, 'Yeni Rakip'); assert.equal(match.ranked, undefined);
  next.emit('rankedResult', { matchId: 'next', status: 'completed', reason: 'finished' });
  next.emit('matchClosed', { reason: 'finished' });
  acknowledgement = { status: 200 }; assert.equal(await render().cancel(), true); assert.equal(render().opponentName, 'Rakip');
  await render().start('ranked'); const active = connections.at(-1)!;
  active.emit('matchFound', { matchId: 'active', opponentId: 'other', opponentName: 'Diğer', seat: 0, kind: 'ranked' });
  acknowledgement = { status: 200, result: { matchId: 'active', status: 'completed', reason: 'forfeit' } };
  await render().cancel(); assert.equal(render().status, 'forfeit'); assert.equal(render().opponentName, 'Diğer');
  await render().cancel(); assert.equal(render().opponentName, 'Rakip');
  await render().start('ranked'); const cancelled = connections.at(-1)!;
  cancelled.emit('matchFound', { matchId: 'cancelled', opponentId: 'gone', opponentName: 'İptal Rakip', seat: 0, kind: 'ranked' });
  cancelled.emit('opponentDisconnected', { deadline: 20000 }); assert.equal(render().status, 'opponent-wait');
  cancelled.emit('opponentResumed'); assert.equal(render().status, 'matched');
  cancelled.emit('matchCancelled'); assert.equal(render().opponentId, null); assert.equal(render().opponentName, 'Rakip');
  await render().start('ranked'); cancelled.io.emit('reconnect_failed'); assert.equal(render().status, 'queue');

  acknowledgement={status:200};await render().cancel();await render().start('friendly','','fresh-invite');
  const friendly=connections.at(-1)!;
  friendly.emit('matchFound',{matchId:'friendly',opponentId:'peer',opponentName:'Arkadaş',opponentAccountId:'account-friend',seat:0,kind:'friendly'});
  friendly.emit('friendlyResult',{matchId:'friendly',status:'completed',reason:'finished'});
  assert.equal(render().opponentAccountId,'account-friend');assert.equal(render().ranked?.status,'completed');
  await render().cancel();assert.equal(render().opponentAccountId,null);assert.equal(sessionStorage.getItem('golvia:friend-invite'),null);
});
