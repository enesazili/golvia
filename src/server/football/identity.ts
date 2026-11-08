import { normalize } from './normalize.ts';
import type { IdentityLink, Kind } from './types.ts';

export type ExistingIdentity = { id: string; kind: Kind; name: string; birthDate?: string; countryId?: string; aliases?: string[]; level?: 'senior' | 'youth' | 'unknown' };
export type ExternalPlayer = { id: string; name: string; birthDate?: string };
export type ExternalClub = { id: string; name: string; countryId?: string };
export type ExternalCountry = { id: string; name: string };
export type ExternalNationalTeam = { id: string; name: string; countryId: string };
export type ExternalIdentities = { players: ExternalPlayer[]; clubs: ExternalClub[]; countries: ExternalCountry[]; nationalTeams?: ExternalNationalTeam[] };
export type IdentityMatch = { links: IdentityLink[]; matched: Set<string> };
/** A human-reviewed identity mapping that never relies on name similarity alone. */
export type ManualIdentityLink = { externalId: string; entityId: string; evidence?: Record<string, unknown> };
export type PendingIdentity = {
  kind: 'player' | 'club';
  externalId: string;
  externalName: string;
  entityId: string;
  entityName: string;
  reason: 'missing-birthdate' | 'birthdate-mismatch' | 'ambiguous-name-and-birthdate' | 'country-conflict' | 'ambiguous-club-name';
};
export type IdentityAuditFailure = { externalId: string; entityId: string; reason: string };

/** Reviewed country labels are Turkish; the external dataset uses English names. */
const COUNTRY_ALIASES: Record<string, string> = {
  brezilya: 'brazil', ispanya: 'spain', arjantin: 'argentina', portekiz: 'portugal',
};

function unique<K>(map: Map<K, string[]>): Map<K, string> {
  const result = new Map<K, string>();
  for (const [key, ids] of map) if (new Set(ids).size === 1) result.set(key, ids[0]);
  return result;
}

function candidateIndex(existing: ExistingIdentity[], kind: Kind, labelsOf: (e: ExistingIdentity) => string[]) {
  const map = new Map<string, string[]>();
  for (const entity of existing) {
    if (entity.kind !== kind) continue;
    for (const label of new Set(labelsOf(entity))) {
      const key = normalize(label);
      if (!key) continue;
      map.set(key, [...(map.get(key) ?? []), entity.id]);
    }
  }
  return map;
}

const clubLabels = (entity: ExistingIdentity) => [entity.name, ...(entity.aliases ?? [])];

function playerIndex(existing: ExistingIdentity[]) {
  const map = new Map<string, string[]>();
  for (const entity of existing) {
    if (entity.kind !== 'player' || !entity.birthDate) continue;
    for (const label of new Set([entity.name, ...(entity.aliases ?? [])])) {
      const key = `${normalize(label)}|${entity.birthDate}`;
      map.set(key, [...(map.get(key) ?? []), entity.id]);
    }
  }
  return unique(map);
}

const countryLabel = (entity: ExistingIdentity) => {
  const value = normalize(entity.name);
  return COUNTRY_ALIASES[value] ?? value;
};

/**
 * Matches external identities to existing Golvia entities without guessing.
 * Players need an exact normalized name plus an identical birth date. Clubs need an
 * exact normalized name or a curated alias (and a compatible country when both sides
 * know one). Countries are matched through an explicit Turkish-to-English label map.
 * A label shared by more than one entity is never merged.
 */
export function matchIdentities(
  existing: ExistingIdentity[],
  external: ExternalIdentities,
  manual: ManualIdentityLink[] = [],
): IdentityMatch {
  const links: IdentityLink[] = [];
  const matched = new Set<string>();
  const existingById = new Map(existing.map(e => [e.id, e]));
  const externalKind = new Map<string, Kind>([
    ...external.players.map(p => [`tm:player:${p.id}`, 'player'] as [string, Kind]),
    ...external.clubs.map(c => [`tm:club:${c.id}`, 'club'] as [string, Kind]),
    ...external.countries.map(c => [`tm:country:${c.id}`, 'country'] as [string, Kind]),
    ...(external.nationalTeams ?? []).map(t => [`tm:nt:${t.id}`, 'national_team'] as [string, Kind]),
  ]);

  const players = playerIndex(existing);
  for (const player of external.players) {
    if (!player.birthDate) continue;
    const entityId = players.get(`${normalize(player.name)}|${player.birthDate}`);
    if (!entityId) continue;
    matched.add(`tm:player:${player.id}`);
    const entity = existingById.get(entityId);
    const matchedAlias = normalize(entity?.name ?? '') !== normalize(player.name);
    links.push({ source: 'transfermarkt', externalId: `tm:player:${player.id}`, entityId, method: 'name+birthdate', status: 'confirmed',
      evidence: {
        rule: matchedAlias ? 'curated-alias+birth-date' : 'exact-normalized-name+birth-date',
        externalName: player.name, birthDate: player.birthDate, existingName: entity?.name,
        ...(matchedAlias ? { matchedAlias: true, matchedLabel: player.name } : {}),
      } });
  }

  const clubs = unique(candidateIndex(existing, 'club', clubLabels));
  for (const club of external.clubs) {
    const entityId = clubs.get(normalize(club.name));
    if (!entityId) continue;
    const entity = existingById.get(entityId);
    if (entity?.countryId && club.countryId && entity.countryId !== club.countryId) continue;
    matched.add(`tm:club:${club.id}`);
    const matchedAlias = normalize(entity?.name ?? '') !== normalize(club.name);
    const countryKnown = Boolean(entity?.countryId && club.countryId);
    links.push({ source: 'transfermarkt', externalId: `tm:club:${club.id}`, entityId,
      method: countryKnown ? 'name+country' : 'name-exact', status: 'confirmed',
      evidence: {
        rule: matchedAlias ? (countryKnown ? 'curated-alias+country' : 'curated-alias') : (countryKnown ? 'exact-name+country' : 'exact-name'),
        externalName: club.name, existingName: entity?.name,
        ...(matchedAlias ? { matchedAlias: true, matchedLabel: club.name } : {}),
      } });
  }

  const countryKeys = new Map<string, string[]>();
  for (const entity of existing) {
    if (entity.kind !== 'country') continue;
    for (const name of new Set([normalize(entity.name), countryLabel(entity)])) {
      countryKeys.set(name, [...(countryKeys.get(name) ?? []), entity.id]);
    }
  }
  const existingCountryByName = unique(countryKeys);
  for (const country of external.countries) {
    const entityId = existingCountryByName.get(normalize(country.name));
    if (!entityId) continue;
    matched.add(`tm:country:${country.id}`);
    links.push({ source: 'transfermarkt', externalId: `tm:country:${country.id}`, entityId, method: 'name-map', status: 'confirmed',
      evidence: { rule: 'country-label-map', externalName: country.name, existingName: existingById.get(entityId)?.name } });
  }

  // Explicit human-reviewed mappings are the only way to link names that differ
  // from every curated alias. They still have to pass the audit below.
  for (const entry of manual) {
    const kind = externalKind.get(entry.externalId);
    if (!kind) continue;
    const entity = existingById.get(entry.entityId);
    if (!entity || entity.kind !== kind) throw new Error(`Manual identity target is not a ${kind}: ${entry.externalId} -> ${entry.entityId}`);
    if (matched.has(entry.externalId)) {
      const current = links.find(link => link.externalId === entry.externalId && link.status === 'confirmed');
      if (current && current.entityId !== entry.entityId) throw new Error(`Manual identity conflicts with a confirmed link: ${entry.externalId}`);
      continue;
    }
    matched.add(entry.externalId);
    links.push({
      source: 'transfermarkt', externalId: entry.externalId, entityId: entry.entityId,
      method: 'manual', status: 'confirmed',
      evidence: { rule: 'manual-reviewed-identity', externalKind: kind, ...(entry.evidence ?? {}) },
    });
  }

  return { links, matched };
}

/**
 * Near matches that must stay out of the confirmed set. They are candidates for a
 * manual queue, never merged automatically.
 */
export function findPendingMatches(existing: ExistingIdentity[], external: ExternalIdentities, links: IdentityLink[]): PendingIdentity[] {
  const confirmed = new Set(links.filter(l => l.status === 'confirmed').map(l => l.externalId));
  const existingById = new Map(existing.map(e => [e.id, e]));
  const pending: PendingIdentity[] = [];

  const playerNames = candidateIndex(existing, 'player', e => [e.name]);
  for (const player of external.players) {
    const externalId = `tm:player:${player.id}`;
    if (confirmed.has(externalId)) continue;
    const ids = [...new Set(playerNames.get(normalize(player.name)) ?? [])];
    if (!ids.length) continue;
    if (!player.birthDate) {
      for (const id of ids) pending.push({ kind: 'player', externalId, externalName: player.name, entityId: id, entityName: existingById.get(id)?.name ?? '', reason: 'missing-birthdate' });
      continue;
    }
    const dobMatches = ids.filter(id => existingById.get(id)?.birthDate === player.birthDate);
    if (dobMatches.length === 1) continue;
    if (dobMatches.length > 1) {
      for (const id of dobMatches) pending.push({ kind: 'player', externalId, externalName: player.name, entityId: id, entityName: existingById.get(id)?.name ?? '', reason: 'ambiguous-name-and-birthdate' });
      continue;
    }
    for (const id of ids) pending.push({ kind: 'player', externalId, externalName: player.name, entityId: id, entityName: existingById.get(id)?.name ?? '', reason: 'birthdate-mismatch' });
  }

  const clubNames = candidateIndex(existing, 'club', clubLabels);
  for (const club of external.clubs) {
    const externalId = `tm:club:${club.id}`;
    if (confirmed.has(externalId)) continue;
    const ids = [...new Set(clubNames.get(normalize(club.name)) ?? [])];
    if (!ids.length) continue;
    if (ids.length === 1) {
      const entity = existingById.get(ids[0]);
      if (entity?.countryId && club.countryId && entity.countryId !== club.countryId) {
        pending.push({ kind: 'club', externalId, externalName: club.name, entityId: ids[0], entityName: entity.name, reason: 'country-conflict' });
      }
      continue;
    }
    for (const id of ids) {
      const entity = existingById.get(id);
      const conflict = entity?.countryId && club.countryId && entity.countryId !== club.countryId;
      pending.push({ kind: 'club', externalId, externalName: club.name, entityId: id, entityName: entity?.name ?? '', reason: conflict ? 'country-conflict' : 'ambiguous-club-name' });
    }
  }

  return pending.sort((a, b) => `${a.externalId}:${a.entityId}`.localeCompare(`${b.externalId}:${b.entityId}`));
}

/** Re-checks every confirmed link against the same strict rules used to create it. */
export function auditIdentityLinks(existing: ExistingIdentity[], external: ExternalIdentities, links: IdentityLink[]): IdentityAuditFailure[] {
  const existingById = new Map(existing.map(e => [e.id, e]));
  const players = new Map(external.players.map(p => [`tm:player:${p.id}`, p]));
  const clubs = new Map(external.clubs.map(c => [`tm:club:${c.id}`, c]));
  const countries = new Map(external.countries.map(c => [`tm:country:${c.id}`, c]));
  const teams = new Map((external.nationalTeams ?? []).map(t => [`tm:nt:${t.id}`, t]));
  const countryLinks = new Map(links.filter(l => l.status === 'confirmed' && l.externalId.startsWith('tm:country:')).map(l => [l.externalId, l.entityId]));
  const failures: IdentityAuditFailure[] = [];
  const fail = (l: IdentityLink, reason: string) => failures.push({ externalId: l.externalId, entityId: l.entityId, reason });

  for (const link of links) {
    if (link.status !== 'confirmed') continue;
    const entity = existingById.get(link.entityId);
    if (!entity) { fail(link, 'unknown entity'); continue; }
    if (link.method === 'manual') {
      // Manual links intentionally bypass label matching, but never kind or country/date contradictions.
      if (link.externalId.startsWith('tm:player:')) {
        const player = players.get(link.externalId);
        if (!player || entity.kind !== 'player' || (player.birthDate && entity.birthDate && player.birthDate !== entity.birthDate)) fail(link, 'manual player identity mismatch');
      } else if (link.externalId.startsWith('tm:club:')) {
        const club = clubs.get(link.externalId);
        if (!club || entity.kind !== 'club' || (club.countryId && entity.countryId && club.countryId !== entity.countryId)) fail(link, 'manual club identity mismatch');
      } else if (link.externalId.startsWith('tm:country:')) {
        if (!countries.has(link.externalId) || entity.kind !== 'country') fail(link, 'manual country identity mismatch');
      } else if (link.externalId.startsWith('tm:nt:')) {
        const team = teams.get(link.externalId);
        if (!team || entity.kind !== 'national_team' || countryLinks.get(`tm:country:${team.countryId}`) !== entity.countryId) fail(link, 'manual national team mismatch');
      } else {
        fail(link, 'unknown external namespace');
      }
      continue;
    }
    if (link.externalId.startsWith('tm:player:')) {
      const player = players.get(link.externalId);
      const labels = new Set([entity.name, ...(entity.aliases ?? [])].map(normalize));
      if (!player?.birthDate || entity.kind !== 'player' || !labels.has(normalize(player.name)) || entity.birthDate !== player.birthDate) fail(link, 'player name or birth date changed');
    } else if (link.externalId.startsWith('tm:club:')) {
      const club = clubs.get(link.externalId);
      const labels = new Set([entity.name, ...(entity.aliases ?? [])].map(normalize));
      if (!club || entity.kind !== 'club' || !labels.has(normalize(club.name))) fail(link, 'club label no longer matches');
      else if (entity.countryId && club.countryId && entity.countryId !== club.countryId) fail(link, 'club country conflict');
    } else if (link.externalId.startsWith('tm:country:')) {
      const country = countries.get(link.externalId);
      if (!country || entity.kind !== 'country' || countryLabel(entity) !== normalize(country.name)) fail(link, 'country label map mismatch');
    } else if (link.externalId.startsWith('tm:nt:')) {
      const team = teams.get(link.externalId);
      if (!team || entity.kind !== 'national_team' || countryLinks.get(`tm:country:${team.countryId}`) !== entity.countryId) fail(link, 'national team country mismatch');
    } else {
      fail(link, 'unknown external namespace');
    }
  }
  return failures;
}
