import type { Pool, PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import type { Dataset } from './types.ts';
import { normalize } from './normalize.ts';

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
  };
}

export function datasetChecksum(d: Dataset): string {
  const canonical = canonicalDataset(d);
  return createHash('sha256').update(stable([canonical.version, canonical.origin ?? 'reviewed',
    canonical.sources, canonical.entities, canonical.careers])).digest('hex');
}

export function nextReviewedVersion(version: string): string {
  const match = /^(.*-v)(\d+)$/.exec(version);
  if (!match) throw new Error('Reviewed version has no incrementable suffix');
  return `${match[1]}${Number(match[2]) + 1}`;
}

export function validateDataset(input: unknown): asserts input is Dataset {
  if (!input || typeof input !== 'object') throw new Error('Invalid dataset');
  const d = input as Dataset;
  if (d.origin !== undefined && d.origin !== 'wikidata-candidates') throw new Error('Unknown dataset origin');
  const text = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 500;
  if (!text(d.version) || !Array.isArray(d.sources) || !Array.isArray(d.entities) || !Array.isArray(d.careers)) throw new Error('Invalid dataset shape');
  for (const list of [d.sources, d.entities, d.careers]) {
    const ids = new Set<string>();
    for (const item of list) { if (!item || !text(item.id) || !/^[a-zA-Z0-9:_-]+$/.test(item.id) || ids.has(item.id)) throw new Error('Invalid or duplicate ID'); ids.add(item.id); }
  }
  const sources = new Map(d.sources.map(s => [s.id, s]));
  const entities = new Map(d.entities.map(e => [e.id, e]));
  for (const s of d.sources) {
    if (!text(s.url) || !s.url.startsWith('https://') || !['CC0-1.0', 'reference-only'].includes(s.license) || !/^\d{4}-\d{2}-\d{2}$/.test(s.retrieved) || !Number.isFinite(Date.parse(s.retrieved))) throw new Error('Invalid source');
  }
  for (const e of d.entities) {
    if (!['player', 'club', 'country', 'national_team'].includes(e.kind) || !text(e.name) || !Array.isArray(e.aliases) || !e.aliases.every(text) || sources.get(e.sourceId)?.license !== 'CC0-1.0') throw new Error('Invalid entity or unlicensed source');
    if (e.birthDate && (!/^\d{4}-\d{2}-\d{2}$/.test(e.birthDate) || !Number.isFinite(Date.parse(e.birthDate)))) throw new Error('Invalid birth date');
    if (e.countryId && entities.get(e.countryId)?.kind !== 'country') throw new Error('Invalid country');
    if (['club', 'national_team'].includes(e.kind) && !['senior', 'youth', 'unknown'].includes(e.level!)) throw new Error('Team level required');
    if (e.kind === 'national_team' && !e.countryId) throw new Error('National team country required');
  }
  for (const c of d.careers) {
    if (d.origin === 'wikidata-candidates' && (c.appeared || c.verified || !c.provenance)) throw new Error('Candidate membership cannot assert appeared or verified');
    if (c.verified && c.appeared && (c.evidenceId === c.sourceId || sources.get(c.evidenceId)?.license !== 'reference-only')) throw new Error('Playable career needs separate reviewed match evidence');
    if (c.provenance !== undefined && (!c.provenance || typeof c.provenance !== 'object' || Array.isArray(c.provenance))) throw new Error('Invalid provenance');
    if (entities.get(c.playerId)?.kind !== 'player' || !['club', 'national_team'].includes(entities.get(c.teamId)?.kind ?? '') || sources.get(c.sourceId)?.license !== 'CC0-1.0' || !sources.has(c.evidenceId) || typeof c.appeared !== 'boolean' || typeof c.verified !== 'boolean') throw new Error('Invalid career or provenance');
    for (const year of [c.fromYear, c.toYear]) if (year !== undefined && (!Number.isInteger(year) || year < 1800 || year > 2200)) throw new Error('Invalid career year');
    if (c.fromYear && c.toYear && c.fromYear > c.toYear) throw new Error('Reversed career interval');
  }
}
export async function importDataset(pool: Pool, input: unknown): Promise<void> {
  validateDataset(input);
  const d = input;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(3212026)');
    await writeDataset(client, d);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
async function writeDataset(client: PoolClient, d: Dataset) {
  const candidate = d.origin === 'wikidata-candidates';
  const checksum = datasetChecksum(d);
  for (const s of d.sources) await client.query('INSERT INTO football_source VALUES($1,$2,$3,$4) ON CONFLICT(id) ' + (candidate ? 'DO NOTHING' : 'DO UPDATE SET url=EXCLUDED.url,license=EXCLUDED.license,retrieved=EXCLUDED.retrieved'), [s.id, s.url, s.license, s.retrieved]);
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
