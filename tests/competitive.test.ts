import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io as client } from 'socket.io-client';
import { elo, league, type RankedResult } from '../src/lib/rating.ts';
import { MatchService, SessionError } from '../src/server/game/service.ts';
import { Matchmaking } from '../src/server/matchmaking.ts';
import { createSocketServer } from '../src/server/socketServer.ts';
import type { Competition } from '../src/server/competitive/repository.ts';

class MemoryCompetition implements Competition {
  starts: string[] = []; completed: string[] = []; cancelled: string[] = []; fail = false;
  results: RankedResult[] = [];
  async start(id: string) { this.starts.push(id); }
  async complete(id: string, _score?: [number, number], winner: 0 | 1 | null = 0, _at?: number, reason: 'finished' | 'forfeit' = 'finished'): Promise<RankedResult> {
    if (this.fail) throw new Error('database unavailable');
    this.completed.push(id);
    const result: RankedResult = { matchId: id, status: 'completed', reason, winner, before: [1000, 1000], after: [1016, 984] };
    this.results.push(result); return result;
  }
  async cancel(id: string, reason: string): Promise<RankedResult> { this.cancelled.push(id); return { matchId: id, status: 'cancelled', reason }; }
}
async function active(game: ReturnType<typeof setup>) {
  await game.matching.enqueue('a', 'ranked'); await game.matching.enqueue('b', 'ranked');
  const action = { type: 'ready' as const, id: 'ready', round: 1, attempt: 1, requestId: 'ready' };
  await game.matching.transact('a', game.id(), action);
  await game.matching.transact('b', game.id(), action);
}
function setup() {
  let now = 0;
  const store = new MemoryCompetition();
  const service = new MatchService(async () => ({ version: 'synthetic', selectionIds: new Set(['a', 'b']), playerIds: new Set(['p']), links: new Map([['p', new Set(['a', 'b'])]]) }), () => now);
  const matching = new Matchmaking(service, store);
  let matchId = '';
  const finalViews: { view: { phase: string; score: number[] } }[] = [];
  const notify = (event: string, data: unknown) => { if (event === 'matchFound') matchId = (data as { matchId: string }).matchId; if (event === 'rankedResult') finalViews.push(data as typeof finalViews[number]); };
  matching.register('a', { accountId: 'account-a', notify });
  matching.register('b', { accountId: 'account-b', notify });
  return { store, service, matching, finalViews, id: () => matchId, time: (value: number) => { now = value; } };
}
async function win(game: ReturnType<typeof setup>, beforeFinal?: () => void) {
  for (let round = 1; round <= 3; round++) {
    const at = (round - 1) * 13000; game.time(at);
    const action = (type: 'ready' | 'choose' | 'answer', id: string) => ({ type, id, round, attempt: 1, requestId: `${round}:${type}` });
    await game.matching.transact('a', game.id(), action('ready', 'ready'));
    await game.matching.transact('b', game.id(), action('ready', 'ready'));
    game.time(at + 3000);
    await game.matching.transact('a', game.id(), action('choose', 'a'));
    await game.matching.transact('b', game.id(), action('choose', 'b'));
    game.time(at + 7800);
    if (round === 3) beforeFinal?.();
    await game.matching.transact('a', game.id(), action('answer', 'p'));
  }
}

test('standard K=32 ELO handles wins, losses, draws, rounding and zero floor', () => {
  assert.equal(elo(1000, 1000, 1), 1016); assert.equal(elo(1000, 1000, 0), 984);
  assert.equal(elo(1000, 1000, 0.5), 1000);
  assert.equal(elo(1200, 1000, 1), 1208); assert.equal(elo(1000, 1200, 1), 1024);
  assert.equal(elo(0, 0, 0), 0);
  assert.throws(() => elo(-1, 1000, 1));
  assert.deepEqual([0, 899, 900, 1099, 1100, 1299, 1300, 1499, 1500, 1799, 1800].map(league), ['Bronz', 'Bronz', 'Gümüş', 'Gümüş', 'Altın', 'Altın', 'Platin', 'Platin', 'Elmas', 'Elmas', 'Usta']);
});
test('ranked queue rejects guests and duplicate account sockets; casual queue stays separate', async () => {
  const game = setup();
  game.matching.register('guest', { notify: () => {} });
  await assert.rejects(game.matching.enqueue('guest', 'ranked'), /doğrulanmış/);
  await game.matching.enqueue('a', 'ranked');
  game.matching.register('other-tab', { accountId: 'account-a', notify: () => {} });
  await assert.rejects(game.matching.enqueue('other-tab', 'ranked'), /zaten/);
  await game.matching.enqueue('guest'); assert.equal(game.id(), '');
  await game.matching.enqueue('b', 'ranked'); assert.ok(game.id());
  assert.equal(game.store.starts.length, 1);
  await game.matching.dequeue('a'); assert.equal(game.store.cancelled.length, 1); assert.equal(game.store.completed.length, 0);
});
test('server finalizes ranked result once despite parallel polling and repeated actions', async () => {
  const game = setup(); await game.matching.enqueue('a', 'ranked'); await game.matching.enqueue('b', 'ranked');
  await win(game);
  const results = await Promise.all(Array.from({ length: 8 }, () => game.matching.transact('a', game.id())));
  assert.equal(game.store.completed.length, 1);
  assert.equal(game.finalViews.length, 2);
  for (const final of game.finalViews) { assert.equal(final.view.phase, 'finished'); assert.deepEqual(final.view.score, [3, 0]); }
  for (const result of results) { assert.equal(result.view.winner, 0); assert.equal(result.ranked?.after?.[0], 1016); }
  await game.matching.dequeue('b'); assert.equal(game.store.cancelled.length, 0, 'completed result is preserved on exit');
});
test('database failure never returns ranked success and a later poll persists the same result', async () => {
  const game = setup(); await game.matching.enqueue('a', 'ranked'); await game.matching.enqueue('b', 'ranked');
  await assert.rejects(win(game, () => { game.store.fail = true; }), /database unavailable/);
  await assert.rejects(game.matching.dequeue('a'), /database unavailable/);
  game.store.fail = false;
  assert.equal((await game.matching.transact('b', game.id())).ranked?.status, 'completed');
  assert.equal(game.store.completed.length, 1);
});
test('an uncertain start commit is reconciled as cancellation before the account can be rated', async () => {
  const game = setup();
  game.store.start = async id => { game.store.starts.push(id); throw new Error('lost commit response'); };
  await game.matching.enqueue('a', 'ranked');
  await assert.rejects(game.matching.enqueue('b', 'ranked'), /lost commit response/);
  await game.matching.sweep();
  assert.deepEqual(game.store.cancelled, game.store.starts);
  assert.equal(game.store.completed.length, 0);
});
test('a pending finished result survives the live engine session TTL during a database outage', async () => {
  const game = setup(); await game.matching.enqueue('a', 'ranked'); await game.matching.enqueue('b', 'ranked');
  await assert.rejects(win(game, () => { game.store.fail = true; }), /database unavailable/);
  game.time(31 * 60000); game.store.fail = false;
  await game.matching.sweep();
  assert.equal(game.store.completed.length, 1); assert.equal(game.store.cancelled.length, 0);
});
test('a revoked waiting account cannot repeatedly poison the ranked queue', async () => {
  const game = setup(); let attempts = 0;
  game.store.start = async () => { attempts++; throw new SessionError(403, 'Account revoked'); };
  await game.matching.enqueue('a', 'ranked');
  await assert.rejects(game.matching.enqueue('b', 'ranked'), /revoked/);
  game.matching.register('c', { accountId: 'account-c', notify: () => {} });
  await game.matching.enqueue('c', 'ranked');
  assert.equal(attempts, 1);
});
test('casual, friendly and practice games never enter the rating repository', async () => {
  const game = setup(); await game.matching.enqueue('a'); await game.matching.enqueue('b'); await win(game);
  await game.matching.dequeue('a');
  game.time(0);
  await game.matching.enqueue('a', 'friendly'); await game.matching.enqueue('b', 'friendly');
  await win(game);
  await game.service.create(true);
  assert.deepEqual([game.store.starts, game.store.completed, game.store.cancelled], [[], [], []]);
});
test('AFK and expired reconnection grace cancel ranked games without ELO', async () => {
  const game = setup(); await game.matching.enqueue('a', 'ranked'); await game.matching.enqueue('b', 'ranked');
  game.time(30001); await game.matching.sweep(); assert.equal(game.store.cancelled.length, 1); assert.equal(game.store.completed.length, 0);
  await game.matching.dequeue('a');
  await game.matching.enqueue('a', 'ranked'); await game.matching.enqueue('b', 'ranked');
  game.matching.handleDisconnect('a', 5);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(game.store.cancelled.length, 2); assert.equal(game.store.completed.length, 0);
});
test('active quit is one forfeit; duplicate quits and later disconnect cannot rate twice', async () => {
  const game = setup(); await active(game);
  const [first] = await Promise.all([game.matching.dequeue('a'), game.matching.dequeue('a')]);
  assert.equal(first?.reason, 'forfeit'); assert.equal(first?.winner, 1);
  game.matching.handleDisconnect('a', 5);
  assert.equal(game.store.completed.length, 1); assert.equal(game.store.cancelled.length, 0);
});
test('reconnecting within the grace resumes the active ranked match', async () => {
  const game = setup(); await active(game);
  game.matching.handleDisconnect('a', 20);
  game.matching.register('a', { accountId: 'account-a', notify: () => {} });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(game.store.completed.length, 0); assert.equal(game.store.cancelled.length, 0);
  assert.ok((await game.matching.transact('a', game.id())).view);
});
test('expired disconnect forfeits once, while two absent players cancel without a winner', async () => {
  const solo = setup(); await active(solo);
  solo.matching.handleDisconnect('a', 5); solo.matching.handleDisconnect('a', 5);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(solo.store.results[0]?.reason, 'forfeit'); assert.equal(solo.store.results[0]?.winner, 1);
  assert.equal(solo.store.completed.length, 1);
  const late: RankedResult[] = [];
  solo.matching.register('a', { accountId: 'account-a', notify: (event, data) => { if (event === 'rankedResult') late.push(data as RankedResult); } });
  assert.equal(late[0]?.reason, 'forfeit'); assert.equal(late[0]?.winner, 1);
  const both = setup(); await active(both);
  both.matching.handleDisconnect('a', 5); both.matching.handleDisconnect('b', 5);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(both.store.completed.length, 0); assert.equal(both.store.cancelled.length, 1);
});
test('simultaneous intentional departures cancel; completed games ignore later disconnect', async () => {
  const both = setup(); await active(both);
  await Promise.all([both.matching.dequeue('a'), both.matching.dequeue('b')]);
  assert.equal(both.store.completed.length, 0); assert.equal(both.store.cancelled.length, 1);
  const finished = setup(); await finished.matching.enqueue('a', 'ranked'); await finished.matching.enqueue('b', 'ranked'); await win(finished);
  finished.matching.handleDisconnect('a', 5);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(finished.store.completed.length, 1); assert.equal(finished.store.cancelled.length, 0);
});
test('real socket refuses unauthenticated ranked access and client supplied user IDs', { timeout: 5000 }, async () => {
  const game = setup(); const server = createSocketServer(game.service, undefined, async () => null, {}, undefined, game.store);
  server.httpServer.listen(0, '127.0.0.1'); await once(server.httpServer, 'listening');
  const address = server.httpServer.address(); assert.ok(address && typeof address !== 'string');
  const socket = client(`http://127.0.0.1:${address.port}`, { autoConnect: false, reconnection: false });
  try {
    const ready = new Promise<void>(resolve => socket.once('playerId', () => resolve())); socket.connect(); await ready;
    assert.equal((await socket.timeout(1000).emitWithAck('quickMatch', { kind: 'ranked' })).status, 401);
    assert.equal((await socket.timeout(1000).emitWithAck('quickMatch', { kind: 'ranked', userId: 'account-a' })).status, 400);
    assert.equal(game.store.starts.length, 0);
  } finally { socket.disconnect(); await new Promise<void>(resolve => server.io.close(() => resolve())); }
});
