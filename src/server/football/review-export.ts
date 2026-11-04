import type { Pool } from 'pg';
import { canonicalDataset, stable, validateDataset } from './importer.ts';
import type { Career, Dataset, Entity, Source } from './types.ts';

/**
 * Deterministic PostgreSQL -> reviewed JSON export.
 *
 * PostgreSQL review decisions are canonical for careers that have a review
 * row. Careers without a review row must still match the JSON exactly; any
 * drift is reported as a conflict instead of being silently overwritten.
 */
export type ExportSnapshot = {
  careers: Career[];
  entities: Entity[];
  sources: Source[];
  reviewStatus: Map<string, string>;
};

export type ExportResult = {
  dataset: Dataset;
  added: string[];
  changed: string[];
  conflicts: string[];
};

const careerShape = (c: Career) => ({
  id: c.id, playerId: c.playerId, teamId: c.teamId,
  fromYear: c.fromYear ?? null, toYear: c.toYear ?? null,
  appeared: c.appeared, verified: c.verified,
  sourceId: c.sourceId, evidenceId: c.evidenceId, provenance: c.provenance ?? {},
});
const same = (a: unknown, b: unknown) => stable(a) === stable(b);

export function buildReviewedExport(base: Dataset, snapshot: ExportSnapshot): ExportResult {
  validateDataset(base);
  const conflicts: string[] = [];
  const baseCareers = new Map(base.careers.map(c => [c.id, c]));
  const dbCareers = new Map(snapshot.careers.map(c => [c.id, c]));
  const careers = new Map(baseCareers);
  const added: string[] = [];
  const changed: string[] = [];

  for (const [id, original] of baseCareers) {
    const current = dbCareers.get(id);
    if (!current) { conflicts.push(`career ${id} eksik (JSON'da var, DB'de yok)`); continue; }
    const status = snapshot.reviewStatus.get(id);
    if (status && status !== 'pending') {
      if (!same(careerShape(original), careerShape(current))) changed.push(id);
      careers.set(id, current);
    } else if (!same(careerShape(original), careerShape(current))) {
      conflicts.push(`career ${id} incelenmemiş olmasına rağmen DB ile JSON farklı`);
    }
  }
  for (const [id, current] of dbCareers) {
    if (baseCareers.has(id)) continue;
    const status = snapshot.reviewStatus.get(id);
    if (status !== 'approved' || !current.verified || !current.appeared) {
      conflicts.push(`career ${id} JSON'da yok ve onaylı/oynanabilir değil`);
      continue;
    }
    careers.set(id, current); added.push(id);
  }
  for (const [id, status] of snapshot.reviewStatus) {
    if (status !== 'approved') continue;
    const career = dbCareers.get(id);
    if (!career || !career.verified || !career.appeared) conflicts.push(`career ${id} onaylı ama oynanabilir değil`);
  }

  // Include DB state for every entity/source already used by the reviewed JSON,
  // plus everything referenced by newly approved careers.
  const dbEntities = new Map(snapshot.entities.map(e => [e.id, e]));
  const entityIds = new Set(base.entities.map(e => e.id));
  for (const career of careers.values()) { entityIds.add(career.playerId); entityIds.add(career.teamId); }
  const entities = new Map<string, Entity>();
  for (const id of [...entityIds].sort()) {
    const entity = dbEntities.get(id);
    if (!entity) { conflicts.push(`entity ${id} DB'de yok`); continue; }
    entities.set(id, entity);
    if (entity.countryId && !entities.has(entity.countryId)) {
      const country = dbEntities.get(entity.countryId);
      if (!country) conflicts.push(`country ${entity.countryId} DB'de yok`);
      else entities.set(country.id, country);
    }
  }
  for (const entity of entities.values()) {
    if (!entity.countryId || entities.has(entity.countryId)) continue;
    const country = dbEntities.get(entity.countryId);
    if (!country) conflicts.push(`country ${entity.countryId} DB'de yok`);
    else entities.set(country.id, country);
  }

  const dbSources = new Map(snapshot.sources.map(s => [s.id, s]));
  const sourceIds = new Set(base.sources.map(s => s.id));
  for (const career of careers.values()) { sourceIds.add(career.sourceId); sourceIds.add(career.evidenceId); }
  for (const entity of entities.values()) sourceIds.add(entity.sourceId);
  const sources = new Map<string, Source>();
  for (const id of [...sourceIds].sort()) {
    const source = dbSources.get(id);
    if (!source) { conflicts.push(`source ${id} DB'de yok`); continue; }
    sources.set(id, source);
  }

  const dataset: Dataset = canonicalDataset({
    version: base.version,
    sources: [...sources.values()],
    entities: [...entities.values()],
    careers: [...careers.values()],
  });
  if (conflicts.length) return { dataset, added, changed, conflicts };
  try { validateDataset(dataset); }
  catch (error) { conflicts.push(`export doğrulaması: ${error instanceof Error ? error.message : String(error)}`); }
  return { dataset, added, changed, conflicts };
}

export async function readExportSnapshot(pool: Pool, base: Dataset): Promise<ExportSnapshot> {
  const baseCareers = new Set(base.careers.map(c => c.id));
  const baseEntities = new Set(base.entities.map(e => e.id));
  const baseSources = new Set(base.sources.map(s => s.id));

  const review = await pool.query<{ career_id: string; status: string }>('SELECT career_id,status FROM football_review');
  const reviewStatus = new Map(review.rows.map(row => [row.career_id, row.status]));

  const careerRows = await pool.query<{
    id: string; player_id: string; team_id: string; from_year: number | null; to_year: number | null;
    appeared: boolean; verified: boolean; source_id: string; evidence_id: string; provenance: unknown;
  }>(`SELECT c.id,c.player_id,c.team_id,c.from_year,c.to_year,c.appeared,c.verified,c.source_id,c.evidence_id,c.provenance
    FROM football_career c LEFT JOIN football_review r ON r.career_id=c.id
    WHERE c.id=ANY($1::text[]) OR r.status='approved' ORDER BY c.id`, [[...baseCareers]]);
  const careers: Career[] = careerRows.rows.map(row => ({
    id: row.id, playerId: row.player_id, teamId: row.team_id,
    ...(row.from_year === null ? {} : { fromYear: row.from_year }),
    ...(row.to_year === null ? {} : { toYear: row.to_year }),
    appeared: row.appeared, verified: row.verified, sourceId: row.source_id, evidenceId: row.evidence_id,
    provenance: (row.provenance ?? {}) as Record<string, unknown>,
  }));
  for (const row of review.rows) {
    if (row.status === 'approved' && !careers.some(c => c.id === row.career_id)) {
      // Loader must include it; the query above does, so this is defensive.
      throw new Error(`Onaylı kariyer yüklenemedi: ${row.career_id}`);
    }
  }

  const entityIds = new Set(baseEntities);
  for (const career of careers) { entityIds.add(career.playerId); entityIds.add(career.teamId); }
  const baseEntityRows = await pool.query<{ id: string; country_id: string | null }>(
    'SELECT id,country_id FROM football_entity WHERE id=ANY($1::text[])', [[...baseEntities]]);
  for (const row of baseEntityRows.rows) if (row.country_id) entityIds.add(row.country_id);
  const entityRows = await pool.query<{
    id: string; kind: Entity['kind']; name: string; country_id: string | null;
    birth_date: string | null; source_id: string; level: Entity['level'] | null; mark: string;
    aliases: string[] | null;
  }>(`SELECT e.id,e.kind,e.name,e.country_id,e.birth_date::text,e.source_id,e.level,e.mark,
      COALESCE(array_agg(a.label ORDER BY a.label) FILTER (WHERE a.label IS NOT NULL),ARRAY[]::text[]) AS aliases
    FROM football_entity e LEFT JOIN football_alias a ON a.entity_id=e.id
    WHERE e.id=ANY($1::text[]) GROUP BY e.id ORDER BY e.id`, [[...entityIds]]);
  const entities: Entity[] = entityRows.rows.map(row => ({
    id: row.id, kind: row.kind, name: row.name, aliases: row.aliases ?? [],
    ...(row.country_id ? { countryId: row.country_id } : {}),
    ...(row.birth_date ? { birthDate: row.birth_date } : {}),
    sourceId: row.source_id, ...(row.level ? { level: row.level } : {}), mark: row.mark,
  }));

  const sourceIds = new Set(baseSources);
  for (const career of careers) { sourceIds.add(career.sourceId); sourceIds.add(career.evidenceId); }
  for (const entity of entities) sourceIds.add(entity.sourceId);
  const sourceRows = await pool.query<{ id: string; url: string; license: Source['license']; retrieved: string }>(
    'SELECT id,url,license,retrieved::text FROM football_source WHERE id=ANY($1::text[]) ORDER BY id', [[...sourceIds]]);
  const sources: Source[] = sourceRows.rows.map(row => ({ id: row.id, url: row.url, license: row.license, retrieved: row.retrieved }));

  return { careers, entities, sources, reviewStatus };
}
