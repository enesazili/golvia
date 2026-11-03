import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io as client } from 'socket.io-client';
import { socketOrigins } from '../src/server/config.ts';
import { accountConfiguration } from '../src/server/auth.ts';
import { createSocketServer } from '../src/server/socketServer.ts';
import { MatchService } from '../src/server/game/service.ts';
import { hasAccountCookie } from '../src/server/socketAuth.ts';
import { FootballRepository } from '../src/server/football/repository.ts';
import type { Pool } from 'pg';

test('production origins require HTTPS and reject an unrelated origin', () => {
  const previous = { mode: process.env.NODE_ENV, publicOrigin: process.env.GOLVIA_PUBLIC_ORIGIN, wsOrigins: process.env.WS_ORIGINS };
  try {
    Object.assign(process.env, { NODE_ENV: 'production' });
    delete process.env.GOLVIA_PUBLIC_ORIGIN;
    assert.throws(() => socketOrigins());
    process.env.GOLVIA_PUBLIC_ORIGIN = 'http://golvia.example';
    assert.throws(() => socketOrigins());
    process.env.GOLVIA_PUBLIC_ORIGIN = 'https://golvia.example';
    process.env.WS_ORIGINS = 'http://unsafe.example';
    assert.throws(() => socketOrigins());
    process.env.WS_ORIGINS = 'https://second.example';
    assert.deepEqual([...socketOrigins()], ['https://golvia.example', 'https://second.example']);
  } finally {
    for (const [key, value] of Object.entries({ NODE_ENV: previous.mode, GOLVIA_PUBLIC_ORIGIN: previous.publicOrigin, WS_ORIGINS: previous.wsOrigins })) {
      if (value === undefined) delete process.env[key]; else Object.assign(process.env, { [key]: value });
    }
  }
});

test('account service stays unavailable without a real secret, origin, database and mail', () => {
  const keys = ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'SMTP_URL', 'SMTP_FROM'] as const;
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    assert.equal(accountConfiguration().ready, false);
    process.env.DATABASE_URL = 'postgresql://local.invalid/golvia';
    process.env.BETTER_AUTH_SECRET = 'replace-with-32-or-more-random-characters';
    process.env.BETTER_AUTH_URL = 'https://golvia.example';
    process.env.SMTP_URL = 'smtps://local.invalid';
    process.env.SMTP_FROM = 'Golvia <no-reply@golvia.example>';
    assert.equal(accountConfiguration().ready, false);
  } finally {
    for (const key of keys) { const value = original[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('production football repository fails closed when PostgreSQL is unavailable', async () => {
  const previous = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: 'production' });
  const unavailable = { connect: async () => { const error = new Error('database unavailable') as Error & { code: string }; error.code = 'ECONNREFUSED'; throw error; } } as unknown as Pool;
  try { await assert.rejects(new FootballRepository(unavailable).catalog(), /database unavailable/); }
  finally { if (previous === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV'); else Object.assign(process.env, { NODE_ENV: previous }); }
});

test('socket readiness and foreign WebSocket origin fail closed', { timeout: 6000 }, async () => {
  const service = new MatchService(async () => ({ version: 'synthetic', selectionIds: new Set(), playerIds: new Set(), links: new Map() }));
  const server = createSocketServer(service, async () => false);
  server.httpServer.listen(0, '127.0.0.1'); await once(server.httpServer, 'listening');
  const address = server.httpServer.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const socket = client(url, { autoConnect: false, reconnection: false, transports: ['websocket'], extraHeaders: { Origin: 'https://untrusted.example' } });
  try {
    assert.equal((await fetch(`${url}/health/live`)).status, 200);
    assert.equal((await fetch(`${url}/health/ready`)).status, 503);
    const failure = new Promise<void>(resolve => socket.once('connect_error', () => resolve())); socket.connect(); await failure;
    assert.equal(socket.connected, false);
  } finally { socket.disconnect(); await new Promise<void>(resolve => server.io.close(() => resolve())); }
});

test('account-bound socket refuses revoked actions and cross-account resume', { timeout: 6000 }, async () => {
  assert.equal(hasAccountCookie('other=1; better-auth.session_token=abc'), true);
  let valid = true;
  const service = new MatchService(async () => ({ version: 'synthetic', selectionIds: new Set(), playerIds: new Set(), links: new Map() }));
  const server = createSocketServer(service, async () => true, async cookie => valid ? cookie?.split('=')[1] ?? null : null);
  server.httpServer.listen(0, '127.0.0.1'); await once(server.httpServer, 'listening');
  const address = server.httpServer.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const a = client(url, { extraHeaders: { Cookie: 'better-auth.session_token=account-a' }, transports: ['websocket'] });
  let b: ReturnType<typeof client> | undefined;
  try {
    const session = await new Promise<{ playerId: string; resumeToken: string }>(resolve => a.once('session', resolve));
    valid = false;
    assert.equal((await a.timeout(2000).emitWithAck('getState', { matchId: 'forged' })).status, 401);
    a.disconnect(); valid = true;
    b = client(url, { extraHeaders: { Cookie: 'better-auth.session_token=account-b' }, auth: { resumeToken: session.resumeToken, accountId: 'account-a' }, transports: ['websocket'] });
    const other = await new Promise<{ playerId: string; resumeToken: string }>(resolve => b!.once('session', resolve));
    assert.notEqual(other.playerId, session.playerId);
  } finally { a.disconnect(); b?.disconnect(); await new Promise<void>(resolve => server.io.close(() => resolve())); }
});

async function listening(server: ReturnType<typeof createSocketServer>) {
  server.httpServer.listen(0, '127.0.0.1'); await once(server.httpServer, 'listening');
  const address = server.httpServer.address(); assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}
const syntheticService = () => new MatchService(async () => ({ version: 'synthetic', selectionIds: new Set(), playerIds: new Set(), links: new Map() }));
const waitForError = (socket: ReturnType<typeof client>) => new Promise<void>(resolve => socket.once('connect_error', () => resolve()));
const waitForConnect = (socket: ReturnType<typeof client>) => new Promise<void>(resolve => socket.once('connect', () => resolve()));

test('socket rejects connections above the per-IP admission limit', { timeout: 8000 }, async () => {
  const server = createSocketServer(syntheticService(), async () => true, async () => null, { maxPerIp: 1, maxConnections: 10, handshakesPerMinute: 100 });
  const url = await listening(server);
  const first = client(url, { autoConnect: false, reconnection: false, transports: ['websocket'] });
  const second = client(url, { autoConnect: false, reconnection: false, transports: ['websocket'] });
  try {
    const ready = waitForConnect(first); first.connect(); await ready;
    const rejected = waitForError(second); second.connect(); await rejected;
    assert.equal(second.connected, false);
  } finally { first.disconnect(); second.disconnect(); await new Promise<void>(resolve => server.io.close(() => resolve())); }
});

test('socket rejects handshake bursts from one address', { timeout: 8000 }, async () => {
  const server = createSocketServer(syntheticService(), async () => true, async () => null, { maxPerIp: 50, maxConnections: 50, handshakesPerMinute: 2 });
  const url = await listening(server);
  const sockets = [0, 1, 2].map(() => client(url, { autoConnect: false, reconnection: false, transports: ['websocket'] }));
  try {
    const firstReady = waitForConnect(sockets[0]); sockets[0].connect(); await firstReady;
    const secondReady = waitForConnect(sockets[1]); sockets[1].connect(); await secondReady;
    const rejected = waitForError(sockets[2]); sockets[2].connect(); await rejected;
    assert.equal(sockets[2].connected, false);
  } finally { for (const socket of sockets) socket.disconnect(); await new Promise<void>(resolve => server.io.close(() => resolve())); }
});

test('socket rejects connections above the per-account limit', { timeout: 8000 }, async () => {
  const server = createSocketServer(syntheticService(), async () => true, async cookie => cookie?.split('=')[1] ?? null, { maxPerAccount: 1, maxPerIp: 20, maxConnections: 20, handshakesPerMinute: 100 });
  const url = await listening(server);
  const cookie = { Cookie: 'better-auth.session_token=shared-account' };
  const first = client(url, { autoConnect: false, reconnection: false, transports: ['websocket'], extraHeaders: cookie });
  const second = client(url, { autoConnect: false, reconnection: false, transports: ['websocket'], extraHeaders: cookie });
  try {
    const ready = waitForConnect(first); first.connect(); await ready;
    const rejected = waitForError(second); second.connect(); await rejected;
    assert.equal(second.connected, false);
  } finally { first.disconnect(); second.disconnect(); await new Promise<void>(resolve => server.io.close(() => resolve())); }
});

test('shutdown closes live matches so no stale resume is offered', async () => {
  const now = 0;
  const service = new MatchService(async () => ({ version: 'synthetic', selectionIds: new Set(['a']), playerIds: new Set(['p']), links: new Map([['p', new Set(['a'])]]) }), () => now);
  const created = await service.create();
  await service.shutdown('server-restart');
  await assert.rejects(service.transact(created.id, created.tokens[0]), (error: { status: number }) => error.status === 404, 'a restarted process must not resume an in-memory match');
});
