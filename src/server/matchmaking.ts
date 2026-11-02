import { MatchService, SessionError } from './game/service.ts';
import type { Action } from './game/engine.ts';
type Peer = { notify: (event: string, data: unknown) => void };
type Pair = { players: [string, string]; tokens: [string, string] };
/** One socket process owns the queue and credentials. */
export class Matchmaking {
  private peers = new Map<string, Peer>();
  private waiting = new Set<string>();
  private matches = new Map<string, Pair>();
  private memberships = new Map<string, string>();
  private epochs = new Map<string, number>();
  private disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly service: MatchService) {}
  register(playerId: string, peer: Peer) {
    const timer = this.disconnectTimers.get(playerId);
    if (timer) { clearTimeout(timer); this.disconnectTimers.delete(playerId); }
    this.peers.set(playerId, peer);
    const matchId = this.memberships.get(playerId), pair = matchId ? this.matches.get(matchId) : undefined;
    if (matchId && pair) {
      const seat = pair.players.indexOf(playerId) as 0 | 1;
      peer.notify('matchFound', { matchId, opponentId: pair.players[1 - seat], seat });
      this.peers.get(pair.players[1 - seat])?.notify('opponentResumed', { matchId });
      return true;
    }
    return false;
  }
  enqueue(playerId: string): Promise<void> {
    const epoch = this.epochs.get(playerId) ?? 0;
    const task = this.queue.then(async () => {
      if (epoch !== (this.epochs.get(playerId) ?? 0) || !this.peers.has(playerId) || this.memberships.has(playerId) || this.waiting.has(playerId)) return;
      const opponent = this.waiting.values().next().value as string | undefined;
      if (!opponent) { this.waiting.add(playerId); return; }
      const opponentEpoch = this.epochs.get(opponent) ?? 0;
      this.waiting.delete(opponent);
      let session;
      try { session = await this.service.create(); }
      catch (error) { if (this.peers.has(opponent)) this.waiting.add(opponent); throw error; }
      if (epoch !== (this.epochs.get(playerId) ?? 0) || opponentEpoch !== (this.epochs.get(opponent) ?? 0) || !this.peers.has(playerId) || !this.peers.has(opponent)) {
        if (this.peers.has(opponent) && opponentEpoch === (this.epochs.get(opponent) ?? 0)) this.waiting.add(opponent);
        if (this.peers.has(playerId) && epoch === (this.epochs.get(playerId) ?? 0)) this.waiting.add(playerId);
        return;
      }
      const players: [string, string] = [opponent, playerId];
      this.matches.set(session.id, { players, tokens: session.tokens });
      players.forEach((id, seat) => {
        this.memberships.set(id, session.id);
        this.peers.get(id)?.notify('matchFound', { matchId: session.id, opponentId: players[1 - seat], seat });
      });
    });
    this.queue = task.catch(() => undefined); return task;
  }
  async transact(playerId: string, matchId: string, action?: Action) {
    const pair = this.matches.get(matchId);
    const seat = pair?.players.indexOf(playerId);
    if (!pair || seat === undefined || seat < 0 || this.memberships.get(playerId) !== matchId) throw new SessionError(403, 'Maça erişim yok.');
    return this.service.transact(matchId, pair.tokens[seat], action);
  }
  dequeue(playerId: string, event = 'matchCancelled') {
    this.epochs.set(playerId, (this.epochs.get(playerId) ?? 0) + 1);
    const timer = this.disconnectTimers.get(playerId);
    if (timer) { clearTimeout(timer); this.disconnectTimers.delete(playerId); }
    this.waiting.delete(playerId);
    const id = this.memberships.get(playerId), pair = id ? this.matches.get(id) : undefined;
    if (id && pair) {
      this.matches.delete(id);
      for (const member of pair.players) { this.memberships.delete(member); if (member !== playerId) this.peers.get(member)?.notify(event, { matchId: id }); }
    }
  }
  handleDisconnect(playerId: string, graceMs = 15000, onExpire?: () => void) {
    this.peers.delete(playerId);
    this.waiting.delete(playerId);
    this.epochs.set(playerId, (this.epochs.get(playerId) ?? 0) + 1);
    const id = this.memberships.get(playerId), pair = id ? this.matches.get(id) : undefined;
    if (!pair) { onExpire?.(); return; }
    this.peers.get(pair.players.find(p => p !== playerId)!)?.notify('opponentDisconnected', { matchId: id, graceMs });
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(playerId);
      this.dequeue(playerId);
      onExpire?.();
    }, graceMs);
    timer.unref?.();
    this.disconnectTimers.set(playerId, timer);
  }
}
