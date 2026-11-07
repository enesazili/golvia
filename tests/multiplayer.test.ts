import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { io as client, type Socket } from 'socket.io-client';
import { createSocketServer } from '../src/server/socketServer.ts';
import { MatchService } from '../src/server/game/service.ts';
import { Matchmaking } from '../src/server/matchmaking.ts';

test('route retains server metadata and delegates hooks to a client boundary', async () => {
  const source = await readFile(new URL('../src/app/oyun/3-2-1/page.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.ok(ast.statements.some(s => ts.isVariableStatement(s) && s.declarationList.declarations.some(d => d.name.getText(ast) === 'metadata')));
  assert.doesNotMatch(source, /use client|useState|useEffect/);
  assert.match(source, /<GameClient/);
  const component = await readFile(new URL('../src/features/game/game-client.tsx', import.meta.url), 'utf8');
  assert.match(component, /^'use client'/); assert.match(component, /useQuickMatch/); assert.match(component, /PracticeGame/);
});

test('two real sockets match, keep choices private, score once and cancel explicitly', { timeout: 12000 }, async () => {
  let now = 0;
  const service = new MatchService(async () => ({ version: 'synthetic', selectionIds: new Set(['a', 'b']), playerIds: new Set(['p']), links: new Map([['p', new Set(['a', 'b'])]]) }), () => now);
  const server = createSocketServer(service);
  server.httpServer.listen(0, '127.0.0.1'); await once(server.httpServer, 'listening');
  const address = server.httpServer.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const a = client(url, { autoConnect: false, reconnection: false }), b = client(url, { autoConnect: false, reconnection: false });
  try {
    const aReady = socketOnce<string>(a, 'playerId'), bReady = socketOnce<string>(b, 'playerId'); a.connect(); b.connect();
    const [[aId], [bId]] = await Promise.all([aReady, bReady]); assert.notEqual(aId, bId);
    const matchedA = socketOnce(a, 'matchFound'), matchedB = socketOnce(b, 'matchFound');
    a.emit('quickMatch'); b.emit('quickMatch');
    const [[ma], [mb]] = await Promise.all([matchedA, matchedB]); assert.equal(ma.matchId, mb.matchId); assert.notEqual(ma.seat, mb.seat); assert.equal(ma.tokens, undefined);
    const before = await a.timeout(2000).emitWithAck('getState', { matchId: ma.matchId });
    assert.equal(before.view.phase, 'ready');
    const ready = { type: 'ready', id: 'ready', requestId: 'ready', round: 1, attempt: 1 };
    await a.timeout(2000).emitWithAck('playerAction', { matchId: ma.matchId, action: ready });
    const halfway = await b.timeout(2000).emitWithAck('getState', { matchId: mb.matchId });
    assert.equal(halfway.view.phase, 'ready'); assert.equal(halfway.view.ready[ma.seat], true);
    await b.timeout(2000).emitWithAck('playerAction', { matchId: mb.matchId, action: ready });
    assert.equal((await a.timeout(2000).emitWithAck('getState', { matchId: ma.matchId })).view.phase, 'countdown');
    now = 3001;
    const action = (id: string) => ({ type: 'choose', id, requestId: 'selection', round: 1, attempt: 1 });
    let av = await a.timeout(2000).emitWithAck('playerAction', { matchId: ma.matchId, action: action('a') });
    const bv = await b.timeout(2000).emitWithAck('playerAction', { matchId: mb.matchId, action: action('b') });
    assert.equal(av.view.choices[mb.seat], null); assert.equal(bv.view.choices[ma.seat], null);
    now = 7800;
    const answer = { type: 'answer', id: 'p', requestId: 'answer', round: 1, attempt: 1 };
    av = await a.timeout(2000).emitWithAck('playerAction', { matchId: ma.matchId, action: answer });
    const repeated = await a.timeout(2000).emitWithAck('playerAction', { matchId: ma.matchId, action: answer });
    assert.equal(av.view.score[ma.seat], 1); assert.deepEqual(repeated.receipt, av.receipt);
    const spoof = await b.timeout(2000).emitWithAck('playerAction', { matchId: mb.matchId, action: { ...answer, score: 3 } }); assert.equal(spoof.status, 400);
    const cancelled = socketOnce(b, 'matchCancelled'); a.emit('quitQueue'); await cancelled; a.disconnect();
    assert.equal((await b.timeout(2000).emitWithAck('getState', { matchId: mb.matchId })).status, 400);
  } finally { a.disconnect(); b.disconnect(); await new Promise<void>(resolve => server.io.close(() => resolve())); }
});
test('a disconnected player resumes the same match within grace period', { timeout: 12000 }, async () => {
  const service = new MatchService(async () => ({ version: 'synthetic', selectionIds: new Set(['a', 'b']), playerIds: new Set(), links: new Map() }));
  const server = createSocketServer(service); server.httpServer.listen(0, '127.0.0.1'); await once(server.httpServer, 'listening');
  const address = server.httpServer.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const a = client(url), b = client(url); let resumed: Socket | undefined;
  try {
    const session = socketOnce<{ playerId: string; resumeToken: string }>(a, 'session');
    await Promise.all([socketOnce(a, 'playerId'), socketOnce(b, 'playerId')]);
    const [[identity]] = await Promise.all([session]);
    const maPromise = socketOnce(a, 'matchFound'), mbPromise = socketOnce(b, 'matchFound'); a.emit('quickMatch'); b.emit('quickMatch');
    const [[ma], [mb]] = await Promise.all([maPromise, mbPromise]);
    const lost = socketOnce(b, 'opponentDisconnected'); a.disconnect(); await lost;
    assert.equal((await b.timeout(2000).emitWithAck('getState', { matchId: mb.matchId })).status, 200);
    resumed = client(url, { auth: { resumeToken: identity.resumeToken } });
    const resumedSession = socketOnce<{ playerId: string; resumeToken: string }>(resumed, 'session');
    const found = socketOnce(resumed, 'matchFound'), back = socketOnce(b, 'opponentResumed');
    const [[newIdentity], [returned]] = await Promise.all([resumedSession, found, back]);
    assert.equal(newIdentity.playerId, identity.playerId); assert.equal(returned.matchId, ma.matchId);
    assert.equal((await resumed.timeout(2000).emitWithAck('getState', { matchId: ma.matchId })).status, 200);
  } finally { a.disconnect(); b.disconnect(); resumed?.disconnect(); await new Promise<void>(resolve => server.io.close(() => resolve())); }
});
test('cancel during asynchronous match creation cannot pair a player afterward', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const opened: string[] = [], closed: string[] = [];
  const service = new MatchService(async () => { await gate; return { version: 'synthetic', selectionIds: new Set(), playerIds: new Set(), links: new Map() }; }, undefined, {
    async start(record) { opened.push(record.matchId); }, async close(id) { closed.push(id); }, async closeOpen() { return 0; },
  });
  const matching = new Matchmaking(service); const events: unknown[] = [];
  matching.register('a', { notify: (_, data) => events.push(data) });
  matching.register('b', { notify: (_, data) => events.push(data) });
  await matching.enqueue('a');
  const pending = matching.enqueue('b');
  await Promise.resolve();
  matching.dequeue('b');
  release(); await pending;
  assert.equal(events.length, 0);
  assert.deepEqual(closed, opened);
});
test('quitQueue cancels a quickMatch awaiting account validation', { timeout: 6000 }, async () => {
  let release!: () => void;
  const gate = new Promise<string>(resolve => { release = () => resolve('account'); });
  let checks = 0;
  const service = new MatchService(async () => ({ version: 'synthetic', selectionIds: new Set(), playerIds: new Set(), links: new Map() }));
  const server = createSocketServer(service, undefined, () => ++checks <= 2 ? Promise.resolve('account') : gate);
  server.httpServer.listen(0, '127.0.0.1'); await once(server.httpServer, 'listening');
  const address = server.httpServer.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const a = client(url), b = client(url);
  try {
    await Promise.all([socketOnce(a, 'playerId'), socketOnce(b, 'playerId')]);
    let found = 0;
    a.on('matchFound', () => found++); b.on('matchFound', () => found++);
    a.emit('quickMatch'); a.emit('quitQueue'); b.emit('quickMatch');
    await new Promise(resolve => setTimeout(resolve, 30));
    release();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(found, 0);
    const matched = Promise.all([socketOnce(a, 'matchFound'), socketOnce(b, 'matchFound')]);
    a.emit('quickMatch');
    await matched;
    assert.equal(found, 2);
  } finally { a.disconnect(); b.disconnect(); await new Promise<void>(resolve => server.io.close(() => resolve())); }
});
test('opponent is notified when reconnection grace expires', async () => {
  const service = new MatchService(async () => ({ version: 'synthetic', selectionIds: new Set(), playerIds: new Set(), links: new Map() }));
  const matching = new Matchmaking(service); const notices: string[] = [];
  matching.register('a', { notify: () => {} }); matching.register('b', { notify: event => notices.push(event) });
  await matching.enqueue('a'); await matching.enqueue('b');
  matching.handleDisconnect('a', 10);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(notices, ['matchFound', 'opponentDisconnected', 'matchCancelled']);
});

test('development socket accepts the phone LAN HTTP origin', async () => {
  const service = new MatchService(async () => ({ version: 'synthetic', selectionIds: new Set(), playerIds: new Set(), links: new Map() }));
  const server = createSocketServer(service); server.httpServer.listen(0, '127.0.0.1'); await once(server.httpServer, 'listening');
  const address = server.httpServer.address(); assert.ok(address && typeof address !== 'string');
  try {
    const origin = 'http://192.168.1.102:3000';
    const response = await fetch(`http://127.0.0.1:${address.port}/socket.io/?EIO=4&transport=polling`, { headers: { origin } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
  } finally { await new Promise<void>(resolve => server.io.close(() => resolve())); }
});

function socketOnce<T = { matchId: string; seat: 0 | 1; tokens?: never }>(socket: Socket, event: string): Promise<[T]> { return new Promise(resolve => socket.once(event, (data: T) => resolve([data]))); }

