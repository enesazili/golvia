import { createServer, type RequestListener } from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Server, type Socket } from 'socket.io';
import { SocialRepository } from './social/repository.ts';
import { installSocial } from './social/socket.ts';
import { Pool } from 'pg';
import { Matchmaking } from './matchmaking.ts';
import { MatchService, SessionError } from './game/service.ts';
import { CompetitiveRepository, type Competition } from './competitive/repository.ts';
import { FootballRepository } from './football/repository.ts';
import { PostgresMatchJournal } from './matchJournal.ts';
import { parseAction } from './http.ts';
import { socketOrigins } from './config.ts';
import { socketIdentity } from './socketAuth.ts';
import { guestName } from '../lib/guest.ts';
import { acceptsTerms, TERMS_VERSION } from '../lib/legal.ts';
import { closeAuth } from './auth.ts';
type AccountResolver = (cookie?: string) => Promise<string | { id: string; name: string } | null>;
export type SocketLimits = {
  /** Concurrent connections accepted by this process. */
  maxConnections: number;
  /** Concurrent connections from one client address. */
  maxPerIp: number;
  /** Concurrent connections for one authenticated account. */
  maxPerAccount: number;
  /** Handshake attempts from one client address per minute. */
  handshakesPerMinute: number;
};
const DEFAULT_LIMITS: SocketLimits = { maxConnections: 500, maxPerIp: 20, maxPerAccount: 5, handshakesPerMinute: 60 };

/**
 * Resolves the TCP peer by default. Forwarded headers are only trusted when WS_TRUST_PROXY=true,
 * which is valid only behind a reverse proxy that overwrites the header on every request.
 */
function clientAddress(socket: { handshake: { address?: string; headers: Record<string, string | string[] | undefined> } }) {
  if (process.env.WS_TRUST_PROXY === 'true') {
    const value = socket.handshake.headers['x-real-ip'];
    if (typeof value === 'string' && value.length <= 64 && /^[0-9a-fA-F:.]+$/.test(value)) return value;
  }
  return socket.handshake.address || 'unknown';
}

export function createSocketServer(service: MatchService, readiness: () => Promise<boolean> = async () => true, resolveAccount: AccountResolver = socketIdentity, limits: Partial<SocketLimits> = {},fallbackHandler?: RequestListener, competition?: Competition, social?: SocialRepository) {
  const settings = { ...DEFAULT_LIMITS, ...limits };
  const httpServer = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health/live') { response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end('{"status":"up"}'); return; }
    if (request.method === 'GET' && request.url === '/health/ready') {
      void readiness().then(ready => { response.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify({ status: ready ? 'ready' : 'unavailable' })); }).catch(() => { response.writeHead(503, { 'Cache-Control': 'no-store' }); response.end('{"status":"unavailable"}'); });
      return;
    }
    if (fallbackHandler) {
    fallbackHandler(request, response);
    return;
    }
    response.writeHead(404);
    response.end();
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

  // Process-local admission control. Restart resets these counters and multiple replicas each keep
  // their own; production must therefore run a single socket process (see PROJECT_CONTEXT.md).
  let connections = 0;
  const perIp = new Map<string, number>();
  const perAccount = new Map<string, number>();
  const handshakes = new Map<string, { count: number; reset: number }>();
  const handshakeAllowed = (ip: string) => {
    const now = Date.now(); const slot = handshakes.get(ip);
    if (!slot || slot.reset <= now) { handshakes.set(ip, { count: 1, reset: now + 60_000 }); return true; }
    slot.count++;
    return slot.count <= settings.handshakesPerMinute;
  };
  const release = (accountId: string | null | undefined, ip: string) => {
    connections = Math.max(0, connections - 1);
    const ipCount = (perIp.get(ip) ?? 0) - 1;
    if (ipCount > 0) perIp.set(ip, ipCount); else perIp.delete(ip);
    if (accountId) {
      const accountCount = (perAccount.get(accountId) ?? 0) - 1;
      if (accountCount > 0) perAccount.set(accountId, accountCount); else perAccount.delete(accountId);
    }
  };

  const matchmaking = new Matchmaking(service, competition, social);
  let sweeping = false;
  const sweep = setInterval(() => {
    for (const [token, identity] of identities) if (!identity.socketId && identity.expires <= Date.now()) identities.delete(token);
    if (sweeping) return;
    sweeping = true;
    void matchmaking.sweep().catch(() => { /* Failed persistence stays pending and is retried. */ }).finally(() => { sweeping = false; });
  }, 1000);
  sweep.unref?.(); httpServer.on('close', () => clearInterval(sweep));
  const identities = new Map<string, { playerId: string; socketId: string; expires: number; accountId: string | null; name: string; termsVersion?: string; termsAcceptedAt?: number }>();
  const authenticate=async (socket:Socket,next:(error?:Error)=>void,socialOnly=false)=>{
    const ip = clientAddress(socket);
    if (!handshakeAllowed(ip)) return next(new Error('Çok fazla bağlantı denemesi.'));
    let accountId: string | null = null;
    try { const account = await resolveAccount(socket.handshake.headers.cookie); accountId = typeof account === 'string' ? account : account?.id ?? null; socket.data.name = typeof account === 'object' && account ? account.name.slice(0, 40) : 'Oyuncu'; }
    catch { return next(new Error('Oturum doğrulanamadı.')); }
    if(socialOnly&&!accountId)return next(new Error('Doğrulanmış hesap gerekli.'));
    const existing = identities.get(String(socket.handshake.auth?.resumeToken ?? ''));
    if (!socialOnly && existing?.socketId && existing.accountId === accountId) return next(new Error('Bu oyun oturumu başka bir sekmede açık.'));
    if (connections >= settings.maxConnections) return next(new Error('Sunucu kapasitesi dolu.'));
    if ((perIp.get(ip) ?? 0) >= settings.maxPerIp) return next(new Error('Bu ağdan çok fazla bağlantı.'));
    if (accountId && (perAccount.get(accountId) ?? 0) >= settings.maxPerAccount) return next(new Error('Bu hesaptan çok fazla bağlantı.'));
    connections++; perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    if (accountId) perAccount.set(accountId, (perAccount.get(accountId) ?? 0) + 1);
    socket.data.accountId = accountId;
    socket.data.ip = ip;
    next();
  };
  io.use((socket,next)=>{void authenticate(socket,next);});
  const socialSession=social?installSocial(io,social,matchmaking,resolveAccount,(socket,next)=>{void authenticate(socket,next,true);},release,account=>(perAccount.get(account)??0)>0):undefined;
  io.on('connection', socket => {
    socket.on('disconnect', () => release(socket.data.accountId as string | null | undefined, String(socket.data.ip ?? 'unknown')));
    const limits = new Map<string, { count: number; reset: number }>();
    const allowed = (key: string, max: number) => {
      const now = Date.now(); const slot = limits.get(key);
      if (!slot || slot.reset <= now) { limits.set(key, { count: 1, reset: now + 10_000 }); return true; }
      slot.count++; return slot.count <= max;
    };
    const candidate = socket.handshake.auth?.resumeToken;
    const resumeToken = typeof candidate === 'string' && identities.has(candidate) && identities.get(candidate)!.expires > Date.now() && !identities.get(candidate)!.socketId && identities.get(candidate)!.accountId === socket.data.accountId
      ? candidate : randomBytes(32).toString('hex');
    const identity = identities.get(resumeToken) ?? { playerId: randomUUID(), socketId: '', expires: Infinity, accountId: socket.data.accountId as string | null, name: String(socket.data.name) };
    identity.socketId = socket.id;
    identity.expires = Infinity;
    identities.set(resumeToken, identity);
    const playerId = identity.playerId;
    socket.data.playerId = playerId;
    const accountAuthorized = async () => { if (!identity.accountId) return true; const account = await resolveAccount(socket.handshake.headers.cookie); return identity.accountId === (typeof account === 'string' ? account : account?.id); };
    let queueEpoch = 0;
    socket.emit('session', { playerId, resumeToken });
    matchmaking.register(playerId, { notify: (event, data) => socket.emit(event, data), accountId: identity.accountId, name: identity.name });
    socket.emit('playerId', playerId);
    socket.on('quickMatch', (payload: unknown, ack: unknown) => {
      if (!allowed('quickMatch', 5)) { if (typeof ack === 'function') ack({ status: 429 }); return; }
      const epoch = queueEpoch;
      void (async () => {
        if (payload !== undefined && (!payload || typeof payload !== 'object' || Object.keys(payload).some(k => !['kind', 'name', 'termsAccepted', 'termsVersion'].includes(k)) || !('kind' in payload) || !['casual', 'ranked'].includes(String(payload.kind)))) throw new SessionError(400, 'Geçersiz eşleşme isteği.');
        const kind = payload && typeof payload === 'object' && 'kind' in payload && payload.kind === 'ranked' ? 'ranked' : 'casual';
        if (!await accountAuthorized()) throw new SessionError(401, 'Oturum sona erdi.');
        if (kind === 'ranked' && !identity.accountId) throw new SessionError(401, 'Rekabetçi maç için doğrulanmış hesabınla giriş yap.');
        if (kind === 'casual' && !identity.accountId && identity.termsVersion !== TERMS_VERSION) {
          const name = guestName(payload && typeof payload === 'object' && 'name' in payload ? payload.name : null);
          if (!name || !acceptsTerms(payload)) throw new SessionError(400, 'Oyuncu adını ve koşul kabulünü kontrol et.');
          identity.name = name; identity.termsVersion = TERMS_VERSION; identity.termsAcceptedAt = Date.now(); matchmaking.name(playerId, name);
        }
        if (kind === 'ranked' && !await readiness()) throw new SessionError(503, 'Rekabetçi maç hizmeti kullanılamıyor.');
        if (epoch !== queueEpoch) return;
        await matchmaking.enqueue(playerId, kind);
        if (typeof ack === 'function') ack({ status: 200 });
      })().catch(error => {
        const status = error instanceof SessionError ? error.status : 503;
        const message = error instanceof SessionError ? error.message : 'Eşleşme hizmeti kullanılamıyor.';
        socket.emit('matchError', { message, status }); if (typeof ack === 'function') ack({ status, error: message });
      });
    });
    socket.on('joinFriendMatch',(payload:unknown,ack:unknown)=>{
      if(typeof ack!=='function')return;
      const epoch=queueEpoch;
      void(async()=>{
        if(!allowed('joinFriendMatch',5))throw new SessionError(429,'Biraz bekle.');
        if(!identity.accountId||!socialSession||!await accountAuthorized())throw new SessionError(401,'Doğrulanmış hesap gerekli.');
        if(!payload||typeof payload!=='object'||Object.keys(payload).some(k=>k!=='inviteId')||!('inviteId'in payload)||typeof payload.inviteId!=='string'||payload.inviteId.length>160)throw new SessionError(400,'Geçersiz davet.');
        await socialSession.join(socket,playerId,payload.inviteId,()=>epoch===queueEpoch);ack({status:200});
      })().catch(error=>ack({status:error instanceof SessionError?error.status:503,error:error instanceof SessionError?error.message:'Özel maç başlatılamadı.'}));
    });
    socket.on('quitQueue', (payload: unknown, ack: unknown) => {
      if(payload!==undefined&&(!payload||typeof payload!=='object'||Object.keys(payload).some(key=>key!=='inviteId')||('inviteId'in payload&&(typeof payload.inviteId!=='string'||payload.inviteId.length>160)))){if(typeof ack==='function')ack({status:400});return;}
      const invitation=payload&&typeof payload==='object'&&'inviteId'in payload?String(payload.inviteId):undefined;
      queueEpoch++;
      void (async()=>{if(identity.accountId)await socialSession?.leave(identity.accountId,playerId,invitation);return matchmaking.dequeue(playerId);})().then(result => { if (typeof ack === 'function') ack({ status: 200, result }); })
        .catch(() => { socket.emit('matchError', { status: 503, message: 'Maç iptali kaydedilemedi. Yeniden dene.' }); if (typeof ack === 'function') ack({ status: 503 }); });
    });
    socket.on('matchReaction',async(payload:unknown,ack:unknown)=>{
      if(typeof ack!=='function')return;
      if(!allowed('matchReaction',12)){ack({status:429,error:'Çok fazla tepki.'});return;}
      try{
        if(!await accountAuthorized())throw new SessionError(401,'Oturum sona erdi.');
        if(!payload||typeof payload!=='object'||Object.keys(payload).some(key=>!['matchId','emoji'].includes(key))||!('matchId'in payload)||typeof payload.matchId!=='string'||payload.matchId.length>160)throw new SessionError(400,'Geçersiz tepki.');
        ack({status:200,data:matchmaking.react(playerId,payload.matchId,'emoji'in payload?payload.emoji:null)});
      }catch(error){ack({status:error instanceof SessionError?error.status:503,error:error instanceof SessionError?error.message:'Tepki gönderilemedi.'});}
    });
    for (const event of ['getState', 'playerAction']) socket.on(event, async (payload: unknown, ack: unknown) => {
      if (typeof ack !== 'function') return;
      if (!allowed(event, event === 'getState' ? 100 : 20)) { ack({ status: 429, error: 'Çok fazla istek.' }); return; }
      try {
        if (!await accountAuthorized()) { ack({ status: 401, error: 'Oturum sona erdi.' }); return; }
        if (!payload || typeof payload !== 'object' || !('matchId' in payload) || typeof payload.matchId !== 'string') throw new SessionError(400, 'Geçersiz maç.');
        const action = event === 'playerAction' ? parseAction('action' in payload && payload.action && typeof payload.action === 'object' ? payload.action as Record<string, unknown> : {}) : undefined;
        const result = await matchmaking.transact(playerId, payload.matchId, action);
        ack({ ...result, status: result.receipt && !result.receipt.accepted ? 409 : 200 });
      } catch (error) { ack({ status: error instanceof SessionError && error.status === 503 ? 503 : error instanceof SessionError ? 400 : 503, error: error instanceof SessionError ? error.message : 'Maç sonucu kaydedilemedi. Yeniden denenecek.' }); }
    });
    socket.on('disconnect', () => {
      if (identity.socketId !== socket.id) return;
      identity.socketId = ''; identity.expires = Date.now() + 60000;
      matchmaking.handleDisconnect(playerId, 30000);
    });
  });
  return { io, httpServer, matchmaking };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 3000, statement_timeout: 5000 });
  const repository = new FootballRepository(pool);
  const journal = new PostgresMatchJournal(pool, 'versus');
  const service = new MatchService(() => repository.catalog(), undefined, journal);
  const competition = new CompetitiveRepository(pool);
  await competition.recover();
  const social=new SocialRepository(pool);await social.recover();
  // Any match left open by a previous socket process is over; it cannot be resumed in memory.
  const closed = await journal.recover();
  if (closed) console.log(`Golvia closed ${closed} unfinished matches from a previous process`);
  const { io, httpServer } = createSocketServer(service, async () => { await pool.query('SELECT 1'); await repository.catalog(); if (process.env.BETTER_AUTH_URL) await pool.query('SELECT 1 FROM golvia_auth."user" LIMIT 1'); return true; }, socketIdentity, {}, undefined, competition, social);
  httpServer.listen(Number(process.env.WS_PORT ?? 3001), process.env.WS_HOST ?? (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0'), () => console.log('Golvia Socket.IO ready'));
  let stopping = false;
  const stop = () => {
    if (stopping) return; stopping = true;
    io.emit('serverRestarting');
    const deadline = setTimeout(() => process.exit(1), 10_000); deadline.unref?.();
    io.close(() => { void Promise.all([service.shutdown('server-restart'), pool.end(), closeAuth()]).then(() => { clearTimeout(deadline); process.exit(0); }); });
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
