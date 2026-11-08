import type { Pool, PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import type { Dataset, Source, UsagePermission } from './types.ts';
import { normalize } from './normalize.ts';
import { validAppearanceProvenance } from './appearances.ts';

export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).sort()
    .map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function canonicalDataset(d: Dataset): Dataset {
  return {
    ...d,
    sources: [...d.sources].sort((a, b) => a.id.localeCompare(b.id)),
    entities: [...d.entities].sort((a, b) => a.id.localeCompare(b.id))
      .map(e => ({ ...e, aliases: [...e.aliases].sort((a, b) => a.localeCompare(b)) })),
    careers: [...d.careers].sort((a, b) => a.id.localeCompare(b.id)),
    ...(d.transfers ? { transfers: [...d.transfers].sort((a, b) => a.id.localeCompare(b.id)) } : {}),
    ...(d.identityLinks ? { identityLinks: [...d.identityLinks].sort((a, b) => `${a.source}:${a.externalId}`.localeCompare(`${b.source}:${b.externalId}`)) } : {}),
  };
}

export function datasetChecksum(d: Dataset): string {
  const canonical = canonicalDataset(d);
  // Optional blocks are only appended when present so existing reviewed checksums stay stable.
  return createHash('sha256').update(stable([canonical.version, canonical.origin ?? 'reviewed',
    canonical.sources, canonical.entities, canonical.careers,
    ...(canonical.transfers ? [canonical.transfers] : []),
    ...(canonical.identityLinks ? [canonical.identityLinks] : [])])).digest('hex');
}

export function nextReviewedVersion(version: string): string {
  const match = /^(.*-v)(\d+)$/.exec(version);
  if (!match) throw new Error('Reviewed version has no incrementable suffix');
  return `${match[1]}${Number(match[2]) + 1}`;
}

const ID = /^[a-zA-Z0-9:_-]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const METHODS = ['name+birthdate', 'name+country', 'name-exact', 'name-map', 'manual'];

export function validateDataset(input: unknown): asserts input is Dataset {
  if (!input || typeof input !== 'object') throw new Error('Invalid dataset');
  const d = input as Dataset;
  if (d.origin !== undefined && d.origin !== 'wikidata-candidates' && d.origin !== 'transfermarkt-candidates' && d.origin !== 'wikidata-appearances') throw new Error('Unknown dataset origin');
  const text = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 500;
  if (!text(d.version) || !Array.isArray(d.sources) || !Array.isArray(d.entities) || !Array.isArray(d.careers)) throw new Error('Invalid dataset shape');
  for (const list of [d.sources, d.entities, d.careers]) {
    const ids = new Set<string>();
    for (const item of list) { if (!item || !text(item.id) || !ID.test(item.id) || ids.has(item.id)) throw new Error('Invalid or duplicate ID'); ids.add(item.id); }
  }
  const sources = new Map(d.sources.map(s => [s.id, s]));
  const entities = new Map(d.entities.map(e => [e.id, e]));
  const tmCandidate = d.origin === 'transfermarkt-candidates';
  const appearanceDataset = d.origin === 'wikidata-appearances';
  const transfers = d.transfers;
  const links = d.identityLinks;
  if (transfers !== undefined && !Array.isArray(transfers)) throw new Error('Invalid transfers');
  if (links !== undefined && !Array.isArray(links)) throw new Error('Invalid identity links');
  if ((transfers || links) && !tmCandidate) throw new Error('Transfers and identity links belong to a transfermarkt candidate dataset');
  const linkEntityIds = new Set((links ?? []).map(l => l.entityId));
  const confirmedLinks = new Map((links ?? []).filter(l => l.status === 'confirmed').map(l => [l.externalId, l.entityId]));
  for (const s of d.sources) {
    if (!text(s.url) || !s.url.startsWith('https://') || !['CC0-1.0', 'reference-only'].includes(s.license) || !DATE.test(s.retrieved) || !Number.isFinite(Date.parse(s.retrieved))) throw new Error('Invalid source');
    if (s.usagePermission !== undefined && !['cleared', 'unresolved', 'blocked'].includes(s.usagePermission)) throw new Error('Invalid usage permission');
    // Reference-only pages are never a live data licence, regardless of a dataset claim.
    if (s.license === 'reference-only' && s.usagePermission === 'cleared') throw new Error('Reference-only source cannot be cleared');
  }
  for (const e of d.entities) {
    if (!['player', 'club', 'country', 'national_team'].includes(e.kind) || !text(e.name) || !Array.isArray(e.aliases) || !e.aliases.every(text) || sources.get(e.sourceId)?.license !== 'CC0-1.0') throw new Error('Invalid entity or unlicensed source');
    if (e.birthDate && (!DATE.test(e.birthDate) || !Number.isFinite(Date.parse(e.birthDate)))) throw new Error('Invalid birth date');
    const countryInDataset = entities.get(e.countryId ?? '')?.kind === 'country';
    const countryThroughLink = tmCandidate && (links ?? []).some(l => l.status === 'confirmed' && l.entityId === e.countryId && l.externalId.startsWith('tm:country:'));
    if (e.countryId && !countryInDataset && !countryThroughLink) throw new Error('Invalid country');
    if (['club', 'national_team'].includes(e.kind) && !['senior', 'youth', 'unknown'].includes(e.level!)) throw new Error('Team level required');
    if (e.kind === 'national_team' && !e.countryId) throw new Error('National team country required');
  }
  for (const c of d.careers) {
    if (d.origin === 'wikidata-candidates' && (c.appeared || c.verified || !c.provenance)) throw new Error('Candidate membership cannot assert appeared or verified');
    // Human-reviewed careers keep the stricter separate reference-only evidence rule.
    // Bulk Wikidata P1350 careers carry their own CC0 match-count provenance instead.
    if (!appearanceDataset && c.verified && c.appeared && (c.evidenceId === c.sourceId || sources.get(c.evidenceId)?.license !== 'reference-only')) throw new Error('Playable career needs separate reviewed match evidence');
    if (appearanceDataset) {
      if (!c.verified || !c.appeared) throw new Error('Wikidata appearance careers must be verified and appeared');
      if (!c.id.startsWith('wd-p1350:')) throw new Error('Wikidata appearance careers must use the wd-p1350: namespace');
      if (!validAppearanceProvenance(c.provenance)) throw new Error('Wikidata appearance evidence is missing');
      if (entities.get(c.teamId)?.level !== 'senior') throw new Error('Wikidata appearance team must be senior');
    }
    if (c.provenance !== undefined && (!c.provenance || typeof c.provenance !== 'object' || Array.isArray(c.provenance))) throw new Error('Invalid provenance');
    const resolvedPlayer = entities.get(c.playerId)?.kind === 'player'
      || (tmCandidate && confirmedLinks.get(String(c.provenance?.externalPlayerId)) === c.playerId);
    const resolvedTeam = ['club', 'national_team'].includes(entities.get(c.teamId)?.kind ?? '')
      || (tmCandidate && confirmedLinks.get(String(c.provenance?.externalTeamId)) === c.teamId);
    if (!resolvedPlayer || !resolvedTeam || sources.get(c.sourceId)?.license !== 'CC0-1.0' || !sources.has(c.evidenceId) || typeof c.appeared !== 'boolean' || typeof c.verified !== 'boolean') throw new Error('Invalid career or provenance');
    for (const year of [c.fromYear, c.toYear]) if (year !== undefined && (!Number.isInteger(year) || year < 1800 || year > 2200)) throw new Error('Invalid career year');
    if (c.fromYear && c.toYear && c.fromYear > c.toYear) throw new Error('Reversed career interval');
  }
  if (appearanceDataset) {
    for (const e of d.entities) if (!/^Q\d+$/.test(e.id)) throw new Error('Wikidata appearance entities must use Q-IDs');
    const playerTeams = new Map<string, Set<string>>();
    for (const c of d.careers) {
      const teams = playerTeams.get(c.playerId) ?? new Set<string>();
      if (teams.has(c.teamId)) throw new Error('Duplicate player/team career in Wikidata appearance dataset');
      teams.add(c.teamId);
      playerTeams.set(c.playerId, teams);
    }
    for (const [playerId, teams] of playerTeams) {
      if (teams.size < 2) throw new Error(`Wikidata appearance player ${playerId} connects fewer than two selections`);
    }
  }
  const known = new Set([...entities.keys(), ...linkEntityIds]);
  const transferIds = new Set<string>();
  for (const t of transfers ?? []) {
    if (!t || !text(t.id) || !ID.test(t.id) || transferIds.has(t.id)) throw new Error('Invalid or duplicate transfer ID');
    transferIds.add(t.id);
    if (!text(t.playerId) || !known.has(t.playerId) || !sources.has(t.sourceId)) throw new Error('Invalid transfer identity or source');
    for (const teamId of [t.fromTeamId, t.toTeamId]) if (teamId !== undefined && (!text(teamId) || !known.has(teamId))) throw new Error('Invalid transfer club');
    if (t.date !== undefined && (!DATE.test(t.date) || !Number.isFinite(Date.parse(t.date)))) throw new Error('Invalid transfer date');
    if (t.fromTeamName !== undefined && !text(t.fromTeamName)) throw new Error('Invalid transfer club name');
    if (t.toTeamName !== undefined && !text(t.toTeamName)) throw new Error('Invalid transfer club name');
    for (const amount of [t.feeEur, t.marketValueEur]) if (amount !== undefined && (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0)) throw new Error('Invalid transfer amount');
    if (t.provenance !== undefined && (!t.provenance || typeof t.provenance !== 'object' || Array.isArray(t.provenance))) throw new Error('Invalid transfer provenance');
  }
  const linkKeys = new Set<string>();
  for (const l of links ?? []) {
    if (!l || !text(l.source) || !text(l.externalId) || !ID.test(l.externalId) || !text(l.entityId) || !ID.test(l.entityId)) throw new Error('Invalid identity link');
    const key = `${l.source}:${l.externalId}`;
    if (linkKeys.has(key)) throw new Error('Duplicate identity link');
    linkKeys.add(key);
    if (!METHODS.includes(l.method) || !['pending', 'confirmed'].includes(l.status)) throw new Error('Invalid identity link method or status');
    if (l.evidence !== undefined && (!l.evidence || typeof l.evidence !== 'object' || Array.isArray(l.evidence))) throw new Error('Invalid identity evidence');
  }
  if (d.origin === 'transfermarkt-candidates') {
    // Candidates never reuse reviewed IDs and never assert human verification.
    for (const e of d.entities) if (!e.id.startsWith('tm:')) throw new Error('Transfermarkt entity IDs must use the tm: namespace');
    for (const c of d.careers) {
      if (!c.id.startsWith('tm-career:')) throw new Error('Transfermarkt careers must use the tm-career: namespace');
      if (c.verified) throw new Error('Transfermarkt candidates cannot be verified without human review');
      if (c.appeared && (c.provenance?.evidence !== 'appearance-rows' || !(Number(c.provenance?.appearances) >= 1))) throw new Error('Transfermarkt appearance needs appearance rows');
    }
    for (const t of transfers ?? []) {
      if (!t.id.startsWith('tm-transfer:')) throw new Error('Transfermarkt transfers must use the tm-transfer: namespace');
      if (t.provenance?.basis !== 'transfer-record') throw new Error('Transfer records are not appearance evidence');
      if (!text(t.provenance.externalPlayerId)) throw new Error('Transfer needs the external player key');
      if (!entities.has(t.playerId) && !(links ?? []).some(l => l.status === 'confirmed' && l.externalId === t.provenance!.externalPlayerId && l.entityId === t.playerId)) throw new Error('Matched transfer player needs a confirmed identity link');
    }
    for (const l of links ?? []) {
      if (l.source !== 'transfermarkt' || !l.externalId.startsWith('tm:')) throw new Error('Transfermarkt links must map tm: keys from the transfermarkt source');
    }
  }
}

/** Candidate sources are always unresolved; only an explicit review can clear one. */
function candidatePermission(source: Source): UsagePermission {
  return source.id.startsWith('tm-') || source.usagePermission === 'blocked' ? 'unresolved' : source.usagePermission ?? 'unresolved';
}

/** Reviewed sources inherit a cleared CC0 licence; reference-only evidence stays unresolved. */
function reviewedPermission(source: Source): UsagePermission {
  return source.usagePermission ?? (source.license === 'CC0-1.0' ? 'cleared' : 'unresolved');
}

async function bulk(client: PoolClient, table: string, columns: string[], rows: unknown[][], conflict: string, casts: Record<number, string> = {}) {
  if (!rows.length) return;
  const width = columns.length;
  const chunkSize = Math.max(1, Math.min(500, Math.floor(30000 / width)));
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const values: unknown[] = [];
    const tuples = rows.slice(offset, offset + chunkSize).map(row => `(${row.map((value, index) => {
      values.push(value ?? null);
      return `$${values.length}${casts[index] ?? ''}`;
    }).join(',')})`);
    await client.query(`INSERT INTO ${table}(${columns.join(',')}) VALUES ${tuples.join(',')} ON CONFLICT ${conflict}`, values);
  }
}

export async function importDataset(pool: Pool, input: unknown): Promise<void> {
  validateDataset(input);
  const d = input;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(3212026)');
    if (d.origin === 'transfermarkt-candidates') await writeTransfermarktDataset(client, d);
    else if (d.origin === 'wikidata-appearances') await writeAppearanceDataset(client, d);
    else await writeDataset(client, d);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

async function writeTransfermarktDataset(client: PoolClient, d: Dataset) {
  await bulk(client, 'football_source', ['id', 'url', 'license', 'retrieved', 'usage_permission'],
    d.sources.map(s => [s.id, s.url, s.license, s.retrieved, candidatePermission(s)]), '(id) DO NOTHING');
  // Never clear a candidate source automatically. Existing legal clearances survive a re-import.
  await client.query(`INSERT INTO football_source_clearance(source_id,status,basis,evidence,reviewed_by)
    SELECT id,'unresolved','site-terms','Transfermarkt site terms require separate legal approval','dataset:transfermarkt-candidates'
    FROM football_source WHERE id = ANY($1::text[]) AND id LIKE 'tm-%'
    ON CONFLICT(source_id) DO NOTHING`, [d.sources.map(s => s.id)]);
  const existing = await client.query('SELECT id,kind FROM football_entity WHERE id = ANY($1::text[])', [d.entities.map(e => e.id)]);
  const existingKinds = new Map(existing.rows.map(row => [row.id as string, row.kind as string]));
  for (const e of d.entities) {
    const kind = existingKinds.get(e.id);
    if (kind && kind !== e.kind) throw new Error('Entity kind is immutable');
  }
  await bulk(client, 'football_entity', ['id', 'kind', 'name', 'country_id', 'birth_date', 'level', 'mark', 'source_id'],
    d.entities.map(e => [e.id, e.kind, e.name, e.countryId ?? null, e.birthDate ?? null, e.level ?? null, e.mark ?? '', e.sourceId]), '(id) DO NOTHING');
  await bulk(client, 'football_alias', ['entity_id', 'label', 'search_key'],
    d.entities.flatMap(e => [...new Set([e.name, ...e.aliases])].map(label => [e.id, label, normalize(label)])), '(entity_id,label) DO NOTHING');
  await bulk(client, 'football_identity_link', ['source_key', 'external_id', 'entity_id', 'method', 'status', 'evidence'],
    (d.identityLinks ?? []).map(l => [l.source, l.externalId, l.entityId, l.method, l.status, JSON.stringify(l.evidence ?? {})]),
    '(source_key,external_id) DO NOTHING', { 5: '::jsonb' });
  // A newer candidate revision may resolve a career to an existing identity. Update only
  // unverified candidate rows that are not under review; reviewed/verified rows stay intact.
  await bulk(client, 'football_career', ['id', 'player_id', 'team_id', 'from_year', 'to_year', 'appeared', 'verified', 'source_id', 'evidence_id', 'provenance'],
    d.careers.map(c => [c.id, c.playerId, c.teamId, c.fromYear ?? null, c.toYear ?? null, c.appeared, c.verified, c.sourceId, c.evidenceId, JSON.stringify(c.provenance ?? {})]),
    `(id) DO UPDATE SET player_id=EXCLUDED.player_id,team_id=EXCLUDED.team_id,from_year=EXCLUDED.from_year,to_year=EXCLUDED.to_year,
      appeared=EXCLUDED.appeared,source_id=EXCLUDED.source_id,evidence_id=EXCLUDED.evidence_id,provenance=EXCLUDED.provenance
      WHERE football_career.verified=false AND NOT EXISTS (SELECT 1 FROM football_review r WHERE r.career_id=EXCLUDED.id)`,
    { 9: '::jsonb' });
  await bulk(client, 'football_transfer', ['id', 'player_id', 'from_team_id', 'to_team_id', 'from_team_name', 'to_team_name', 'transfer_date', 'season', 'fee_eur', 'market_value_eur', 'source_id', 'provenance'],
    (d.transfers ?? []).map(t => [t.id, t.playerId, t.fromTeamId ?? null, t.toTeamId ?? null, t.fromTeamName ?? '', t.toTeamName ?? '', t.date ?? null, t.season ?? null, t.feeEur ?? null, t.marketValueEur ?? null, t.sourceId, JSON.stringify(t.provenance ?? {})]),
    `(id) DO UPDATE SET player_id=EXCLUDED.player_id,from_team_id=EXCLUDED.from_team_id,to_team_id=EXCLUDED.to_team_id,
      from_team_name=EXCLUDED.from_team_name,to_team_name=EXCLUDED.to_team_name,transfer_date=EXCLUDED.transfer_date,season=EXCLUDED.season,
      fee_eur=EXCLUDED.fee_eur,market_value_eur=EXCLUDED.market_value_eur,source_id=EXCLUDED.source_id,provenance=EXCLUDED.provenance`,
    { 11: '::jsonb' });
  // Candidate imports must not replace the reviewed game dataset version.
  await client.query('INSERT INTO football_import_batch(checksum,version,origin,entity_count,career_count) VALUES($1,$2,$3,$4,$5) ON CONFLICT(checksum) DO NOTHING',
    [datasetChecksum(d), d.version, 'transfermarkt-candidates', d.entities.length, d.careers.length]);
}

/**
 * Bulk Wikidata P1350 appearance snapshot. It is additive: reviewed entities,
 * reviewed aliases and reviewed careers are never overwritten. The source is
 * inserted unresolved, so this import cannot make itself playable; the caller
 * must use setSourceClearance after independently confirming the CC0 basis.
 */
async function writeAppearanceDataset(client: PoolClient, d: Dataset) {
  const existing = await client.query('SELECT id,kind FROM football_entity WHERE id = ANY($1::text[])', [d.entities.map(e => e.id)]);
  const kinds = new Map(d.entities.map(e => [e.id, e.kind]));
  for (const row of existing.rows) if (kinds.get(row.id as string) !== row.kind) throw new Error('Entity kind is immutable');
  await bulk(client, 'football_source', ['id', 'url', 'license', 'retrieved', 'usage_permission'],
    d.sources.map(s => [s.id, s.url, s.license, s.retrieved, 'unresolved']), '(id) DO NOTHING');
  // Protect the explicit gate: a later CC0 migration backfill may touch the
  // source row, but football_link reads this clearance row. It stays unresolved
  // until setSourceClearance is called; re-imports keep an existing clearance.
  await client.query(`INSERT INTO football_source_clearance(source_id,status,basis,evidence,reviewed_by)
    SELECT id,'unresolved','license-review','Wikidata CC0-1.0 snapshot awaiting explicit live-use clearance','dataset:wikidata-appearances'
    FROM football_source WHERE id = ANY($1::text[])
    ON CONFLICT(source_id) DO NOTHING`, [d.sources.map(s => s.id)]);
  await bulk(client, 'football_entity', ['id', 'kind', 'name', 'country_id', 'birth_date', 'level', 'mark', 'source_id'],
    d.entities.map(e => [e.id, e.kind, e.name, e.countryId ?? null, e.birthDate ?? null, e.level ?? null, e.mark ?? '', e.sourceId]), '(id) DO NOTHING');
  // Curated senior targets may already exist as unknown from an older candidate
  // import. Only unknown is promoted; reviewed youth/senior levels stay intact.
  await client.query(`UPDATE football_entity SET level='senior'
    WHERE id=ANY($1::text[]) AND kind IN ('club','national_team') AND level='unknown'`,
    [d.entities.filter(e => e.level === 'senior').map(e => e.id)]);
  await bulk(client, 'football_alias', ['entity_id', 'label', 'search_key'],
    d.entities.flatMap(e => [...new Set([e.name, ...e.aliases])].map(label => [e.id, label, normalize(label)])), '(entity_id,label) DO NOTHING');
  await bulk(client, 'football_career', ['id', 'player_id', 'team_id', 'from_year', 'to_year', 'appeared', 'verified', 'source_id', 'evidence_id', 'provenance'],
    d.careers.map(c => [c.id, c.playerId, c.teamId, c.fromYear ?? null, c.toYear ?? null, c.appeared, c.verified, c.sourceId, c.evidenceId, JSON.stringify(c.provenance ?? {})]),
    '(id) DO NOTHING', { 9: '::jsonb' });
  await client.query('INSERT INTO football_dataset VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET version=EXCLUDED.version', [d.version]);
  await client.query('INSERT INTO football_import_batch(checksum,version,origin,entity_count,career_count) VALUES($1,$2,$3,$4,$5) ON CONFLICT(checksum) DO NOTHING',
    [datasetChecksum(d), d.version, 'wikidata-appearances', d.entities.length, d.careers.length]);
}

async function writeDataset(client: PoolClient, d: Dataset) {
  const candidate = d.origin === 'wikidata-candidates';
  const checksum = datasetChecksum(d);
  for (const s of d.sources) {
    const permission = candidate ? candidatePermission(s) : reviewedPermission(s);
    await client.query(`INSERT INTO football_source(id,url,license,retrieved,usage_permission) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(id) ` + (candidate ? 'DO NOTHING' : 'DO UPDATE SET url=EXCLUDED.url,license=EXCLUDED.license,retrieved=EXCLUDED.retrieved,usage_permission=EXCLUDED.usage_permission'),
      [s.id, s.url, s.license, s.retrieved, permission]);
    // Only a reviewed import may seed a cleared row, and it never overrides an explicit block.
    if (!candidate && permission === 'cleared') {
      await client.query(`INSERT INTO football_source_clearance(source_id,status,basis,evidence,reviewed_by)
        VALUES($1,'cleared',$2,$3,'dataset:reviewed')
        ON CONFLICT(source_id) DO UPDATE SET status='cleared',basis=EXCLUDED.basis,evidence=EXCLUDED.evidence,reviewed_by=EXCLUDED.reviewed_by,reviewed_at=now()
        WHERE football_source_clearance.status <> 'blocked'`, [s.id, s.license, 'Reviewed dataset CC0-1.0 source']);
    }
  }
  for (const e of d.entities) {
    // Identity cannot silently change kind in subsequent imports.
    const previous = await client.query('SELECT kind FROM football_entity WHERE id=$1', [e.id]);
    if (previous.rows[0] && previous.rows[0].kind !== e.kind) throw new Error('Entity kind is immutable');
    await client.query('INSERT INTO football_entity(id,kind,name,country_id,birth_date,level,mark,source_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) ' + (candidate ? 'DO NOTHING' : 'DO UPDATE SET name=EXCLUDED.name,country_id=EXCLUDED.country_id,birth_date=EXCLUDED.birth_date,level=EXCLUDED.level,mark=EXCLUDED.mark,source_id=EXCLUDED.source_id'), [e.id, e.kind, e.name, e.countryId ?? null, e.birthDate ?? null, e.level ?? null, e.mark ?? '', e.sourceId]);
    if (!candidate) await client.query('DELETE FROM football_alias WHERE entity_id=$1', [e.id]);
    for (const label of new Set([e.name, ...e.aliases])) await client.query('INSERT INTO football_alias(entity_id,label,search_key) VALUES($1,$2,$3) ON CONFLICT(entity_id,label) DO NOTHING', [e.id, label, normalize(label)]);
  }
  for (const c of d.careers) await client.query('INSERT INTO football_career(id,player_id,team_id,from_year,to_year,appeared,verified,source_id,evidence_id,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) ' + (candidate ? 'DO NOTHING' : `DO UPDATE SET player_id=EXCLUDED.player_id,team_id=EXCLUDED.team_id,from_year=EXCLUDED.from_year,to_year=EXCLUDED.to_year,appeared=EXCLUDED.appeared,verified=EXCLUDED.verified,source_id=EXCLUDED.source_id,evidence_id=EXCLUDED.evidence_id,provenance=EXCLUDED.provenance WHERE NOT EXISTS (SELECT 1 FROM football_review r WHERE r.career_id=EXCLUDED.id)`), [c.id, c.playerId, c.teamId, c.fromYear ?? null, c.toYear ?? null, c.appeared, c.verified, c.sourceId, c.evidenceId, JSON.stringify(c.provenance ?? {})]);
  // Candidate imports may enrich the cache, but must not replace the reviewed game dataset version.
  if (!candidate) await client.query('INSERT INTO football_dataset VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET version=EXCLUDED.version', [d.version]);
  await client.query('INSERT INTO football_import_batch(checksum,version,origin,entity_count,career_count) VALUES($1,$2,$3,$4,$5) ON CONFLICT(checksum) DO NOTHING', [checksum, d.version, candidate ? 'wikidata-candidates' : 'reviewed', d.entities.length, d.careers.length]);
}

export type ClearanceInput = {
  sourceId: string; status: 'cleared' | 'unresolved' | 'blocked';
  basis: string; evidence: string; reviewedBy: string;
};

/**
 * The only legal gate that can clear a source for live use. It is intentionally a
 * separate operation from dataset import: no dataset can clear itself.
 */
export async function setSourceClearance(pool: Pool, input: ClearanceInput): Promise<void> {
  for (const value of [input.sourceId, input.basis, input.evidence, input.reviewedBy]) {
    if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw new Error('Invalid source clearance');
  }
  if (!['cleared', 'unresolved', 'blocked'].includes(input.status)) throw new Error('Invalid source clearance status');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(3212026)');
    const source = await client.query('SELECT id,license FROM football_source WHERE id=$1', [input.sourceId]);
    if (!source.rowCount) throw new Error('Unknown source');
    // A reference page is never a data licence, even if an operator tries to clear it.
    if (input.status === 'cleared' && source.rows[0].license === 'reference-only') throw new Error('Reference-only source cannot be cleared');
    await client.query(`INSERT INTO football_source_clearance(source_id,status,basis,evidence,reviewed_by)
      VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(source_id) DO UPDATE SET status=EXCLUDED.status,basis=EXCLUDED.basis,evidence=EXCLUDED.evidence,
        reviewed_by=EXCLUDED.reviewed_by,reviewed_at=now()`,
      [input.sourceId, input.status, input.basis.trim(), input.evidence.trim(), input.reviewedBy.trim()]);
    await client.query('UPDATE football_source SET usage_permission=$2 WHERE id=$1', [input.sourceId, input.status]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

export type PublishInput = { sourceId: string; publishedBy: string; evidence?: Record<string, unknown>; limit?: number };
export type PublishResult = { batchId: number | null; careers: string[] };

/**
 * Publishes only human-approved candidate careers whose source is legally cleared.
 * Verified reviewed rows are never touched; re-running is idempotent.
 */
export async function publishApprovedCareers(pool: Pool, input: PublishInput): Promise<PublishResult> {
  if (!input.sourceId?.trim() || !input.publishedBy?.trim()) throw new Error('Source and publisher are required');
  const limit = input.limit === undefined ? 10000 : Math.min(Math.max(1, Math.trunc(input.limit)), 100000);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(3212026)');
    const clearance = await client.query('SELECT status FROM football_source_clearance WHERE source_id=$1', [input.sourceId]);
    if (clearance.rows[0]?.status !== 'cleared') throw new Error('Source usage permission is not cleared');
    const approved = await client.query(`SELECT c.id FROM football_career c
      JOIN football_entity t ON t.id=c.team_id
      JOIN football_review r ON r.career_id=c.id
      WHERE c.source_id=$1 AND c.verified=false AND c.appeared=true AND r.status='approved'
        AND t.level='senior' AND t.kind IN ('club','national_team')
      ORDER BY c.id LIMIT $2 FOR UPDATE OF c`, [input.sourceId, limit]);
    const careers = approved.rows.map(row => row.id as string);
    if (!careers.length) { await client.query('COMMIT'); return { batchId: null, careers: [] }; }
    await client.query('UPDATE football_career SET verified=true WHERE id=ANY($1::text[]) AND verified=false', [careers]);
    const batch = await client.query(`INSERT INTO football_publish_batch(source_id,career_ids,career_count,published_by,evidence)
      VALUES($1,$2,$3,$4,$5::jsonb) RETURNING id`,
      [input.sourceId, careers, careers.length, input.publishedBy.trim(), JSON.stringify(input.evidence ?? {})]);
    await client.query('COMMIT');
    return { batchId: Number(batch.rows[0].id), careers };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

/** Reverses one publish batch; the imported candidate rows and their source stay intact. */
export async function revertPublish(pool: Pool, input: { batchId: number; revertedBy: string }): Promise<{ careers: string[] }> {
  if (!Number.isInteger(input.batchId) || input.batchId < 1 || !input.revertedBy?.trim()) throw new Error('Invalid publish revert');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(3212026)');
    const batch = await client.query('SELECT career_ids,reverted_at FROM football_publish_batch WHERE id=$1 FOR UPDATE', [input.batchId]);
    if (!batch.rows[0]) throw new Error('Unknown publish batch');
    if (batch.rows[0].reverted_at) { await client.query('COMMIT'); return { careers: [] }; }
    const careers = batch.rows[0].career_ids as string[];
    await client.query('UPDATE football_career SET verified=false WHERE id=ANY($1::text[]) AND verified=true', [careers]);
    await client.query(`UPDATE football_publish_batch SET reverted_at=now(),
      evidence=evidence || jsonb_build_object('revertedBy',$2::text) WHERE id=$1`, [input.batchId, input.revertedBy.trim()]);
    await client.query('COMMIT');
    return { careers };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
