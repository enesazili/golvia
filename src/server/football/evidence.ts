import type { Dataset, Career, Entity, Source } from './types.ts';
import { validateDataset } from './importer.ts';
import { normalize } from './normalize.ts';
import { independentEvidencePages, officialEvidenceUrl } from './evidence-hosts.ts';

export type MatchProof = {
  playerId: string; playerName: string; birthDate: string;
  teamId: string; teamName: string; candidateCareerId: string;
  url: string; identityUrl?: string; checkedAt: string; reason: string;
  matchId?: string; matchDate?: string; competition?: string;
  sourceNote?: string; identityNote?: string;
  evidence: { kind: 'positive-match-count'; matches: number } | { kind: 'completed-match-event'; event: 'goal' | 'substituted-off' | 'substituted-on'; match: string };
};

const forbiddenTeam = /\b(women|female|ladies|reserve|academy|youth|under[- ]?\d{2}|u[- ]?\d{2}|b team|c team|ii|iii)\b|kadın|genç|altyapı/i;
const pair = (a: string, b: string) => [a, b].sort().join('/');

/** A DB review decision stores provenance.reviewObservation; accept it as the same proof. */
function observationMatches(observation: unknown, proof: MatchProof): boolean {
  if (!observation || typeof observation !== 'object') return false;
  const value = observation as Record<string, unknown>;
  if (value.matchUrl !== proof.url || value.identityUrl !== proof.identityUrl) return false;
  if (proof.evidence.kind === 'completed-match-event') return value.event === proof.evidence.event;
  return true;
}

export function mergeMatchProofs(reviewed: Dataset, candidates: Dataset, topClubIds: Set<string>, proofs: MatchProof[]) {
  validateDataset(reviewed); validateDataset(candidates);
  if (reviewed.origin || candidates.origin !== 'wikidata-candidates') throw new Error('Wrong dataset origins');
  const next: Dataset = structuredClone(reviewed);
  const entities = new Map([...candidates.entities, ...reviewed.entities].map(e => [e.id, e]));
  const candidateCareers = new Map(candidates.careers.map(c => [c.id, c]));
  const sourceMap = new Map([...candidates.sources, ...reviewed.sources].map(s => [s.id, s]));
  const reviewedPairs = new Set(next.careers.filter(c => c.verified && c.appeared).map(c => pair(c.playerId, c.teamId)));
  const added: Career[] = [];
  const seenProofs = new Set<string>();
  for (const proof of proofs) {
    const player = entities.get(proof.playerId), team = entities.get(proof.teamId);
    const lead = candidateCareers.get(proof.candidateCareerId);
    const proofKey = pair(proof.playerId, proof.teamId);
    if (seenProofs.has(proofKey)) throw new Error('Duplicate pilot proof');
    seenProofs.add(proofKey);
    if (!player || player.kind !== 'player' || !player.birthDate || player.birthDate !== proof.birthDate ||
      ![player.name, ...player.aliases].some(name => normalize(name) === normalize(proof.playerName))) throw new Error('Player identity mismatch');
    if (!team || team.kind !== 'club' || team.level === 'youth' || !topClubIds.has(team.id) || forbiddenTeam.test(proof.teamName) ||
      ![team.name, ...team.aliases].some(name => normalize(name) === normalize(proof.teamName))) throw new Error('Senior club identity mismatch');
    if (!lead || lead.playerId !== player.id || lead.teamId !== team.id || lead.verified || lead.appeared) throw new Error('Missing unverified P54 lead');
    officialEvidenceUrl(proof.url);
    if (proof.identityUrl) {
      officialEvidenceUrl(proof.identityUrl);
      if (!independentEvidencePages(proof.url, proof.identityUrl)) throw new Error('Independent identity page required');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(proof.checkedAt) || !Number.isFinite(Date.parse(proof.checkedAt)) ||
      proof.checkedAt > new Date().toISOString().slice(0, 10) || proof.reason.trim().length < 20) throw new Error('Missing review detail');
    if (!reviewedPairs.has(proofKey)) {
      if (!proof.identityUrl || !proof.sourceNote || proof.sourceNote.trim().length < 40 ||
          !proof.identityNote || proof.identityNote.trim().length < 40) throw new Error('New proof needs independent identity and review notes');
    }
    if (proof.evidence.kind === 'positive-match-count' ? !Number.isInteger(proof.evidence.matches) || proof.evidence.matches < 1 :
      proof.evidence.kind === 'completed-match-event' ? !proof.evidence.match.trim() || !['goal', 'substituted-off', 'substituted-on'].includes(proof.evidence.event) : true) throw new Error('No positive senior match evidence');
    if (reviewedPairs.has(proofKey)) {
      const existing = next.careers.find(c => c.id === lead.id && c.verified && c.appeared);
      const saved = next.sources.find(s => s.id === existing?.evidenceId);
      const expected = {
        ...proof.evidence, reviewedAt: proof.checkedAt,
        identity: { playerId: player.id, name: proof.playerName, birthDate: proof.birthDate },
        team: { id: team.id, name: proof.teamName }, ...(proof.identityUrl ? { identityUrl: proof.identityUrl } : {}),
        ...(proof.sourceNote ? { sourceNote: proof.sourceNote } : {}), ...(proof.identityNote ? { identityNote: proof.identityNote } : {}),
        reason: proof.reason,
      };
      if (!existing || saved?.url !== proof.url ||
          (JSON.stringify(existing.provenance?.matchProof) !== JSON.stringify(expected) &&
           !observationMatches(existing.provenance?.reviewObservation, proof))) {
        throw new Error('Existing approval conflicts with proof ledger');
      }
      continue;
    }
    if (added.some(c => pair(c.playerId, c.teamId) === proofKey)) throw new Error('Duplicate pilot proof');
    const evidenceId = `match:${proof.playerId}:${proof.teamId}`;
    const evidenceSource: Source = { id: evidenceId, url: proof.url, license: 'reference-only', retrieved: proof.checkedAt };
    if (next.sources.some(s => s.id === evidenceId)) throw new Error('Evidence ID already exists');
    for (const source of [sourceMap.get(lead.sourceId), sourceMap.get(player.sourceId), sourceMap.get(team.sourceId), evidenceSource]) {
      if (!source) throw new Error('Missing source');
      if (!next.sources.some(s => s.id === source.id)) next.sources.push(source);
    }
    for (const entity of [player, team]) if (!next.entities.some(e => e.id === entity.id)) {
      const copy: Entity = structuredClone(entity);
      if (copy.id === team.id) copy.level = 'senior'; // official senior match proves the catalogue club is a first team
      next.entities.push(copy);
    }
    const career: Career = { ...lead, appeared: true, verified: true, evidenceId, provenance: {
      ...lead.provenance, matchProof: { ...proof.evidence, reviewedAt: proof.checkedAt,
        identity: { playerId: player.id, name: proof.playerName, birthDate: proof.birthDate },
        team: { id: team.id, name: proof.teamName }, ...(proof.identityUrl ? { identityUrl: proof.identityUrl } : {}),
        ...(proof.sourceNote ? { sourceNote: proof.sourceNote } : {}), ...(proof.identityNote ? { identityNote: proof.identityNote } : {}),
        reason: proof.reason },
    } };
    next.careers.push(career);
    added.push(career);
    reviewedPairs.add(proofKey);
  }
  next.sources = [...new Map(next.sources.map(s => [s.id, s])).values()];
  validateDataset(next);
  return { dataset: next, added };
}

export function playablePairCount(dataset: Dataset, topClubIds: Set<string>): number {
  const clubs = new Map<string, Set<string>>();
  for (const c of dataset.careers) if (c.verified && c.appeared && topClubIds.has(c.teamId)) {
    const ids = clubs.get(c.playerId) ?? new Set<string>(); ids.add(c.teamId); clubs.set(c.playerId, ids);
  }
  const pairs = new Set<string>();
  for (const ids of clubs.values()) for (const a of ids) for (const b of ids) if (a !== b) pairs.add(pair(a, b));
  return pairs.size;
}
