import type { Career, UsagePermission } from './types.ts';
import { APPEARANCE_BASIS } from './appearances.ts';

/**
 * A club is only treated as a senior team when its name carries no youth/reserve
 * signal. A bare "II"/"B" suffix is left unknown: it may be a reserve side, but
 * some senior clubs (for example Willem II) use the same suffix.
 */
const YOUTH_SIGNAL = /\b(?:u-?1[5-9]|u-?2[0-3]|youth|academy|reserve|reserves|primavera|juvenil|jugend|jong|castilla|mestalla|women|frauen|femminile)\b/i;
const RESERVE_SUFFIX = /\s(?:ii|b)$/i;

export function classifyTeamLevel(name: string): 'senior' | 'youth' | 'unknown' {
  const value = name.trim();
  if (YOUTH_SIGNAL.test(value)) return 'youth';
  if (RESERVE_SUFFIX.test(value)) return 'unknown';
  return 'senior';
}

export type SelectionCoverage = {
  selections: number;
  players: number;
  careers: number;
  multiSelectionPlayers: number;
  pairs: number;
  sharedPairs: number;
  nonSharedPairs: number;
  mostConnected: { id: string; players: number; careers: number }[];
};

export type CatalogCoverage = {
  catalogClubs: number;
  matchedClubs: number;
  players: number;
  careers: number;
  multiClubPlayers: number;
  catalogPairs: number;
  matchedPairs: number;
  sharedPairs: number;
  catalogPairsWithoutSharedPlayer: number;
  matchedPairsWithoutSharedPlayer: number;
  clubs: { id: string; players: number; careers: number }[];
};

const chooseTwo = (count: number) => count * (count - 1) / 2;

/**
 * Deterministic coverage for any fixed selection pool (clubs and/or national-team
 * country ids). Only careers at already matched selections are counted; unmatched
 * selections contribute no players and therefore stay in the non-shared bucket.
 */
export function selectionCoverage(
  selectionIds: string[],
  careers: Pick<Career, 'playerId' | 'teamId'>[],
  matchedIds?: Set<string>,
  mostConnectedLimit = 10,
): SelectionCoverage {
  const pool = [...new Set(selectionIds)];
  const matched = matchedIds ? new Set([...matchedIds].filter(id => pool.includes(id))) : new Set(pool);
  const selectionPlayers = new Map<string, Set<string>>();
  const selectionCareers = new Map<string, number>();
  const playerSelections = new Map<string, Set<string>>();
  for (const career of careers) {
    if (!matched.has(career.teamId)) continue;
    if (!selectionPlayers.has(career.teamId)) selectionPlayers.set(career.teamId, new Set());
    selectionPlayers.get(career.teamId)!.add(career.playerId);
    selectionCareers.set(career.teamId, (selectionCareers.get(career.teamId) ?? 0) + 1);
    if (!playerSelections.has(career.playerId)) playerSelections.set(career.playerId, new Set());
    playerSelections.get(career.playerId)!.add(career.teamId);
  }
  const shared = new Set<string>();
  let multiSelectionPlayers = 0;
  for (const selections of playerSelections.values()) {
    if (selections.size < 2) continue;
    multiSelectionPlayers++;
    const list = [...selections].sort();
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) shared.add(`${list[i]}|${list[j]}`);
  }
  const pairs = chooseTwo(matched.size);
  return {
    selections: matched.size,
    players: playerSelections.size,
    careers: [...selectionCareers.values()].reduce((sum, value) => sum + value, 0),
    multiSelectionPlayers,
    pairs,
    sharedPairs: shared.size,
    nonSharedPairs: pairs - shared.size,
    mostConnected: pool
      .map(id => ({ id, players: selectionPlayers.get(id)?.size ?? 0, careers: selectionCareers.get(id) ?? 0 }))
      .filter(row => row.careers > 0)
      .sort((a, b) => b.players - a.players || b.careers - a.careers || a.id.localeCompare(b.id))
      .slice(0, Math.max(1, mostConnectedLimit)),
  };
}

/** Club-catalog view kept for the Transfermarkt extract and existing tests. */
export function catalogCoverage(
  catalogIds: string[],
  careers: Pick<Career, 'playerId' | 'teamId'>[],
  matchedIds?: Set<string>,
): CatalogCoverage {
  const catalog = [...new Set(catalogIds)];
  const coverage = selectionCoverage(catalog, careers, matchedIds, catalog.length);
  return {
    catalogClubs: catalog.length,
    matchedClubs: coverage.selections,
    players: coverage.players,
    careers: coverage.careers,
    multiClubPlayers: coverage.multiSelectionPlayers,
    catalogPairs: chooseTwo(catalog.length),
    matchedPairs: coverage.pairs,
    sharedPairs: coverage.sharedPairs,
    catalogPairsWithoutSharedPlayer: chooseTwo(catalog.length) - coverage.sharedPairs,
    matchedPairsWithoutSharedPlayer: coverage.nonSharedPairs,
    clubs: catalog.map(id => {
      const row = coverage.mostConnected.find(club => club.id === id);
      return { id, players: row?.players ?? 0, careers: row?.careers ?? 0 };
    }),
  };
}

/** Evidence class is about data accuracy, never about live-usage permission. */
export type CareerEvidenceClass = 'appearance-supported' | 'transfer-only' | 'ambiguous';
export type CareerReviewClass = 'approved' | 'rejected' | 'pending' | 'hold' | 'none';
export type CareerLicenseClass = UsagePermission | 'unknown';

export function classifyCareerEvidence(
  career: Pick<Career, 'appeared' | 'verified' | 'sourceId' | 'evidenceId' | 'provenance'>,
): CareerEvidenceClass {
  const provenance = career.provenance ?? {};
  if (provenance.basis === 'transfer-record') return 'transfer-only';
  const appearances = Number(provenance.appearances ?? 0);
  const separateEvidence = Boolean(career.evidenceId && career.evidenceId !== career.sourceId);
  const wikidataAppearance = provenance.basis === APPEARANCE_BASIS && appearances >= 1;
  if (career.appeared && (wikidataAppearance || (provenance.evidence === 'appearance-rows' && appearances >= 1) || separateEvidence)) return 'appearance-supported';
  return 'ambiguous';
}

export type CareerSummary = {
  total: number;
  evidence: Record<CareerEvidenceClass, number>;
  review: Record<CareerReviewClass, number>;
  license: Record<CareerLicenseClass, number>;
  /** Verified appearance evidence plus a cleared source; the database view is the final gate. */
  playable: number;
  candidates: number;
  candidateLicenseUnresolved: number;
};

export type CareerSummaryOptions = {
  sourceStatus?: Map<string, CareerLicenseClass>;
  reviewStatus?: Map<string, CareerReviewClass>;
  teamPlayable?: (teamId: string) => boolean;
};

const emptyCounts = <K extends string>(keys: K[]): Record<K, number> => Object.fromEntries(keys.map(key => [key, 0])) as Record<K, number>;

/**
 * Classifies accuracy, review state and usage permission independently. A career
 * may be real and still have unresolved usage permission, or be approved and still
 * stay out of the live pool until the source is cleared.
 */
export function summarizeCareers(
  careers: Pick<Career, 'id' | 'playerId' | 'teamId' | 'appeared' | 'verified' | 'sourceId' | 'evidenceId' | 'provenance'>[],
  options: CareerSummaryOptions = {},
): CareerSummary {
  const summary: CareerSummary = {
    total: careers.length,
    evidence: emptyCounts(['appearance-supported', 'transfer-only', 'ambiguous']),
    review: emptyCounts(['approved', 'rejected', 'pending', 'hold', 'none']),
    license: emptyCounts(['cleared', 'unresolved', 'blocked', 'unknown']),
    playable: 0,
    candidates: 0,
    candidateLicenseUnresolved: 0,
  };
  for (const career of careers) {
    summary.evidence[classifyCareerEvidence(career)]++;
    const review = options.reviewStatus?.get(career.id) ?? 'none';
    summary.review[review]++;
    const license = options.sourceStatus?.get(career.sourceId) ?? 'unknown';
    summary.license[license]++;
    if (career.verified && career.appeared && license === 'cleared' && (options.teamPlayable?.(career.teamId) ?? true)) summary.playable++;
    if (career.appeared && !career.verified) {
      summary.candidates++;
      if (license !== 'cleared') summary.candidateLicenseUnresolved++;
    }
  }
  return summary;
}
