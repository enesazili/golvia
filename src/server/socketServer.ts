import { createServer } from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Server } from 'socket.io';
import { Pool } from 'pg';
import { Matchmaking } from './matchmaking.ts';
import { MatchService } from './game/service.ts';
import { FootballRepository } from './football/repository.ts';
import { parseAction } from './http.ts';
export function createSocketServer(service: MatchService) {
  const httpServer = createServer();
  const origins = new Set((process.env.WS_ORIGINS ?? 'http://127.0.0.1:3000,http://localhost:3000,http://127.0.0.1:3211,http://localhost:3211').split(',').map(value => value.trim()));
  const io = new Server(httpServer, { cors: { origin: (origin, callback) => {
    if (!origin || origins.has(origin)) return callback(null, true);
    try {
      const url = new URL(origin);
      if (process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['3000', '3211'].includes(url.port) && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)) return callback(null, true);
    } catch { /* Reject malformed origins. */ }
    callback(new Error('Origin not allowed'));
  }, methods: ['GET', 'POST'] }, maxHttpBufferSize: 4096 });
  const matchmaking = new Matchmaking(service);
  const identities = new Map<string, { playerId: string; socketId: string; expires: number }>();
  io.on('connection', socket => {
    const candidate = socket.handshake.auth?.resumeToken;
    const resumeToken = typeof candidate === 'string' && identities.has(candidate) && identities.get(candidate)!.expires > Date.now() && !identities.get(candidate)!.socketId
      ? candidate : randomBytes(32).toString('hex');
    const identity = identities.get(resumeToken) ?? { playerId: randomUUID(), socketId: '', expires: Infinity };
    identity.socketId = socket.id;
    identity.expires = Infinity;
    identities.set(resumeToken, identity);
    const playerId = identity.playerId;
    socket.data.playerId = playerId;
    socket.emit('session', { playerId, resumeToken });
    matchmaking.register(playerId, { notify: (event, data) => socket.emit(event, data) });
    socket.emit('playerId', playerId);
    socket.on('quickMatch', () => { void matchmaking.enqueue(playerId).catch(() => socket.emit('matchError', { message: 'Eşleşme başlatılamadı.' })); });
    socket.on('quitQueue', () => matchmaking.dequeue(playerId));
    for (const event of ['getState', 'playerAction']) socket.on(event, async (payload: unknown, ack: unknown) => {
      if (typeof ack !== 'function') return;
      try {
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
  const { io, httpServer } = createSocketServer(new MatchService(() => repository.catalog()));
  httpServer.listen(Number(process.env.WS_PORT ?? 3001), process.env.WS_HOST ?? (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0'), () => console.log('Golvia Socket.IO ready'));
  const stop = () => { io.close(() => { void pool.end().then(() => process.exit(0)); }); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
