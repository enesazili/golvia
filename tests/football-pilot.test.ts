import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pilotDecisions, validatePilotInput, type PilotInput } from '../src/server/football/review-pilot.ts';
import type { MatchProof } from '../src/server/football/evidence.ts';

const input = JSON.parse(readFileSync('data/football.review-pilot.json', 'utf8')) as PilotInput;
const proofs = JSON.parse(readFileSync('data/football.match-proofs.json', 'utf8')) as MatchProof[];
const decisions = pilotDecisions(input, proofs);

test('canonical 25-candidate pilot derives the same decisions in a clean run', () => {
  assert.equal(input.items.length, 25);
  assert.equal(decisions.length, 25);
  assert.equal(decisions.filter(d => d.decision === 'approved').length, 2);
  assert.equal(decisions.filter(d => d.decision === 'hold').length, 23);
  assert.deepEqual(decisions.map(d => [d.item.careerId, d.decision]), pilotDecisions(input, proofs).map(d => [d.item.careerId, d.decision]));
  assert.deepEqual(decisions.filter(d => d.decision === 'approved').map(d => d.item.careerId),
    ['wd-statement-Q1185419-DD6D6B44-FFE3-4242-80DB-66331AEA7162', 'wd-statement-Q1185419-a508b8e9-45ee-17d2-8e26-bfa6352fb5d0']);
});

test('pilot input must be unique and well formed', () => {
  assert.throws(() => validatePilotInput({ ...input, items: [...input.items, input.items[0]] }), /yineleniyor/);
  assert.throws(() => validatePilotInput({ ...input, items: [{ ...input.items[0], careerId: 'x' }] }), /adayı/);
});

test('a proof without independent identity, notes or match identity is rejected', () => {
  const item = input.items[0];
  const forged = (): MatchProof => ({
    playerId: item.playerId, playerName: item.player, birthDate: item.birthDate,
    teamId: item.clubId, teamName: item.club, candidateCareerId: item.careerId,
    url: 'https://www.psv.nl/match/1', identityUrl: 'https://www.psv.nl/player/1',
    matchId: 'm1', matchDate: '2024-05-01', competition: 'Eredivisie',
    sourceNote: 'Resmî maç kaydı oyuncunun A takımda oynadığını açıkça gösteriyor.', identityNote: 'Kulübün resmî oyuncu profili doğum tarihini ve tam adı bağımsız doğruluyor.',
    checkedAt: '2026-11-04', reason: 'Manuel kontrol edildi ve maç olayı doğrulandı.',
    evidence: { kind: 'completed-match-event', event: 'substituted-on', match: 'Test match' },
  });
  assert.equal(pilotDecisions(input, [...proofs, forged()]).find(d => d.item.careerId === item.careerId)?.decision, 'approved');
  assert.throws(() => pilotDecisions(input, [...proofs, { ...forged(), identityUrl: undefined }]), /kimlik/);
  assert.throws(() => pilotDecisions(input, [...proofs, { ...forged(), sourceNote: '' }]), /notu/);
  assert.throws(() => pilotDecisions(input, [...proofs, { ...forged(), matchId: undefined }]), /Maç kimliği/);
  assert.throws(() => pilotDecisions(input, [...proofs, { ...forged(), playerId: 'Q999' }]), /uyuşmuyor/);
  assert.throws(() => pilotDecisions(input, [...proofs, forged(), forged()]), /birden fazla kanıt/);
});
