/**
 * Bulk appearance evidence derived from Wikidata P54 (member of sports team)
 * statements that carry P1350 (number of matches played) >= 1.
 *
 * A P54 statement alone is only membership. The P1350 qualifier is the match
 * count, so it is usable as documented senior A-team appearance evidence when
 * the target team itself is a curated senior club or senior national team.
 * The source is Wikidata structured data, published under CC0-1.0.
 */
export const APPEARANCE_BASIS = 'wikidata-p1350-appearances';

export type AppearanceRow = {
  playerId: string;
  teamId: string;
  statementId: string;
  appearances: number;
  fromYear?: number;
  toYear?: number;
};

export type MergedAppearance = {
  playerId: string;
  teamId: string;
  appearances: number;
  fromYear?: number;
  toYear?: number;
  statementIds: string[];
};

/**
 * Groups multiple membership statements for the same player/team into one
 * career. Distinct statement IDs are summed (separate spells), duplicate rows
 * for the same statement are not. The year range is the outer envelope.
 */
export function mergeAppearanceRows(rows: AppearanceRow[]): MergedAppearance[] {
  const grouped = new Map<string, { appearances: Map<string, number>; from: number[]; to: number[] }>();
  for (const row of rows) {
    if (!row.playerId || !row.teamId || !row.statementId) continue;
    if (!Number.isInteger(row.appearances) || row.appearances < 1) continue;
    const key = `${row.playerId}:${row.teamId}`;
    const group = grouped.get(key) ?? { appearances: new Map<string, number>(), from: [], to: [] };
    group.appearances.set(row.statementId, Math.max(group.appearances.get(row.statementId) ?? 0, row.appearances));
    if (Number.isInteger(row.fromYear)) group.from.push(row.fromYear!);
    if (Number.isInteger(row.toYear)) group.to.push(row.toYear!);
    grouped.set(key, group);
  }
  const merged: MergedAppearance[] = [];
  for (const [key, group] of grouped) {
    const separator = key.indexOf(':');
    const playerId = key.slice(0, separator);
    const teamId = key.slice(separator + 1);
    const statementIds = [...group.appearances.keys()].sort();
    const appearances = [...group.appearances.values()].reduce((sum, value) => sum + value, 0);
    if (!statementIds.length || appearances < 1) continue;
    const fromYear = group.from.length ? Math.min(...group.from) : undefined;
    const toYear = group.to.length ? Math.max(...group.to) : undefined;
    // Separate spells can each carry only one end of the interval. If the
    // combined envelope is reversed, omit both years instead of inventing a
    // career range: the appearance count and statement ids remain the evidence.
    const validRange = fromYear === undefined || toYear === undefined || fromYear <= toYear;
    merged.push({
      playerId, teamId, appearances,
      ...(validRange && fromYear !== undefined ? { fromYear } : {}),
      ...(validRange && toYear !== undefined ? { toYear } : {}),
      statementIds,
    });
  }
  return merged.sort((a, b) => a.playerId.localeCompare(b.playerId) || a.teamId.localeCompare(b.teamId));
}

/** Stable career identity: one row per player/team, independent of statement splits. */
export function appearanceCareerId(playerId: string, teamId: string): string {
  return `wd-p1350:${playerId}:${teamId}`;
}

export function validAppearanceProvenance(provenance: Record<string, unknown> | undefined): boolean {
  if (!provenance || provenance.basis !== APPEARANCE_BASIS) return false;
  if (!Number.isInteger(provenance.appearances) || Number(provenance.appearances) < 1) return false;
  const statementIds = provenance.statementIds;
  return Array.isArray(statementIds) && statementIds.length > 0
    && statementIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 200);
}
