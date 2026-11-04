import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match, type Action, type Seat } from '../src/server/game/engine.ts';
import { MatchService } from '../src/server/game/service.ts';
import { parseAction, body, credentials } from '../src/server/http.ts';
import { Pool } from 'pg';
import { FootballRepository } from '../src/server/football/repository.ts';
import { connects, playableOpponents, type Catalog } from '../src/server/football/types.ts';

const catalog: Catalog = { version: 'synthetic', selectionIds: new Set(['club-a', 'club-b', 'country-c']), playerIds: new Set(['correct', 'wrong']), links: new Map([['correct', new Set(['club-a', 'club-b'])]]), labels: new Map([['correct', 'Correct Player']]) };
function send(m: Match, seat: Seat, type: Action['type'], id: string, at: number, requestId = `${type}:${seat}:${at}`) {
  const view = m.view(seat, at);
  return m.act(seat, { type, id, round: view.round, attempt: view.attempt, requestId }, at);
}
function ready(m: Match, at = 0) {
  send(m, 0, 'ready', 'ready', at); send(m, 1, 'ready', 'ready', at);
  assert.equal(m.view(0, at).phase, 'countdown');
  assert.equal(m.view(0, at + 3000).phase, 'select');
}
function pair(m: Match, at = 0, a = 'club-a', b = 'club-b') {
  ready(m, at); send(m, 0, 'choose', a, at + 3001); send(m, 1, 'choose', b, at + 3001);
  assert.equal(m.view(0, at + 6000).phase, 'reveal');
  assert.equal(m.view(0, at + 7799).phase, 'reveal');
  assert.equal(m.view(0, at + 7800).phase, 'answer');
}
test('reviewed fallback searches only relevant playable records and scores a real pair', async () => {
  const pool = new Pool({ connectionString: 'postgres://127.0.0.1:1/unavailable', connectionTimeoutMillis: 300 });
  try {
    const repo = new FootballRepository(pool), real = await repo.catalog();
    assert.equal(connects(real, 'Q11571', 'Q8682', 'Q482764'), true);
    assert.equal(connects(real, 'Q124086', 'Q81888', 'Q495299'), true);
    assert.equal(connects(real, 'Q128912', 'Q15789', 'Q11945'), true);
    assert.equal(connects(real, 'Q128912', 'Q15789', 'Q8682'), false);
    assert.equal(real.playerIds.has('Q1000050'), false);
    assert.deepEqual(await repo.search('player', ''), []);
    assert.deepEqual(await repo.search('player', 'i'), []);
    assert.deepEqual(await repo.search('player', 'ibra'), []); // Zlatan has no reviewed career in this snapshot.
    assert.equal((await repo.search('player', 'Neymar Jr'))[0]?.id, 'Q142794');
    assert.equal((await repo.search('player', 'daley blind'))[0]?.id, 'Q128912');
    assert.equal((await repo.search('selection', 'girona'))[0]?.id, 'Q11945');
    assert.equal((await repo.search('selection', 'schalke')).length, 0);
    assert.equal((await repo.search('selection', 'barça'))[0]?.id, 'Q7156');
    assert.equal((await repo.search('selection', 'münih'))[0]?.id, 'Q15789');
    assert.equal((await repo.search('selection', 'real'))[0]?.id, 'Q8682');
    assert.ok((await repo.search('selection', 'real')).length <= 8);
    for (const a of real.selectionIds) for (const b of playableOpponents(real, a)) assert.ok([...real.links.keys()].some(id => connects(real, id, a, b)));
    const m = new Match(real, 0); pair(m, 0, 'Q8682', 'Q482764');
    assert.equal(send(m, 0, 'answer', 'Q11571', 7800).accepted, true);
    assert.deepEqual(m.view(0, 7800).score, [1, 0]);
    assert.equal(m.view(0, 7800).outcome?.answerName, 'Cristiano Ronaldo');
  } finally { await pool.end(); }
});
test('both players must ready once, then share the same server countdown', () => {
  const m = new Match(catalog, 0);
  assert.equal(m.view(0, 0).phase, 'ready');
  assert.equal(send(m, 0, 'ready', 'ready', 100).accepted, true);
  assert.deepEqual(m.view(1, 100).ready, [true, false]);
  assert.equal(send(m, 0, 'ready', 'ready', 101).code, 'already-ready');
  assert.equal(send(m, 1, 'ready', 'ready', 120).accepted, true);
  assert.equal(m.view(0, 120).deadline, 3120);
  assert.equal(m.view(1, 3119).phase, 'countdown');
  assert.equal(m.view(0, 3120).phase, 'select');
  assert.equal(m.view(0, 6120).phase, 'result');
});
test('ready AFK ends the match without invented points', () => {
  const one = new Match(catalog, 0); send(one, 0, 'ready', 'ready', 1);
  assert.equal(one.view(0, 30000).phase, 'finished'); assert.equal(one.view(0, 30000).winner, 0); assert.deepEqual(one.view(0, 30000).score, [0, 0]);
  const both = new Match(catalog, 0); assert.equal(both.view(0, 30000).winner, null); assert.equal(both.view(0, 30000).outcome?.reason, 'afk');
});
test('choices remain secret until the selection deadline and reveal does not consume answer time', () => {
  const m = new Match(catalog, 0); ready(m);
  send(m, 0, 'choose', 'club-a', 3001); send(m, 1, 'choose', 'club-b', 3001);
  assert.deepEqual(m.view(0, 5999).choices, ['club-a', null]);
  assert.deepEqual(m.view(1, 5999).choices, [null, 'club-b']);
  assert.deepEqual(m.view(0, 6000).choices, ['club-a', 'club-b']);
  assert.equal(m.view(0, 7800).deadline, 22800);
});
test('selection locks after acknowledgement and a late selection cannot rescue it', () => {
  const m = new Match(catalog, 0); ready(m);
  assert.equal(send(m, 0, 'choose', 'club-a', 3001).accepted, true);
  assert.equal(send(m, 0, 'choose', 'club-b', 3002).code, 'already-selected');
  assert.equal(send(m, 1, 'choose', 'club-b', 6000).code, 'wrong-phase');
  assert.equal(m.view(0, 6000).outcome?.reason, 'missing-selection');
  assert.deepEqual(m.view(0, 6000).score, [1, 0]);
});
test('two missing selections produce one visible no-selection result, then require fresh readiness', () => {
  const m = new Match(catalog, 0); ready(m);
  assert.equal(m.view(0, 6000).outcome?.reason, 'no_selection');
  assert.equal(m.view(0, 10999).phase, 'result');
  assert.equal(m.view(0, 11000).phase, 'ready');
  assert.equal(m.view(0, 20000).phase, 'ready');
  assert.deepEqual(m.view(0, 20000).score, [0, 0]);
});
test('same selection returns to preparation for another attempt without points', () => {
  const m = new Match(catalog, 0); ready(m); send(m, 0, 'choose', 'club-a', 3001); send(m, 1, 'choose', 'club-a', 3001);
  assert.equal(m.view(0, 6000).outcome?.reason, 'same-selection');
  const next = m.view(0, 11000); assert.equal(next.phase, 'ready'); assert.equal(next.round, 1); assert.equal(next.attempt, 2);
  assert.equal(m.act(0, { type: 'choose', id: 'club-b', round: 1, attempt: 1, requestId: 'stale' }, 11001).code, 'stale-round');
});
test('first correct answer scores once and includes server-provided answer identity', () => {
  const m = new Match(catalog, 0); pair(m);
  assert.equal(send(m, 0, 'answer', 'correct', 7800).accepted, true);
  assert.deepEqual(m.view(0, 7800).score, [1, 0]); assert.equal(m.view(1, 7800).outcome?.answerName, 'Correct Player');
  assert.equal(send(m, 1, 'answer', 'correct', 7801).code, 'wrong-phase');
});
test('wrong answer consumes one attempt; both wrong end immediately', () => {
  const m = new Match(catalog, 0); pair(m);
  assert.equal(send(m, 0, 'answer', 'wrong', 7800).accepted, true);
  assert.equal(send(m, 0, 'answer', 'correct', 7801).code, 'already-answered');
  assert.equal(send(m, 1, 'answer', 'wrong', 7802).accepted, true);
  assert.equal(m.view(0, 7802).outcome?.reason, 'both-wrong'); assert.deepEqual(m.view(0, 7802).score, [0, 0]);
});
test('answer at the exact deadline is late and result persists for reading', () => {
  const m = new Match(catalog, 0); pair(m);
  assert.equal(send(m, 0, 'answer', 'correct', 22800).code, 'wrong-phase');
  assert.equal(m.view(0, 22800).outcome?.reason, 'timeout');
  assert.equal(m.view(0, 27799).phase, 'result'); assert.equal(m.view(0, 27800).phase, 'ready');
});
test('no common player still gets the full answer phase', () => {
  const m = new Match(catalog, 0); pair(m, 0, 'club-a', 'country-c');
  assert.equal(m.view(0, 22799).phase, 'answer'); assert.equal(m.view(0, 22800).outcome?.reason, 'timeout');
});
test('three server-scored rounds finish the match', () => {
  const m = new Match(catalog, 0); let at = 0;
  for (let round = 1; round <= 3; round++) {
    pair(m, at); send(m, 0, 'answer', 'correct', at + 7800);
    if (round < 3) at = m.view(0, at + 7800).deadline;
  }
  assert.equal(m.view(0, at + 20_000).phase, 'finished'); assert.deepEqual(m.view(0, at + 20_000).score, [3, 0]);
});
test('idempotent retries and conflicting request IDs cannot score twice', () => {
  const m = new Match(catalog, 0); pair(m);
  const action = { type: 'answer', id: 'correct', round: 1, attempt: 1, requestId: 'once' } as const;
  const first = m.act(0, action, 7800);
  assert.deepEqual(m.act(0, action, 7801), first);
  assert.equal(m.act(0, { ...action, id: 'wrong' }, 7801).code, 'request-conflict');
  assert.deepEqual(m.view(0, 7801).score, [1, 0]);
});
test('simultaneous answers serialize to exactly one winner', async () => {
  let now = 0; const service = new MatchService(async () => catalog, () => now); const s = await service.create();
  await Promise.all([0, 1].map(seat => service.transact(s.id, s.tokens[seat], { type: 'ready', id: 'ready', round: 1, attempt: 1, requestId: `ready-${seat}` })));
  now = 3001;
  await Promise.all([0, 1].map(seat => service.transact(s.id, s.tokens[seat], { type: 'choose', id: seat ? 'club-b' : 'club-a', round: 1, attempt: 1, requestId: `choose-${seat}` })));
  now = 7800;
  const answers = await Promise.all([0, 1].map(seat => service.transact(s.id, s.tokens[seat], { type: 'answer', id: 'correct', round: 1, attempt: 1, requestId: `answer-${seat}` })));
  assert.equal(answers.filter(result => result.receipt?.accepted).length, 1);
  assert.equal(answers[1].view.score[0] + answers[1].view.score[1], 1);
});
test('practice bot readies and picks only an answerable hidden opponent', async () => {
  let now = 0; const service = new MatchService(async () => catalog, () => now); const s = await service.create(true);
  await service.transact(s.id, s.tokens[0], { type: 'ready', id: 'ready', round: 1, attempt: 1, requestId: 'ready' });
  assert.equal((await service.transact(s.id, s.tokens[0])).view.phase, 'countdown');
  now = 3001;
  const chosen = await service.transact(s.id, s.tokens[0], { type: 'choose', id: 'club-a', round: 1, attempt: 1, requestId: 'choose' });
  assert.deepEqual(chosen.view.choices, ['club-a', null]);
  now = 6000; assert.deepEqual((await service.transact(s.id, s.tokens[0])).view.choices, ['club-a', 'club-b']);
});
test('parser rejects client-owned score, clock, seat and malformed ready actions', async () => {
  const readyAction = { type: 'ready', id: 'ready', requestId: 'abc', round: 1, attempt: 1 };
  assert.equal(parseAction(readyAction).type, 'ready');
  for (const extra of [{ score: 3 }, { now: 0 }, { seat: 1 }, { correct: true }, { round: -1 }, { type: 'finish' }, { id: 'other' }]) assert.throws(() => parseAction({ ...readyAction, ...extra }));
  assert.throws(() => credentials(new Request('http://localhost/api/practice')));
  const req = (text: string, origin = 'http://localhost') => new Request('http://localhost/api/practice', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: text });
  await assert.rejects(body(req('{}', 'https://foreign.example')), /kaynağı/);
  await assert.rejects(body(req('{')), /JSON/);
});
