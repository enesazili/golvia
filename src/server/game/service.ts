import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Match, type Action, type Seat } from './engine.ts';
import { playableOpponents, type Catalog } from '../football/types.ts';
import { NoopJournal, type MatchJournal } from '../matchJournal.ts';
export class SessionError extends Error { constructor(public readonly status: number, message: string) { super(message); } }
type Session = { match: Match; catalog: Catalog; tokens: [string, string]; expires: number; queue: Promise<unknown>; practice: boolean; lastNow: number; closed: boolean };

/**
 * One process owns live game state. Phase 5 persists lifecycle only (see matchJournal.ts):
 * a restart closes unfinished matches instead of promising a resume that does not exist.
 */
export class MatchService {
  private readonly sessions = new Map<string, Session>();
  constructor(
    private readonly loadCatalog: () => Promise<Catalog>,
    private readonly clock: () => number = () => performance.timeOrigin + performance.now(),
    private readonly journal: MatchJournal = new NoopJournal(),
  ) {}
  async create(practice = false) {
    this.cleanup();
    if (this.sessions.size >= 500) throw new SessionError(503, 'Oturum kapasitesi dolu.');
    const catalog = await this.loadCatalog();
    if (this.sessions.size >= 500) throw new SessionError(503, 'Oturum kapasitesi dolu.');
    const now = this.clock();
    const id = randomUUID();
    const tokens: [string, string] = [randomBytes(32).toString('hex'), randomBytes(32).toString('hex')];
    const session: Session = { match: new Match(catalog, now), catalog, tokens, expires: now + 30 * 60_000, queue: Promise.resolve(), practice, lastNow: now, closed: false };
    try { await this.journal.start({ matchId: id, mode: practice ? 'practice' : 'versus', createdAt: now, expiresAt: session.expires }); }
    catch {
      // Production must not silently run untracked matches; local development keeps the JSON fallback usable.
      if (process.env.NODE_ENV === 'production') throw new SessionError(503, 'Maç kaydı oluşturulamadı.');
    }
    this.sessions.set(id, session);
    return { id, tokens, view: session.match.view(0, now) };
  }
  private cleanup() {
    const now = this.clock();
    for (const [id, s] of this.sessions) if (s.expires <= now) { this.sessions.delete(id); this.closeJournal(id, 'expired'); }
  }
  private closeJournal(id: string, reason: string) {
    void this.journal.close(id, reason).catch(() => console.error('Golvia match journal close failed'));
  }
  private settle(id: string, session: Session, view: { phase: string }) {
    if (session.closed || view.phase !== 'finished') return;
    session.closed = true;
    this.closeJournal(id, 'finished');
  }
  cancel(id: string) {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    if (!session.closed) this.closeJournal(id, 'cancelled');
  }
  async transact(id: string, token: string, action?: Action) {
    const s = this.sessions.get(id);
    if (!s || s.expires <= this.clock()) { if (s) { this.sessions.delete(id); this.closeJournal(id, 'expired'); } throw new SessionError(404, 'Oturum sona erdi. Yeni antrenman başlat.'); }
    const candidate = Buffer.from(token);
    const seat = s.tokens.findIndex(t => candidate.length === Buffer.byteLength(t) && timingSafeEqual(candidate, Buffer.from(t))) as Seat | -1;
    if (seat === -1) throw new SessionError(403, 'Bu oturuma erişim yok.');
    const task = s.queue.then(() => {
      if (this.sessions.get(id) !== s) throw new SessionError(404, 'Oturum sona erdi.');
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
      this.settle(id, s, view);
      return { view, receipt };
    });
    s.queue = task.catch(() => undefined);
    return task;
  }
  /** Closes every live match and its journal rows. Live game state is never restored. */
  async shutdown(reason = 'server-restart') {
    for (const [id, session] of this.sessions) if (!session.closed) { session.closed = true; this.closeJournal(id, reason); }
    this.sessions.clear();
    await this.journal.closeOpen(reason).catch(() => undefined);
  }
}
