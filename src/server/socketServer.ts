import { createServer } from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Server } from 'socket.io';
import { Pool } from 'pg';
import { Matchmaking } from './matchmaking.ts';
import { MatchService } from './game/service.ts';
import { FootballRepository } from './football/repository.ts';
import { parseAction } from './http.ts';
import { socketOrigins } from './config.ts';
import { socketAccount } from './socketAuth.ts';
import { closeAuth } from './auth.ts';
type AccountResolver = (cookie?: string) => Promise<string | null>;
export function createSocketServer(service: MatchService, readiness: () => Promise<boolean> = async () => true, resolveAccount: AccountResolver = socketAccount) {
  const httpServer = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health/live') { response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end('{"status":"up"}'); return; }
    if (request.method === 'GET' && request.url === '/health/ready') {
      void readiness().then(ready => { response.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify({ status: ready ? 'ready' : 'unavailable' })); }).catch(() => { response.writeHead(503, { 'Cache-Control': 'no-store' }); response.end('{"status":"unavailable"}'); });
      return;
    }
    response.writeHead(404); response.end();
  });
  const origins = socketOrigins();
  const originAllowed = (origin?: string) => {
    if (!origin) return process.env.NODE_ENV !== 'production';
    if (origins.has(origin)) return true;
    try {
      const url = new URL(origin);
      if (process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['3000', '3211'].includes(url.port) && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)) return true;
    } catch { /* Reject malformed origins. */ }
    return false;
  };
  const io = new Server(httpServer, { allowRequest: (request, callback) => callback(null, originAllowed(request.headers.origin)), cors: { origin: (origin, callback) => callback(null, originAllowed(origin)), methods: ['GET', 'POST'] }, maxHttpBufferSize: 4096 });
  const matchmaking = new Matchmaking(service);
  const identities = new Map<string, { playerId: string; socketId: string; expires: number; accountId: string | null }>();
  io.use(async (socket, next) => {
    try { socket.data.accountId = await resolveAccount(socket.handshake.headers.cookie); next(); }
    catch { next(new Error('Oturum doğrulanamadı.')); }
  });
  io.on('connection', socket => {
    const limits = new Map<string, { count: number; reset: number }>();
    const allowed = (key: string, max: number) => {
      const now = Date.now(); const slot = limits.get(key);
      if (!slot || slot.reset <= now) { limits.set(key, { count: 1, reset: now + 10_000 }); return true; }
      slot.count++; return slot.count <= max;
    };
    const candidate = socket.handshake.auth?.resumeToken;
    const resumeToken = typeof candidate === 'string' && identities.has(candidate) && identities.get(candidate)!.expires > Date.now() && !identities.get(candidate)!.socketId && identities.get(candidate)!.accountId === socket.data.accountId
      ? candidate : randomBytes(32).toString('hex');
    const identity = identities.get(resumeToken) ?? { playerId: randomUUID(), socketId: '', expires: Infinity, accountId: socket.data.accountId as string | null };
    identity.socketId = socket.id;
    identity.expires = Infinity;
    identities.set(resumeToken, identity);
    const playerId = identity.playerId;
    socket.data.playerId = playerId;
    const accountAuthorized = async () => !identity.accountId || identity.accountId === await resolveAccount(socket.handshake.headers.cookie);
    socket.emit('session', { playerId, resumeToken });
    matchmaking.register(playerId, { notify: (event, data) => socket.emit(event, data) });
    socket.emit('playerId', playerId);
    socket.on('quickMatch', () => { if (!allowed('quickMatch', 5)) return; void accountAuthorized().then(async valid => { if (valid) await matchmaking.enqueue(playerId); else socket.emit('matchError', { message: 'Oturum sona erdi.' }); }).catch(() => socket.emit('matchError', { message: 'Oturum doğrulanamadı.' })); });
    socket.on('quitQueue', () => matchmaking.dequeue(playerId));
    for (const event of ['getState', 'playerAction']) socket.on(event, async (payload: unknown, ack: unknown) => {
      if (typeof ack !== 'function') return;
      if (!allowed(event, event === 'getState' ? 100 : 20)) { ack({ status: 429, error: 'Çok fazla istek.' }); return; }
      try {
        if (!await accountAuthorized()) { ack({ status: 401, error: 'Oturum sona erdi.' }); return; }
        if (!payload || typeof payload !== 'object' || !('matchId' in payload) || typeof payload.matchId !== 'string') throw new Error('Geçersiz maç.');
        const action = event === 'playerAction' ? parseAction('action' in payload && payload.action && typeof payload.action === 'object' ? payload.action as Record<string, unknown> : {}) : undefined;
        const result = await matchmaking.transact(playerId, payload.matchId, action);
        ack({ ...result, status: result.receipt && !result.receipt.accepted ? 409 : 200 });
      } catch { ack({ status: 400, error: 'Eylem veya maç geçersiz.' }); }
    });
    socket.on('disconnect', () => {
      if (identity.socketId !== socket.id) return;
      identity.socketId = ''; identity.expires = Date.now() + 15000;
      matchmaking.handleDisconnect(playerId, 15000, () => identities.delete(resumeToken));
    });
  });
  return { io, httpServer, matchmaking };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  const repository = new FootballRepository(pool);
  const { io, httpServer } = createSocketServer(new MatchService(() => repository.catalog()), async () => { await pool.query('SELECT 1'); await repository.catalog(); if (process.env.BETTER_AUTH_URL) await pool.query('SELECT 1 FROM golvia_auth."user" LIMIT 1'); return true; });
  httpServer.listen(Number(process.env.WS_PORT ?? 3001), process.env.WS_HOST ?? (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0'), () => console.log('Golvia Socket.IO ready'));
  let stopping = false;
  const stop = () => {
    if (stopping) return; stopping = true;
    io.emit('serverRestarting');
    const deadline = setTimeout(() => process.exit(1), 10_000); deadline.unref?.();
    io.close(() => { void Promise.all([pool.end(), closeAuth()]).then(() => { clearTimeout(deadline); process.exit(0); }); });
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
