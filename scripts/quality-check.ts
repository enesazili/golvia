import { readFile } from 'node:fs/promises';
import { validateDataset } from '../src/server/football/importer.ts';
import type { Dataset } from '../src/server/football/types.ts';
const path = process.argv[2] || 'data/football-wikidata.json';
try {
  const raw: unknown = JSON.parse(await readFile(path, 'utf8'));
  validateDataset(raw);
  const data = raw as Dataset & { review?: unknown[]; collection?: unknown; counts?: unknown };
  const ids = new Set(data.entities.map(e => e.id));
  console.log(JSON.stringify({
    file: path, version: data.version, players: data.entities.filter(e => e.kind === 'player').length,
    clubs: data.entities.filter(e => e.kind === 'club').length,
    seniorClubs: data.entities.filter(e => e.kind === 'club' && e.level === 'senior').length,
    clubCandidates: data.entities.filter(e => e.kind === 'club' && e.level === 'unknown').length,
    seniorNationalTeams: data.entities.filter(e => e.kind === 'national_team' && e.level === 'senior').length,
    youthNationalTeams: data.entities.filter(e => e.kind === 'national_team' && e.level === 'youth').length,
    careers: data.careers.length, verified: data.careers.filter(c => c.verified && c.appeared).length,
    unverified: data.careers.filter(c => !c.verified).length, uniqueEntities: ids.size,
    reviewRecords: data.review?.length ?? 0, collection: data.collection ?? 'Reviewed seed, not a collection completion claim',
    collectionCounts: data.counts, note: 'Same names are not duplicates; identity is the ID. Missing links mean unknown, not disproved.'
  }, null, 2));
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
