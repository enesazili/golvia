import type { MatchProof } from './evidence.ts';

/**
 * Canonical 25-candidate pilot. Decisions are derived only from the tracked
 * input list and the proof ledger; no proof is hardcoded in the runner.
 */
export type PilotItem = {
  careerId: string; playerId: string; player: string; birthDate: string;
  clubId: string; club: string; candidateSource: string;
  newPairsAtScreening: number; possiblePairsAtScreening: number;
};
export type PilotInput = { version: string; scope: string; note: string; items: PilotItem[] };
export type PilotDecision = {
  item: PilotItem; decision: 'approved' | 'hold'; reason: string; proof?: MatchProof;
};

export const PILOT_HOLD_REASON = 'İlk eleme: Wikidata P54 adayı. Bağımsız resmî A takım maç kanıtı henüz insan tarafından doğrulanmadı.';
export const PILOT_APPROVE_REASON = 'Resmî tamamlanmış erkek A takım maçında oyuncunun sahaya çıktığı ve doğum tarihinin bağımsız kulüp profilinde eşleştiği elle kontrol edildi.';

export function validatePilotInput(value: unknown): asserts value is PilotInput {
  const input = value as PilotInput;
  if (!input || typeof input !== 'object' || typeof input.version !== 'string' || !input.version ||
      typeof input.scope !== 'string' || !Array.isArray(input.items) || input.items.length === 0) throw new Error('Geçersiz pilot girdisi');
  const ids = new Set<string>();
  for (const item of input.items) {
    if (!item || typeof item !== 'object' || typeof item.careerId !== 'string' || !/^wd-statement-[Qq]\d+-[a-zA-Z0-9-]+$/.test(item.careerId) ||
        typeof item.playerId !== 'string' || typeof item.clubId !== 'string' || !item.playerId || !item.clubId ||
        typeof item.player !== 'string' || typeof item.birthDate !== 'string' || typeof item.club !== 'string' ||
        typeof item.candidateSource !== 'string' || !item.candidateSource.startsWith('https://')) throw new Error('Geçersiz pilot adayı');
    if (ids.has(item.careerId)) throw new Error('Pilot adayı yineleniyor');
    ids.add(item.careerId);
  }
}

export function pilotDecisions(input: PilotInput, proofs: MatchProof[]): PilotDecision[] {
  validatePilotInput(input);
  const byCareer = new Map<string, MatchProof[]>();
  for (const proof of proofs) {
    const list = byCareer.get(proof.candidateCareerId) ?? [];
    list.push(proof);
    byCareer.set(proof.candidateCareerId, list);
  }
  return input.items.map(item => {
    const matches = byCareer.get(item.careerId) ?? [];
    if (matches.length > 1) throw new Error(`Aday için birden fazla kanıt var: ${item.careerId}`);
    if (!matches.length) return { item, decision: 'hold', reason: PILOT_HOLD_REASON };
    const proof = matches[0];
    if (proof.playerId !== item.playerId || proof.teamId !== item.clubId) throw new Error(`Kanıt kimliği adayla uyuşmuyor: ${item.careerId}`);
    if (proof.evidence.kind !== 'completed-match-event') throw new Error(`Pilot onayı tamamlanmış maç olayı gerektiriyor: ${item.careerId}`);
    if (!proof.identityUrl || !proof.identityNote || proof.identityNote.trim().length < 40) throw new Error(`Bağımsız kimlik kanıtı eksik: ${item.careerId}`);
    if (!proof.sourceNote || proof.sourceNote.trim().length < 40) throw new Error(`Kaynak inceleme notu eksik: ${item.careerId}`);
    if (!proof.matchId || !proof.matchDate || !proof.competition) throw new Error(`Maç kimliği/tarihi/yarışması eksik: ${item.careerId}`);
    return { item, decision: 'approved', reason: PILOT_APPROVE_REASON, proof };
  });
}
