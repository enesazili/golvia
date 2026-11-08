import { connects, type Catalog } from '../football/types.ts';
export type Seat = 0 | 1;
export type Phase = 'ready' | 'countdown' | 'select' | 'reveal' | 'answer' | 'result' | 'finished';
export type Action = { requestId: string; round: number; attempt: number; type: 'ready' | 'choose' | 'answer'; id: string };
export type Receipt = { accepted: boolean; code: string; revision: number };
export type Outcome = { round: number; reason: 'correct' | 'timeout' | 'missing-selection' | 'no_selection' | 'same-selection' | 'afk'; winner: Seat | null; choices: [string | null, string | null]; answerId?: string; answerName?: string };
export type View = { phase: Phase; round: number; attempt: number; revision: number; score: [number, number]; choices: [string | null, string | null]; ready: [boolean, boolean]; answered: [boolean, boolean]; deadline: number; serverNow: number; winner: Seat | null; outcome: Outcome | null; datasetVersion: string };
type State = Omit<View, 'serverNow' | 'datasetVersion'>;
const READY_MS = 30_000, COUNTDOWN_MS = 3000, SELECT_MS = 3000, REVEAL_MS = 1800, ANSWER_MS = 15_000, RESULT_MS = 5000;

/** Pure synchronous state machine. Call only inside the server session's serialized boundary. */
export class Match {
  private state: State;
  private readonly receipts = new Map<string, { fingerprint: string; receipt: Receipt }>();
  private readonly lastAnswer: [number, number] = [-Infinity, -Infinity];
  constructor(private readonly catalog: Catalog, startedAt: number) {
    this.state = { phase: 'ready', round: 1, attempt: 1, revision: 1, score: [0, 0], choices: [null, null], ready: [false, false], answered: [false, false], deadline: startedAt + READY_MS, winner: null, outcome: null };
  }
  private ready(at: number, newRound: boolean) {
    const s = this.state;
    if (newRound) { s.round++; s.attempt = 1; } else s.attempt++;
    s.phase = 'ready'; s.choices = [null, null]; s.ready = [false, false]; s.answered = [false, false]; s.outcome = null; s.deadline = at + READY_MS; s.revision++;
  }
  private finish(reason: Outcome['reason'], winner: Seat | null, at: number, answerId?: string) {
    const s = this.state;
    s.outcome = { round: s.round, reason, winner, choices: [...s.choices], ...(answerId ? { answerId, answerName: this.catalog.labels?.get(answerId) } : {}) };
    if (winner !== null && reason !== 'afk') s.score[winner]++;
    s.winner = reason === 'afk' ? winner : s.score[0] >= 3 ? 0 : s.score[1] >= 3 ? 1 : null;
    s.phase = reason === 'afk' || s.winner !== null ? 'finished' : 'result';
    s.deadline = at + RESULT_MS; s.revision++;
  }
  advance(now: number): void {
    const s = this.state;
    // Anchor transitions to server deadlines; delayed polling cannot extend a phase.
    while (s.phase !== 'finished' && now >= s.deadline) {
      const at = s.deadline;
      if (s.phase === 'ready') this.finish('afk', s.ready[0] === s.ready[1] ? null : s.ready[0] ? 0 : 1, at);
      else if (s.phase === 'countdown') { s.phase = 'select'; s.deadline = at + SELECT_MS; s.revision++; }
      else if (s.phase === 'select') {
        const [a, b] = s.choices;
        if (!a && !b) this.finish('no_selection', null, at);
        else if (a && a === b) this.finish('same-selection', null, at);
        else if (!a || !b) this.finish('missing-selection', !a ? 1 : 0, at);
        else { s.phase = 'reveal'; s.deadline = at + REVEAL_MS; s.revision++; }
      } else if (s.phase === 'reveal') { s.phase = 'answer'; s.deadline = at + ANSWER_MS; s.revision++; }
      else if (s.phase === 'answer') this.finish('timeout', null, at);
      else this.ready(at, s.outcome?.reason !== 'same-selection');
    }
  }
  act(seat: Seat, action: Action, now: number): Receipt {
    if (seat !== 0 && seat !== 1) throw new Error('Unknown seat');
    this.advance(now);
    const s = this.state;
    const key = `${seat}:${action.requestId}`;
    const fingerprint = JSON.stringify([action.round, action.attempt, action.type, action.id]);
    const existing = this.receipts.get(key);
    if (existing) return existing.fingerprint === fingerprint ? { ...existing.receipt } : { accepted: false, code: 'request-conflict', revision: s.revision };
    let code = 'ok';
    if (this.receipts.size >= 2048) code = 'request-limit';
    else if (s.phase === 'finished') code = 'match-finished';
    else if (action.round !== s.round || action.attempt !== s.attempt) code = 'stale-round';
    else if (action.type === 'ready') {
      if (s.phase !== 'ready') code = 'wrong-phase';
      else if (s.ready[seat]) code = 'already-ready';
      else {
        s.ready[seat] = true; s.revision++;
        if (s.ready.every(Boolean)) { s.phase = 'countdown'; s.deadline = now + COUNTDOWN_MS; s.revision++; }
      }
    } else if (action.type === 'choose') {
      if (s.phase !== 'select') code = 'wrong-phase';
      else if (!this.catalog.selectionIds.has(action.id)) code = 'unknown-selection';
      else if (s.choices[seat]) code = 'already-selected';
      else { s.choices[seat] = action.id; s.revision++; }
    } else if (action.type === 'answer') {
      if (s.phase !== 'answer') code = 'wrong-phase';
      else if (now - this.lastAnswer[seat] < 350) code = 'answer-too-fast';
      else if (!this.catalog.playerIds.has(action.id)) code = 'unknown-player';
      else {
        this.lastAnswer[seat] = now;
        s.answered[seat] = true; s.revision++;
        if (connects(this.catalog, action.id, s.choices[0]!, s.choices[1]!)) this.finish('correct', seat, now, action.id);
        else code = 'incorrect';
      }
    } else code = 'invalid-action';
    const receipt = { accepted: code === 'ok' || code === 'incorrect', code, revision: s.revision };
    if (code !== 'request-limit') this.receipts.set(key, { fingerprint, receipt });
    return { ...receipt };
  }
  view(seat: Seat, now: number): View {
    this.advance(now);
    const copy: View = { ...structuredClone(this.state), serverNow: now, datasetVersion: this.catalog.version };
    if (copy.phase === 'select') copy.choices[seat === 0 ? 1 : 0] = null;
    return copy;
  }
}
