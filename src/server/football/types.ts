export type Kind = 'player' | 'club' | 'country' | 'national_team';
export type Entity = { id: string; kind: Kind; name: string; aliases: string[]; countryId?: string; birthDate?: string; sourceId: string; level?: 'senior' | 'youth' | 'unknown'; mark?: string };
export type Source = { id: string; url: string; license: 'CC0-1.0' | 'reference-only'; retrieved: string };
export type Career = { id: string; playerId: string; teamId: string; fromYear?: number; toYear?: number; appeared: boolean; verified: boolean; sourceId: string; evidenceId: string; provenance?: Record<string, unknown> };
export type Dataset = { version: string; sources: Source[]; entities: Entity[]; careers: Career[]; origin?: 'wikidata-candidates' };
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
