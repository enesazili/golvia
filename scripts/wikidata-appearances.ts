/**
 * Build a bulk, independently licensed appearance snapshot from Wikidata.
 *
 * Only P54 (member of sports team) statements with a P1350 (number of matches
 * played) qualifier >= 1 are used. P54 alone is membership and is never treated
 * as appearance evidence. Targets are curated senior clubs and senior national
 * teams; youth/reserve teams are not in the target list.
 *
 * The generated dataset is additive. It never overwrites reviewed entities,
 * aliases or careers. Importing it inserts the source as unresolved; live use
 * still requires the explicit setSourceClearance gate (or `--import`).
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import type { Career, Dataset, Entity, Source } from '../src/server/football/types.ts';
import { importDataset, setSourceClearance, validateDataset } from '../src/server/football/importer.ts';
import {
  APPEARANCE_BASIS, appearanceCareerId, mergeAppearanceRows,
  type AppearanceRow, type MergedAppearance,
} from '../src/server/football/appearances.ts';
import { selectionCoverage } from '../src/server/football/quality.ts';

type Catalog = { clubs: { id: string; name: string; country?: string }[] };
type Priority = { clubs: { id: string; name: string; countryId?: string }[] };
type Obj = Record<string, unknown>;

export type AppearanceTargets = {
  version: string;
  retrieved: string;
  source: { id: string; url: string; license: 'CC0-1.0' };
  rule: string;
  licenseNote?: string;
  countries: { id: string; name: string }[];
  clubCountryIds: Record<string, string>;
  nationalTeams: { id: string; name: string; countryId: string }[];
};

type PlayerMeta = { name: string; aliases: string[]; birthDate?: string };
type RawSnapshot = {
  version: string;
  retrieved: string;
  targetIds: string[];
  discoveryDone: boolean;
  membershipDone: boolean;
  players: string[];
  rows: AppearanceRow[];
  metadata: Record<string, PlayerMeta>;
};

const QID = /^Q\d+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
const values = (ids: string[]) => ids.map(id => `wd:${id}`).join(' ');
const qid = (uri: unknown) => typeof uri === 'string' ? uri.slice(uri.lastIndexOf('/') + 1) : '';
const isObj = (value: unknown): value is Obj => !!value && typeof value === 'object' && !Array.isArray(value);

function year(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.startsWith('+')) return undefined;
  const match = /^\+(\d{4})-/.exec(value);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed >= 1800 && parsed <= 2200 ? parsed : undefined;
}

function birthDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^\+(\d{4})-(\d{2})-(\d{2})T/.exec(value);
  if (!match || Number(match[2]) < 1 || Number(match[3]) < 1) return undefined;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return Number.isFinite(Date.parse(date)) ? date : undefined;
}

export function validateTargets(input: unknown): asserts input is AppearanceTargets {
  if (!isObj(input)) throw new Error('Invalid appearance targets');
  const t = input as unknown as AppearanceTargets;
  if (typeof t.version !== 'string' || !t.version.startsWith('wikidata-appearances-')) throw new Error('Invalid appearance target version');
  if (typeof t.retrieved !== 'string' || !DATE.test(t.retrieved) || !Number.isFinite(Date.parse(t.retrieved))) throw new Error('Invalid appearance retrieval date');
  if (!isObj(t.source) || typeof t.source.id !== 'string' || !t.source.id.trim() || !/^https:\/\//.test(String(t.source.url)) || t.source.license !== 'CC0-1.0') throw new Error('Appearance source must be a CC0-1.0 HTTPS source');
  if (typeof t.rule !== 'string' || t.rule.length < 10) throw new Error('Appearance rule is required');
  if (!Array.isArray(t.countries) || !Array.isArray(t.nationalTeams) || !isObj(t.clubCountryIds)) throw new Error('Invalid appearance target shape');
  const countries = new Set<string>();
  for (const country of t.countries) {
    if (!isObj(country) || typeof country.id !== 'string' || !QID.test(country.id) || typeof country.name !== 'string' || !country.name.trim() || countries.has(country.id)) throw new Error('Invalid appearance country');
    countries.add(country.id);
  }
  const teams = new Set<string>();
  for (const team of t.nationalTeams) {
    if (!isObj(team) || typeof team.id !== 'string' || !QID.test(team.id) || typeof team.name !== 'string' || !team.name.trim() || typeof team.countryId !== 'string' || !countries.has(team.countryId) || teams.has(team.id)) throw new Error('Invalid appearance national team');
    teams.add(team.id);
  }
  for (const [name, id] of Object.entries(t.clubCountryIds)) {
    if (!name.trim() || typeof id !== 'string' || !countries.has(id)) throw new Error('Invalid club country mapping');
  }
}

class Transport {
  private last = 0;
  constructor(private readonly userAgent: string, private readonly delayMs: number) {}
  async json(url: string, label: string): Promise<Obj> {
    if (!this.userAgent.trim()) throw new Error('WIKIDATA_USER_AGENT is required for live collection');
    for (let attempt = 0; attempt < 5; attempt++) {
      const wait = this.last + this.delayMs - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': this.userAgent, Accept: 'application/sparql-results+json' },
          signal: AbortSignal.timeout(60_000),
        });
        this.last = Date.now();
        const text = await response.text();
        if (response.ok) {
          if (!text.trimStart().startsWith('{')) throw new Error('Malformed SPARQL response');
          return JSON.parse(text) as Obj;
        }
        if ([429, 503, 504].includes(response.status)) {
          await sleep(Math.min(90_000, 5_000 * (attempt + 1)));
          continue;
        }
        throw new Error(`SPARQL ${response.status}: ${text.slice(0, 200)}`);
      } catch (error) {
        if (attempt === 4) throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
        await sleep(5_000 * (attempt + 1));
      }
    }
    throw new Error(`${label}: SPARQL failed`);
  }
  async sparql(query: string, label: string): Promise<Obj[]> {
    const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
    const data = await this.json(url, label);
    const rows = (data as { results?: { bindings?: Obj[] } }).results?.bindings;
    if (!Array.isArray(rows)) throw new Error(`${label}: malformed SPARQL result`);
    return rows;
  }
}

function bindings(rows: Obj[], key: string): string[] {
  return rows.map(row => {
    const binding = row[key];
    return isObj(binding) && typeof binding.value === 'string' ? binding.value : '';
  }).filter(Boolean);
}

async function discover(transport: Transport, targets: string[], snapshot: RawSnapshot) {
  const players = new Set(snapshot.players);
  for (let i = 0; i < targets.length; i += 8) {
    const batch = targets.slice(i, i + 8);
    const rows = await transport.sparql(`SELECT DISTINCT ?player WHERE {
      VALUES ?seedteam { ${values(batch)} }
      ?player wdt:P31 wd:Q5; p:P54 ?statement .
      ?statement ps:P54 ?seedteam; pq:P1350 ?matches .
      FILTER(?matches >= 1)
    }`, 'discovery');
    for (const uri of bindings(rows, 'player')) {
      const id = qid(uri);
      if (QID.test(id)) players.add(id);
    }
    snapshot.players = [...players];
    console.log(JSON.stringify({ phase: 'discovery', batch: Math.min(i + 8, targets.length), targets: targets.length, players: players.size }));
  }
  snapshot.discoveryDone = true;
}

async function memberships(transport: Transport, targets: string[], snapshot: RawSnapshot) {
  const targetSet = new Set(targets);
  const playerIds = [...new Set(snapshot.players)];
  const seen = new Set(snapshot.rows.map(row => `${row.playerId}|${row.teamId}|${row.statementId}`));
  for (let i = 0; i < playerIds.length; i += 200) {
    const chunk = playerIds.slice(i, i + 200);
    const rows = await transport.sparql(`SELECT ?player ?team ?statement ?matches ?start ?end WHERE {
      VALUES ?player { ${values(chunk)} }
      VALUES ?team { ${values(targets)} }
      ?player p:P54 ?statement .
      ?statement ps:P54 ?team; pq:P1350 ?matches .
      FILTER(?matches >= 1)
      OPTIONAL { ?statement pq:P580 ?start }
      OPTIONAL { ?statement pq:P582 ?end }
    }`, 'membership');
    for (const row of rows) {
      const playerId = qid(isObj(row.player) ? row.player.value : '');
      const teamId = qid(isObj(row.team) ? row.team.value : '');
      const statementId = qid(isObj(row.statement) ? row.statement.value : '');
      const matchValue = isObj(row.matches) && typeof row.matches.value === 'string' ? Number(row.matches.value.replace(/^\+/, '')) : 0;
      if (!QID.test(playerId) || !targetSet.has(teamId) || !statementId || !Number.isInteger(matchValue) || matchValue < 1) continue;
      const key = `${playerId}|${teamId}|${statementId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      snapshot.rows.push({
        playerId, teamId, statementId, appearances: matchValue,
        ...(year(isObj(row.start) ? row.start.value : undefined) !== undefined ? { fromYear: year(isObj(row.start) ? row.start.value : undefined) } : {}),
        ...(year(isObj(row.end) ? row.end.value : undefined) !== undefined ? { toYear: year(isObj(row.end) ? row.end.value : undefined) } : {}),
      });
    }
    if (i % 2000 === 0) console.log(JSON.stringify({ phase: 'membership', players: Math.min(i + 200, playerIds.length), total: playerIds.length, rows: snapshot.rows.length }));
  }
  snapshot.membershipDone = true;
}

function retainedPlayers(snapshot: RawSnapshot): { players: Set<string>; careers: MergedAppearance[] } {
  const careers = mergeAppearanceRows(snapshot.rows);
  const byPlayer = new Map<string, Set<string>>();
  for (const career of careers) {
    const teams = byPlayer.get(career.playerId) ?? new Set<string>();
    teams.add(career.teamId);
    byPlayer.set(career.playerId, teams);
  }
  const players = new Set([...byPlayer].filter(([, teams]) => teams.size >= 2).map(([id]) => id));
  return { players, careers: careers.filter(career => players.has(career.playerId)) };
}

async function metadata(transport: Transport, players: string[], snapshot: RawSnapshot) {
  const missing = players.filter(id => !snapshot.metadata[id]);
  for (let i = 0; i < missing.length; i += 200) {
    const chunk = missing.slice(i, i + 200);
    const rows = await transport.sparql(`SELECT ?player ?trLabel ?enLabel ?birth ?alias ?nick ?short WHERE {
      VALUES ?player { ${values(chunk)} }
      OPTIONAL { ?player rdfs:label ?trLabel FILTER(lang(?trLabel) = "tr") }
      OPTIONAL { ?player rdfs:label ?enLabel FILTER(lang(?enLabel) = "en") }
      OPTIONAL { ?player wdt:P569 ?birth }
      OPTIONAL { ?player skos:altLabel ?alias FILTER(lang(?alias) IN ("tr", "en")) }
      OPTIONAL { ?player wdt:P1449 ?nick FILTER(lang(?nick) IN ("tr", "en")) }
      OPTIONAL { ?player wdt:P1813 ?short FILTER(lang(?short) IN ("tr", "en")) }
    }`, 'metadata');
    const grouped = new Map<string, { tr?: string; en?: string; birth?: string; labels: string[] }>();
    for (const row of rows) {
      const id = qid(isObj(row.player) ? row.player.value : '');
      if (!QID.test(id)) continue;
      const group = grouped.get(id) ?? { labels: [] };
      const tr = isObj(row.trLabel) && typeof row.trLabel.value === 'string' ? row.trLabel.value : undefined;
      const en = isObj(row.enLabel) && typeof row.enLabel.value === 'string' ? row.enLabel.value : undefined;
      if (tr && !group.tr) group.tr = tr;
      if (en && !group.en) group.en = en;
      if (!group.birth) group.birth = birthDate(isObj(row.birth) ? row.birth.value : undefined);
      for (const key of ['alias', 'nick', 'short']) {
        const value = isObj(row[key]) && typeof row[key].value === 'string' ? row[key].value : undefined;
        if (value) group.labels.push(value);
      }
      grouped.set(id, group);
    }
    for (const [id, group] of grouped) {
      const name = (group.tr ?? group.en ?? group.labels[0] ?? '').trim();
      if (!name || name.length > 500) continue;
      const aliases = [...new Set([group.en, ...group.labels].filter((value): value is string => !!value && value.trim().length > 0 && value.length <= 500 && value !== name))];
      snapshot.metadata[id] = { name, aliases, ...(group.birth ? { birthDate: group.birth } : {}) };
    }
    console.log(JSON.stringify({ phase: 'metadata', players: Math.min(i + 200, missing.length), total: missing.length, stored: Object.keys(snapshot.metadata).length }));
  }
}

export function buildDataset(input: {
  targets: AppearanceTargets;
  catalog: Catalog;
  priority: Priority;
  snapshot: RawSnapshot;
  reviewedPairs?: Set<string>;
}): Dataset {
  const { targets, catalog, priority, snapshot } = input;
  const reviewedPairs = input.reviewedPairs ?? new Set<string>();
  const source: Source = {
    id: targets.source.id,
    url: targets.source.url,
    license: targets.source.license,
    retrieved: targets.retrieved,
    usagePermission: 'unresolved',
  };
  const countries = targets.countries;
  const teams = new Map<string, Entity>();
  for (const country of countries) {
    teams.set(country.id, { id: country.id, kind: 'country', name: country.name, aliases: [], sourceId: source.id });
  }
  for (const team of targets.nationalTeams) {
    teams.set(team.id, { id: team.id, kind: 'national_team', name: team.name, aliases: [], countryId: team.countryId, level: 'senior', sourceId: source.id });
  }
  const clubIds = new Set<string>();
  for (const club of catalog.clubs) {
    if (clubIds.has(club.id) || teams.has(club.id)) continue;
    clubIds.add(club.id);
    const countryId = club.country ? targets.clubCountryIds[club.country] : undefined;
    teams.set(club.id, { id: club.id, kind: 'club', name: club.name, aliases: [], ...(countryId ? { countryId } : {}), level: 'senior', sourceId: source.id });
  }
  for (const club of priority.clubs) {
    if (clubIds.has(club.id) || teams.has(club.id)) continue;
    clubIds.add(club.id);
    teams.set(club.id, { id: club.id, kind: 'club', name: club.name, aliases: [], ...(club.countryId ? { countryId: club.countryId } : {}), level: 'senior', sourceId: source.id });
  }
  const { careers: merged } = retainedPlayers(snapshot);
  const retrievedYear = Number(targets.retrieved.slice(0, 4));
  // A player born after this cutoff cannot have a senior appearance yet; such
  // dates are upstream data errors (e.g. a 2020 birth filtered to 2012).
  const latestBirthYear = retrievedYear - 14;
  // Career years outside a football-plausible window are dropped instead of
  // stored as a fabricated interval; the appearance evidence stays intact.
  const seasonYear = (value: number | undefined) =>
    value !== undefined && value >= 1880 && value <= retrievedYear + 1 ? value : undefined;
  const candidates: Career[] = [];
  for (const career of merged) {
    if (reviewedPairs.has(`${career.playerId}:${career.teamId}`)) continue;
    const team = teams.get(career.teamId);
    if (!team || team.level !== 'senior' || (team.kind !== 'club' && team.kind !== 'national_team')) continue;
    const fromYear = seasonYear(career.fromYear);
    const toYear = seasonYear(career.toYear);
    candidates.push({
      id: appearanceCareerId(career.playerId, career.teamId),
      playerId: career.playerId,
      teamId: career.teamId,
      ...(fromYear !== undefined ? { fromYear } : {}),
      ...(toYear !== undefined ? { toYear } : {}),
      appeared: true,
      verified: true,
      sourceId: source.id,
      evidenceId: source.id,
      provenance: {
        basis: APPEARANCE_BASIS,
        rule: targets.rule,
        appearances: career.appearances,
        statementIds: career.statementIds,
        retrieved: targets.retrieved,
        teamKind: team.kind,
        teamLevel: 'senior',
        license: 'CC0-1.0',
      },
    });
  }
  // Reviewed pairs are skipped above, so re-check that every retained player
  // still connects at least two selections and has a searchable label.
  const byPlayer = new Map<string, Career[]>();
  for (const career of candidates) byPlayer.set(career.playerId, [...(byPlayer.get(career.playerId) ?? []), career]);
  const kept = new Set([...byPlayer].filter(([id, rows]) => {
    if (rows.length < 2 || !snapshot.metadata[id]) return false;
    const birth = snapshot.metadata[id].birthDate;
    return !birth || Number(birth.slice(0, 4)) <= latestBirthYear;
  }).map(([id]) => id));
  const careers = candidates.filter(career => kept.has(career.playerId));
  const playerEntities: Entity[] = [...kept].sort().map(id => {
    const meta = snapshot.metadata[id];
    return { id, kind: 'player', name: meta.name, aliases: meta.aliases, ...(meta.birthDate ? { birthDate: meta.birthDate } : {}), sourceId: source.id };
  });
  const dataset: Dataset = {
    version: targets.version,
    origin: 'wikidata-appearances',
    sources: [source],
    entities: [...countries.map(c => teams.get(c.id)!), ...targets.nationalTeams.map(t => teams.get(t.id)!),
      ...[...clubIds].sort().map(id => teams.get(id)!), ...playerEntities],
    careers,
  };
  validateDataset(dataset);
  return dataset;
}

export function summarize(dataset: Dataset) {
  const entities = new Map(dataset.entities.map(entity => [entity.id, entity]));
  const selections = new Set<string>();
  for (const entity of dataset.entities) {
    if (entity.kind === 'national_team' && entity.countryId) selections.add(entity.countryId);
    else if (entity.kind === 'club') selections.add(entity.id);
  }
  const mapped = dataset.careers.map(career => {
    const team = entities.get(career.teamId);
    return { playerId: career.playerId, teamId: team?.kind === 'national_team' ? team.countryId! : career.teamId };
  });
  const matched = new Set([...selections].filter(id => mapped.some(row => row.teamId === id)));
  const coverage = selectionCoverage([...selections], mapped, matched);
  const players = new Set(dataset.careers.map(career => career.playerId));
  const playableClubs = dataset.entities.filter(entity => entity.kind === 'club' && matched.has(entity.id)).length;
  const playableNationalTeams = dataset.entities.filter(entity => entity.kind === 'national_team' && entity.countryId && matched.has(entity.countryId)).length;
  return {
    players: players.size,
    answerCapablePlayers: coverage.multiSelectionPlayers,
    careers: dataset.careers.length,
    targetClubs: dataset.entities.filter(entity => entity.kind === 'club').length,
    targetNationalTeams: dataset.entities.filter(entity => entity.kind === 'national_team').length,
    playableClubs,
    playableNationalTeams,
    selections: coverage.selections,
    pairs: coverage.pairs,
    sharedPairs: coverage.sharedPairs,
    nonSharedPairs: coverage.nonSharedPairs,
    averageCareerLinksPerPlayer: players.size ? Number((dataset.careers.length / players.size).toFixed(2)) : 0,
  };
}

function flag(args: string[], name: string, fallback: string) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function readReviewedPairs(): Promise<Set<string>> {
  try {
    const reviewed = await readJson<Dataset>(resolve('data/football.reviewed.json'));
    return new Set(reviewed.careers.map(career => `${career.playerId}:${career.teamId}`));
  } catch {
    return new Set();
  }
}

export async function main(args = process.argv.slice(2)) {
  const offline = args.includes('--offline');
  const importDb = args.includes('--import');
  const targetPath = resolve(flag(args, 'targets', 'data/football.appearance-targets.json'));
  const catalogPath = resolve(flag(args, 'catalog', 'data/club-catalog.top100.json'));
  const priorityPath = resolve(flag(args, 'priority', 'data/club-catalog.priority.json'));
  const rawPath = resolve(flag(args, 'raw', '.local/wikidata-appearances/raw.json'));
  const outPath = resolve(flag(args, 'out', 'data/football-wikidata-appearances.json'));
  const delayMs = Math.max(500, Number(flag(args, 'delay', '1200')) || 1200);
  const targetsInput: unknown = await readJson(targetPath);
  validateTargets(targetsInput);
  const targets = targetsInput;
  const catalog = await readJson<Catalog>(catalogPath);
  const priority = await readJson<Priority>(priorityPath).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { clubs: [] as Priority['clubs'] };
    throw error;
  });
  for (const [name, clubs] of [['catalog', catalog.clubs], ['priority', priority.clubs]] as const) {
    if (!Array.isArray(clubs) || clubs.some(club => !QID.test(club.id) || !club.name?.trim())) throw new Error(`Invalid ${name} clubs`);
  }
  const targetIds = [...new Set([...catalog.clubs.map(club => club.id), ...priority.clubs.map(club => club.id), ...targets.nationalTeams.map(team => team.id)])];
  let snapshot: RawSnapshot;
  if (offline) {
    snapshot = await readJson<RawSnapshot>(rawPath);
    if (!snapshot.discoveryDone || !snapshot.membershipDone) throw new Error('Offline snapshot is incomplete');
    const expected = [...targetIds].sort().join(',');
    const actual = [...snapshot.targetIds].sort().join(',');
    if (expected !== actual) throw new Error('Offline snapshot targets do not match the current target list');
  } else {
    const transport = new Transport(process.env.WIKIDATA_USER_AGENT ?? '', delayMs);
    snapshot = { version: targets.version, retrieved: targets.retrieved, targetIds, discoveryDone: false, membershipDone: false, players: [], rows: [], metadata: {} };
    await mkdir(dirname(rawPath), { recursive: true });
    await discover(transport, targetIds, snapshot);
    await writeFile(rawPath, JSON.stringify(snapshot));
    await memberships(transport, targetIds, snapshot);
    await writeFile(rawPath, JSON.stringify(snapshot));
    const { players } = retainedPlayers(snapshot);
    await metadata(transport, [...players], snapshot);
  }
  const dataset = buildDataset({ targets, catalog, priority, snapshot, reviewedPairs: await readReviewedPairs() });
  await mkdir(dirname(outPath), { recursive: true });
  const temporary = `${outPath}.tmp`;
  await writeFile(temporary, JSON.stringify(dataset));
  await rename(temporary, outPath);
  console.log(JSON.stringify({ output: outPath, raw: rawPath, ...summarize(dataset), source: targets.source.id, license: targets.source.license }, null, 2));
  if (importDb) {
    const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_ADMIN_URL or DATABASE_URL required for --import');
    const pool = new Pool({ connectionString: url, max: 1 });
    try {
      await importDataset(pool, dataset);
      await setSourceClearance(pool, {
        sourceId: targets.source.id,
        status: 'cleared',
        basis: 'CC0-1.0',
        evidence: `Wikidata structured data CC0-1.0 snapshot ${targets.retrieved}; rule: ${targets.rule}`,
        reviewedBy: 'dataset:wikidata-appearances',
      });
      console.log(JSON.stringify({ imported: true, source: targets.source.id, clearance: 'cleared' }));
    } finally { await pool.end(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
