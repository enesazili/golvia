import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Match, type Action, type Seat } from './engine.ts';
import { playableOpponents, type Catalog } from '../football/types.ts';
export class SessionError extends Error { constructor(public readonly status: number, message: string) { super(message); } }
type Session = { match: Match; catalog: Catalog; tokens: [string, string]; expires: number; queue: Promise<unknown>; practice: boolean; lastNow: number };

/** One process only. Phase 3 must replace this store before multiple workers are enabled. */
export class MatchService {
  private readonly sessions = new Map<string, Session>();
  constructor(private readonly loadCatalog: () => Promise<Catalog>, private readonly clock: () => number = () => performance.timeOrigin + performance.now()) {}
  async create(practice = false) {
    this.cleanup();
    if (this.sessions.size >= 500) throw new SessionError(503, 'Oturum kapasitesi dolu.');
    const catalog = await this.loadCatalog();
    if (this.sessions.size >= 500) throw new SessionError(503, 'Oturum kapasitesi dolu.');
    const now = this.clock();
    const id = randomUUID();
    const tokens: [string, string] = [randomBytes(32).toString('hex'), randomBytes(32).toString('hex')];
    const session: Session = { match: new Match(catalog, now), catalog, tokens, expires: now + 30 * 60_000, queue: Promise.resolve(), practice, lastNow: now };
    this.sessions.set(id, session);
    return { id, tokens, view: session.match.view(0, now) };
  }
  private cleanup() { const now = this.clock(); for (const [id, s] of this.sessions) if (s.expires <= now) this.sessions.delete(id); }
  async transact(id: string, token: string, action?: Action) {
    const s = this.sessions.get(id);
    if (!s || s.expires <= this.clock()) { this.sessions.delete(id); throw new SessionError(404, 'Oturum sona erdi. Yeni antrenman başlat.'); }
    const candidate = Buffer.from(token);
    const seat = s.tokens.findIndex(t => candidate.length === Buffer.byteLength(t) && timingSafeEqual(candidate, Buffer.from(t))) as Seat | -1;
    if (seat === -1) throw new SessionError(403, 'Bu oturuma erişim yok.');
    const task = s.queue.then(() => {
      if (s.expires <= this.clock()) throw new SessionError(404, 'Oturum sona erdi.');
      const now = Math.max(s.lastNow, this.clock()); s.lastNow = now;
      s.match.view(seat, now);
      const receipt = action ? s.match.act(seat, action, now) : undefined;
      if (s.practice && seat === 0 && action?.type === 'ready' && receipt?.accepted) {
        s.match.act(1, { type: 'ready', id: 'ready', round: action.round, attempt: action.attempt, requestId: `bot-ready:${action.round}:${action.attempt}` }, now);
      }
      if (s.practice && seat === 0 && action?.type === 'choose' && receipt?.accepted) {
        const opponents = playableOpponents(s.catalog, action.id);
        // A selection without a known answer repeats the choice phase instead of exposing an empty puzzle.
        const choice = opponents.length ? opponents[randomInt(opponents.length)] : action.id;
        s.match.act(1, { type: 'choose', id: choice, round: action.round, attempt: action.attempt, requestId: `bot:${action.round}:${action.attempt}:${action.requestId}` }, now);
      }
      const view = s.match.view(seat, now);
      return { view, receipt };
    });
    s.queue = task.catch(() => undefined);
    return task;
  }
}
