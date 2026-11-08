export type Kind = 'player' | 'club' | 'country' | 'national_team';
export type Entity = { id: string; kind: Kind; name: string; aliases: string[]; countryId?: string; birthDate?: string; sourceId: string; level?: 'senior' | 'youth' | 'unknown'; mark?: string };
/** Dataset licence and live-usage permission are separate decisions. */
export type UsagePermission = 'cleared' | 'unresolved' | 'blocked';
export type Source = { id: string; url: string; license: 'CC0-1.0' | 'reference-only'; retrieved: string; usagePermission?: UsagePermission };
export type Career = { id: string; playerId: string; teamId: string; fromYear?: number; toYear?: number; appeared: boolean; verified: boolean; sourceId: string; evidenceId: string; provenance?: Record<string, unknown> };
/** A transfer is a record of a move, never proof that the player appeared for either club. */
export type Transfer = { id: string; playerId: string; fromTeamId?: string; toTeamId?: string; fromTeamName?: string; toTeamName?: string; date?: string; season?: string; feeEur?: number; marketValueEur?: number; sourceId: string; provenance?: Record<string, unknown> };
export type IdentityMethod = 'name+birthdate' | 'name+country' | 'name-exact' | 'name-map' | 'manual';
/** A reviewed mapping between an external dataset key and an existing Golvia entity identity. */
export type IdentityLink = { source: string; externalId: string; entityId: string; method: IdentityMethod; status: 'pending' | 'confirmed'; evidence?: Record<string, unknown> };
export type CandidateOrigin = 'wikidata-candidates' | 'transfermarkt-candidates' | 'wikidata-appearances';
export type Dataset = { version: string; sources: Source[]; entities: Entity[]; careers: Career[]; origin?: CandidateOrigin; transfers?: Transfer[]; identityLinks?: IdentityLink[] };
export type Suggestion = { id: string; name: string; detail: string; mark: string };
export type Catalog = { version: string; selectionIds: Set<string>; playerIds: Set<string>; links: Map<string, Set<string>>; labels?: Map<string, string> };
export function connects(catalog: Catalog, playerId: string, a: string, b: string): boolean {
  const links = catalog.links.get(playerId);
  return !!links?.has(a) && links.has(b);
}
export function playableOpponents(catalog: Catalog, selectionId: string): string[] {
  const opponents = new Set<string>();
  for (const links of catalog.links.values()) {
    if (!links.has(selectionId)) continue;
    for (const id of links) if (id !== selectionId && catalog.selectionIds.has(id)) opponents.add(id);
  }
  return [...opponents].sort();
}
