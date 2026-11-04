import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeMatchProofs, playablePairCount, type MatchProof } from '../src/server/football/evidence.ts';
import type { Dataset } from '../src/server/football/types.ts';

const read = (file: string) => JSON.parse(readFileSync(`data/${file}`, 'utf8'));
const reviewed = read('football.reviewed.json') as Dataset;
const candidates = read('football-top100-a.json') as Dataset;
const proofs = read('football.match-proofs.json') as MatchProof[];
const ids = new Set((read('club-catalog.top100.json') as { clubs: { id: string }[] }).clubs.map(c => c.id));
const base: Dataset = reviewed;
const NEW_PAIRS = ['wd-statement-Q1185419-DD6D6B44-FFE3-4242-80DB-66331AEA7162',
  'wd-statement-Q1185419-a508b8e9-45ee-17d2-8e26-bfa6352fb5d0'];
const freshBase: Dataset = { ...reviewed, careers: reviewed.careers.filter(c => !NEW_PAIRS.includes(c.id)) };
const merge = (items: MatchProof[]) => mergeMatchProofs(base, candidates, ids, items);
const mergeFresh = (items: MatchProof[]) => mergeMatchProofs(freshBase, candidates, ids, items);

test('official match evidence adds only reviewed A-team links and playable pairs', () => {
  const { dataset, added } = mergeFresh(proofs);
  assert.equal(added.length, 2);
  assert.deepEqual(added.map(c => c.playerId), ['Q1185419', 'Q1185419']);
  assert.ok(playablePairCount(dataset, ids) > playablePairCount(freshBase, ids));
  for (const career of added) {
    assert.equal(career.verified && career.appeared, true);
    assert.equal(dataset.sources.find(s => s.id === career.evidenceId)?.license, 'reference-only');
    assert.notEqual(career.evidenceId, career.sourceId);
  }
  assert.equal(mergeMatchProofs(dataset, candidates, ids, proofs).added.length, 0);
});

test('same name cannot override a different birth identity', () => {
  assert.throws(() => merge([{ ...proofs[0], birthDate: '1991-01-04' }]), /Player identity/);
  assert.throws(() => merge([{ ...proofs[0], playerId: 'Q11571' }]), /Player identity/);
});

test('B team, wrong club and wrong P54 lead are rejected', () => {
  assert.throws(() => merge([{ ...proofs[0], teamName: 'Bayer 04 Leverkusen II' }]), /Senior club/);
  assert.throws(() => merge([{ ...proofs[0], teamId: 'Q7156' }]), /Senior club|P54 lead/);
  assert.throws(() => merge([{ ...proofs[0], candidateCareerId: proofs[1].candidateCareerId }]), /P54 lead/);
});

test('squad or transfer reference cannot assert an appearance', () => {
  assert.throws(() => merge([{ ...proofs[0], evidence: { kind: 'positive-match-count', matches: 0 } }]), /positive senior match/);
  assert.throws(() => merge([{ ...proofs[0], evidence: { kind: 'completed-match-event', event: 'goal', match: '' } }]), /positive senior match/);
});

test('new approvals require independent identity and human notes', () => {
  const fresh = proofs.find(p => p.candidateCareerId === 'wd-statement-Q1185419-DD6D6B44-FFE3-4242-80DB-66331AEA7162')!;
  assert.throws(() => mergeFresh([{ ...fresh, identityUrl: undefined }]), /New proof/);
  assert.throws(() => mergeFresh([{ ...fresh, sourceNote: '' }]), /New proof/);
  assert.throws(() => mergeFresh([{ ...fresh, identityNote: 'kısa' }]), /New proof/);
  assert.equal(mergeFresh([fresh]).added.length, 1);
});

test('source URL and duplicate proofs are checked before approval', () => {
  assert.throws(() => merge([{ ...proofs[0], url: 'https://example.com/game' }]), /Onaylanmamış/);
  assert.throws(() => merge([{ ...proofs[0], url: 'http://www.bayer04.de/game' }]), /Onaylanmamış/);
  assert.throws(() => merge([proofs[0], proofs[0]]), /Duplicate pilot proof/);
  assert.throws(() => mergeMatchProofs(reviewed, candidates, ids, [{ ...proofs[0], reason: 'Changed review reason for an existing approved career' }]), /conflicts with proof ledger/);
});
