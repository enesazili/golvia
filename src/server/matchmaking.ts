import { REACTIONS, type Reaction } from '../lib/reactions.ts';
import { randomUUID } from 'node:crypto';
import { MatchService, SessionError } from './game/service.ts';
import type { Action, View } from './game/engine.ts';
import type { Competition } from './competitive/repository.ts';
import type { MatchKind, RankedResult } from '../lib/rating.ts';
type Peer = { notify: (event: string, data: unknown) => void; accountId?: string | null; name?: string };
type Pair = { players: [string, string]; accounts:[string|null,string|null]; names: [string, string]; tokens: [string, string]; kind: MatchKind; started: boolean; quitting: Set<string>; result?: RankedResult; pendingView?: View; queue: Promise<unknown> };
/** One socket process owns the queue and credentials. The database owns ranked results. */
export class Matchmaking {
  private reactionLimits=new Map<string,{at:number;since:number;count:number}>();
  private peers = new Map<string, Peer>();
  private waiting = new Map<string, MatchKind>();
  private matches = new Map<string, Pair>();
  private memberships = new Map<string, string>();
  private accountOwners = new Map<string, string>();
  private inviteReservations=new Map<string,{users:string[];expires:number}>();
  private epochs = new Map<string, number>();
  private disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private disconnectedUntil = new Map<string, number>();
  private recentResults = new Map<string, { result: RankedResult; expires: number }>();
  private pendingCancels = new Map<string, Pick<Competition, 'cancel'>>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly service: MatchService, private readonly competition?: Competition, private readonly friendly?: Pick<Competition,'complete'|'cancel'>) {}
  connected(playerId:string){return this.peers.has(playerId);}
  activity(account: string) {
    const player=this.accountOwners.get(account),id=player?this.memberships.get(player):undefined;
    return id&&!this.matches.get(id)?.result?'in-match' as const:'online' as const;
  }
  busy(account: string, invite?:string) { const owner=this.accountOwners.get(account);return !!owner&&owner!==`invite:${invite}`; }
  releaseInvite(id:string){const reservation=this.inviteReservations.get(id);if(reservation)for(const user of reservation.users)if(this.accountOwners.get(user)===`invite:${id}`)this.accountOwners.delete(user);this.inviteReservations.delete(id);}
  releaseBetween(a:string,b:string){for(const [id,entry]of this.inviteReservations)if(entry.users.includes(a)&&entry.users.includes(b))this.releaseInvite(id);}
  reserveInvite<T>(id:string,users:[string,string],operation:()=>Promise<T>,expires=Date.now()+120000){
    const task=this.queue.then(async()=>{
      if(users.some(user=>this.busy(user,id)))throw new SessionError(409,'Oyunculardan biri müsait değil.');
      users.forEach(user=>this.accountOwners.set(user,`invite:${id}`));this.inviteReservations.set(id,{users,expires});
      try{return await operation();}catch(error){this.releaseInvite(id);throw error;}
    });this.queue=task.catch(()=>undefined);return task;
  }
  private results(pair: Pair) { return pair.kind==='friendly' ? this.friendly : this.competition; }
  private resultEvent(pair: Pair) { return pair.kind==='friendly' ? 'friendlyResult' : 'rankedResult'; }
  async pairFriends(players: [string,string], prepare: (id:string,users:[string,string],at:number)=>Promise<void>, inviteId?:string) {
    const epochs=players.map(id=>this.epochs.get(id)??0);
    const task=this.queue.then(async()=>{
      const accounts=players.map(id=>this.peers.get(id)?.accountId);
      if (!this.friendly || accounts.some(id=>!id) || accounts[0]===accounts[1] || players.some((id,i)=>this.memberships.has(id)||this.waiting.has(id)||(this.epochs.get(id)??0)!==epochs[i]) || accounts.some(id=>this.busy(id!,inviteId))) throw new SessionError(409,'Oyunculardan biri müsait değil.');
      const users=accounts as [string,string]; users.forEach((id,i)=>this.accountOwners.set(id,players[i]));
      let session: Awaited<ReturnType<MatchService['create']>>|undefined;
      try {
        session=await this.service.create();await prepare(session.id,users,session.view.serverNow);
        if(players.some((id,i)=>!this.peers.has(id)||(this.epochs.get(id)??0)!==epochs[i])) throw new SessionError(409,'Oyuncu bağlantısı kesildi.');
        const names=players.map(id=>this.peers.get(id)?.name??'Oyuncu') as [string,string];
        this.matches.set(session.id,{players,accounts:users,names,tokens:session.tokens,kind:'friendly',started:false,quitting:new Set(),queue:Promise.resolve()});
        players.forEach((id,seat)=>{this.memberships.set(id,session!.id);this.peers.get(id)?.notify('matchFound',{matchId:session!.id,opponentId:players[1-seat],opponentName:names[1-seat],opponentAccountId:users[1-seat],seat,kind:'friendly'});});
        if(inviteId)this.releaseInvite(inviteId);return session.id;
      }catch(error){if(session){this.service.cancel(session.id);this.pendingCancels.set(session.id,this.friendly);}if(inviteId)this.releaseInvite(inviteId);players.forEach(id=>this.releaseAccount(id));throw error;}
    });
    this.queue=task.catch(()=>undefined);return task;
  }
  react(playerId:string,matchId:string,emoji:unknown){
    const pair=this.matches.get(matchId);
    if(!pair||this.memberships.get(playerId)!==matchId||!pair.players.includes(playerId)||pair.result||pair.pendingView?.phase==='finished'||pair.quitting.size>0)throw new SessionError(403,'Maça erişim yok.');
    if(typeof emoji!=='string'||!Object.hasOwn(REACTIONS,emoji))throw new SessionError(400,'Geçersiz tepki.');
    const now=Date.now(),previous=this.reactionLimits.get(playerId);
    const slot=previous&&now-previous.since<10000?previous:{at:0,since:now,count:0};
    if(now-slot.at<1500||slot.count>=4)throw new SessionError(429,'Tepkiler arasında biraz bekle.');
    slot.at=now;slot.count++;this.reactionLimits.set(playerId,slot);
    const reaction={id:randomUUID(),matchId,from:playerId,emoji:emoji as Reaction};
    this.peers.get(pair.players.find(player=>player!==playerId)!)?.notify('matchReaction',reaction);
    return reaction;
  }
  register(playerId: string, peer: Peer) {
    const timer = this.disconnectTimers.get(playerId);
    if (timer) { clearTimeout(timer); this.disconnectTimers.delete(playerId); }
    this.disconnectedUntil.delete(playerId);
    this.peers.set(playerId, peer);
    const matchId = this.memberships.get(playerId), pair = matchId ? this.matches.get(matchId) : undefined;
    if (matchId && pair) {
      const seat = pair.players.indexOf(playerId) as 0 | 1;
      peer.notify('matchFound', { matchId, opponentId: pair.players[1 - seat], opponentName: pair.names[1 - seat], opponentAccountId:pair.accounts[1-seat]??undefined, seat, kind: pair.kind });
      if (pair.result) peer.notify(this.resultEvent(pair), pair.result);
      const opponentDeadline = this.disconnectedUntil.get(pair.players[1 - seat]);
      if (opponentDeadline) peer.notify('opponentDisconnected', { matchId, graceMs: Math.max(0, opponentDeadline - Date.now()), deadline: opponentDeadline });
      this.peers.get(pair.players[1 - seat])?.notify('opponentResumed', { matchId });
      return true;
    }
    const recent = this.recentResults.get(playerId);
    if (recent && recent.expires > Date.now()) peer.notify('rankedResult', recent.result);
    return false;
  }
  name(playerId: string, name: string) {
    const peer = this.peers.get(playerId);
    if (peer && !this.memberships.has(playerId) && !this.waiting.has(playerId)) peer.name = name;
  }
  private releaseAccount(playerId: string) {
    for (const [account, owner] of this.accountOwners) if (owner === playerId) this.accountOwners.delete(account);
  }
  enqueue(playerId: string, kind: MatchKind = 'casual'): Promise<void> {
    const epoch = this.epochs.get(playerId) ?? 0;
    const task = this.queue.then(async () => {
      if (epoch !== (this.epochs.get(playerId) ?? 0) || !this.peers.has(playerId) || this.memberships.has(playerId) || this.waiting.has(playerId)) return;
      const account = this.peers.get(playerId)?.accountId;
      if (kind === 'ranked') {
        if (!account) throw new SessionError(401, 'Rekabetçi maç için doğrulanmış hesabınla giriş yap.');
        if (!this.competition) throw new SessionError(503, 'Rekabetçi maç hizmeti kullanılamıyor.');
      }
      if (account) {
        if (this.accountOwners.has(account) && this.accountOwners.get(account)!==playerId) throw new SessionError(409,'Hesabın zaten kuyrukta veya maçta.');
        this.accountOwners.set(account,playerId);
      }
      const opponent = [...this.waiting].find(([id, mode]) => mode === kind && (kind !== 'casual' || !!this.peers.get(id)?.accountId === !!account))?.[0];
      if (!opponent) { this.waiting.set(playerId, kind); return; }
      const opponentEpoch = this.epochs.get(opponent) ?? 0;
      this.waiting.delete(opponent);
      let session: Awaited<ReturnType<MatchService['create']>> | undefined;
      let rankedStarted = false;
      try {
        session = await this.service.create();
        if (kind === 'ranked') {
          await this.competition!.start(session.id, [this.peers.get(opponent)!.accountId!, account!], session.view.serverNow);
          rankedStarted = true;
        }
        if (epoch !== (this.epochs.get(playerId) ?? 0) || opponentEpoch !== (this.epochs.get(opponent) ?? 0) || !this.peers.has(playerId) || !this.peers.has(opponent)) {
          if (rankedStarted) {
            this.pendingCancels.set(session.id,this.competition!);
            await this.competition!.cancel(session.id, 'cancelled');
            this.pendingCancels.delete(session.id);
          }
          this.service.cancel(session.id);
          if (this.peers.has(opponent) && opponentEpoch === (this.epochs.get(opponent) ?? 0)) this.waiting.set(opponent, kind);
          if (this.peers.has(playerId) && epoch === (this.epochs.get(playerId) ?? 0)) this.waiting.set(playerId, kind);
          return;
        }
        const players: [string, string] = [opponent, playerId];
        const matchId = session.id;
        const names = players.map(id => this.peers.get(id)?.name ?? 'Oyuncu') as [string, string];
        this.matches.set(matchId, { players, accounts:players.map(id=>this.peers.get(id)?.accountId??null) as [string|null,string|null], names, tokens: session.tokens, kind, started: false, quitting: new Set(), queue: Promise.resolve() });
        players.forEach((id, seat) => {
          this.memberships.set(id, matchId);
          this.peers.get(id)?.notify('matchFound', { matchId, opponentId: players[1 - seat], opponentName: names[1 - seat], opponentAccountId:this.peers.get(players[1-seat])?.accountId??undefined, seat, kind });
        });
      } catch (error) {
        if (session) {
          this.service.cancel(session.id);
          // A lost COMMIT response may still have created the DB row. Reconcile it on retry.
          if (kind === 'ranked') this.pendingCancels.set(session.id,this.competition!);
        }
        if (error instanceof SessionError && [403, 409].includes(error.status)) {
          this.releaseAccount(opponent);
          this.peers.get(opponent)?.notify('matchError', { message: error.message, status: error.status });
        } else if (this.peers.has(opponent) && opponentEpoch === (this.epochs.get(opponent) ?? 0)) this.waiting.set(opponent, kind);
        this.releaseAccount(playerId);
        throw error;
      }
    });
    this.queue = task.catch(() => undefined); return task;
  }
  private async settle(matchId: string, pair: Pair, view: View) {
    if (!this.results(pair) || !['ranked','friendly'].includes(pair.kind) || pair.result || view.phase !== 'finished') return;
    pair.pendingView = view;
    if (view.outcome?.reason === 'afk' && (pair.quitting.size > 0 || pair.players.some(id => this.disconnectedUntil.has(id)))) return;
    pair.result = view.outcome?.reason === 'afk'
      ? await this.results(pair)!.cancel(matchId, 'afk')
      : await this.results(pair)!.complete(matchId, view.score, view.winner, view.serverNow);
    pair.pendingView = undefined;
    for (const id of pair.players) { this.reactionLimits.delete(id); this.releaseAccount(id); this.peers.get(id)?.notify(this.resultEvent(pair), { ...pair.result, view }); }
  }
  async transact(playerId: string, matchId: string, action?: Action) {
    const pair = this.matches.get(matchId);
    const seat = pair?.players.indexOf(playerId);
    if (!pair || seat === undefined || seat < 0 || this.memberships.get(playerId) !== matchId) throw new SessionError(403, 'Maça erişim yok.');
    const task = pair.queue.then(async () => {
      if (pair.pendingView) await this.settle(matchId, pair, pair.pendingView);
      const result = await this.service.transact(matchId, pair.tokens[seat], action);
      if (result.view.phase !== 'ready' || result.view.round > 1 || result.view.attempt > 1) pair.started = true;
      await this.settle(matchId, pair, result.view);
      return { ...result, kind: pair.kind, ranked: pair.result };
    });
    pair.queue = task.catch(() => undefined);
    return task;
  }
  async dequeue(playerId: string, event = 'matchCancelled', reason = 'cancelled') {
    this.epochs.set(playerId, (this.epochs.get(playerId) ?? 0) + 1);
    const timer = this.disconnectTimers.get(playerId);
    if (timer) { clearTimeout(timer); this.disconnectTimers.delete(playerId); }
    this.waiting.delete(playerId);
    const id = this.memberships.get(playerId), pair = id ? this.matches.get(id) : undefined;
    if (!id || !pair) { this.releaseAccount(playerId); return; }
    if (reason === 'cancelled') pair.quitting.add(playerId);
    const task = pair.queue.then(async () => {
      if (this.matches.get(id) !== pair) return;
      if (reason === 'disconnect' && this.peers.has(playerId)) return;
      if (reason === 'cancelled' && ['ranked','friendly'].includes(pair.kind) && pair.started && !pair.result) await new Promise(resolve => setTimeout(resolve, 100));
      if (['ranked','friendly'].includes(pair.kind) && this.results(pair) && !pair.result) {
        let view: View | undefined;
        try { view = pair.pendingView ?? (await this.service.transact(id, pair.tokens[0])).view; await this.settle(id, pair, view); }
        catch (error) { if (!(error instanceof SessionError && error.status === 404)) throw error; }
        if (!pair.result) {
          const opponent = pair.players.find(member => member !== playerId)!;
          const bothGone = pair.quitting.has(opponent) || !this.peers.has(opponent);
          if (pair.started && view && ['cancelled', 'disconnect'].includes(reason) && !bothGone) {
            pair.result = await this.results(pair)!.complete(id, view.score, pair.players.indexOf(opponent) as 0 | 1, view.serverNow, 'forfeit');
            for (const member of pair.players) this.peers.get(member)?.notify(this.resultEvent(pair), pair.result);
            for (const member of pair.players) if (!this.peers.has(member)) this.recentResults.set(member, { result: pair.result, expires: Date.now() + 30000 });
          } else pair.result = await this.results(pair)!.cancel(id, reason);
        }
      }
      this.matches.delete(id); this.service.cancel(id);
      for (const member of pair.players) {
        this.reactionLimits.delete(member);
        const timer = this.disconnectTimers.get(member); if (timer) { clearTimeout(timer); this.disconnectTimers.delete(member); }
        this.disconnectedUntil.delete(member);
        this.releaseAccount(member); this.memberships.delete(member);
        if (member !== playerId) this.peers.get(member)?.notify(pair.result?.status === 'completed' ? 'matchClosed' : event, { matchId: id, reason: pair.result?.reason });
      }
      return pair.result;
    });
    pair.queue = task.catch(() => undefined);
    return task;
  }
  handleDisconnect(playerId: string, graceMs = 30000, onExpire?: () => void) {
    if (this.disconnectTimers.has(playerId)) return;
    this.peers.delete(playerId); this.waiting.delete(playerId);
    this.epochs.set(playerId, (this.epochs.get(playerId) ?? 0) + 1);
    const id = this.memberships.get(playerId), pair = id ? this.matches.get(id) : undefined;
    if (!pair) { this.releaseAccount(playerId); onExpire?.(); return; }
    if (pair.result) { void this.dequeue(playerId).then(onExpire); return; }
    const deadline = Date.now() + graceMs;
    this.disconnectedUntil.set(playerId, deadline);
    this.peers.get(pair.players.find(p => p !== playerId)!)?.notify('opponentDisconnected', { matchId: id, graceMs, deadline });
    const expire = () => {
      this.disconnectTimers.delete(playerId);
      void this.dequeue(playerId, 'matchCancelled', 'disconnect').then(() => { if (!this.peers.has(playerId)) onExpire?.(); }).catch(() => {
        // Keep ownership until PostgreSQL acknowledges cancellation; retry after an outage.
        const retry = setTimeout(expire, 5000); retry.unref?.(); this.disconnectTimers.set(playerId, retry);
      });
    };
    const timer = setTimeout(expire, graceMs); timer.unref?.(); this.disconnectTimers.set(playerId, timer);
  }
  async sweep() {
    for(const [id,reservation]of this.inviteReservations)if(reservation.expires<=Date.now())this.releaseInvite(id);
    for (const [playerId, recent] of this.recentResults) if (recent.expires <= Date.now()) this.recentResults.delete(playerId);
    for (const [id,repository] of this.pendingCancels) {
      await repository.cancel(id, 'cancelled'); this.pendingCancels.delete(id);
    }
    for (const [id, pair] of this.matches) if (['ranked','friendly'].includes(pair.kind) && this.results(pair) && !pair.result) {
      try { await this.transact(pair.players[0], id); }
      catch (error) { if (error instanceof SessionError && error.status === 404) await this.dequeue(pair.players[0], 'matchCancelled', 'expired'); else throw error; }
    }
  }
}
