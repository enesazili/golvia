/**
 * Builds a Transfermarkt candidate dataset from a local DuckDB snapshot.
 *
 * Evidence rules:
 * - Only appearance rows prove that a player actually played for a club or national team.
 * - Transfer records are exported separately and never turn a career into appeared/verified.
 * - Every produced career keeps verified=false; human review is still required before play.
 * - Clubs present in match rows but missing from the clubs table are recovered from the
 *   same games rows (home_club_name / away_club_name), never guessed.
 *
 * No network access. Run: npm run data:transfermarkt -- --duckdb .local/tm/tm.duckdb
 */
import { execFile } from 'node:child_process';
import { access, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import {
  auditIdentityLinks, findPendingMatches, matchIdentities,
  type ExistingIdentity, type ExternalClub, type ExternalCountry, type ExternalNationalTeam, type ExternalPlayer, type ManualIdentityLink,
} from '../src/server/football/identity.ts';
import { validateDataset } from '../src/server/football/importer.ts';
import { catalogCoverage, classifyTeamLevel, selectionCoverage, summarizeCareers } from '../src/server/football/quality.ts';
import type { Career, Dataset, Entity, IdentityLink, Source, Transfer } from '../src/server/football/types.ts';

const DEFAULT_LEAGUES = ['TR1', 'IT1', 'GB1', 'ES1', 'DE1', 'FR1', 'NL1', 'PO1', 'BE1'];
const DEFAULT_CUPS = ['CL', 'EL'];
const SNAPSHOT = '2026-07-06';

type Args = {
  duckdb: string; out: string; report: string; catalog: string; identities?: string; identitiesDb?: string;
  aliases: string; retrieved: string; leagues: string[]; cups: string[];
};
function args(): Args {
  const value = (name: string) => { const index = process.argv.indexOf(`--${name}`); return index > 0 ? process.argv[index + 1] : undefined; };
  const leagues = value('leagues');
  const cups = value('cups');
  return {
    duckdb: value('duckdb') ?? '.local/tm/tm.duckdb',
    out: value('out') ?? 'data/football-transfermarkt.json',
    report: value('report') ?? 'data/football-transfermarkt.quality.json',
    catalog: value('catalog') ?? 'data/club-catalog.top100.json',
    identities: value('identities') ?? 'data/football.reviewed.json',
    identitiesDb: value('identities-db') ?? process.env.GOLVIA_IDENTITY_DATABASE_URL,
    aliases: value('aliases') ?? 'data/identity-aliases.json',
    retrieved: value('retrieved') ?? new Date().toISOString().slice(0, 10),
    leagues: leagues ? leagues.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_LEAGUES,
    cups: cups ? cups.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_CUPS,
  };
}

function duck(bin: string, db: string, sql: string): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    execFile(bin, [db, '-no-agent', '-json', '-c', sql], { maxBuffer: 1024 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) { reject(new Error(stderr.trim() || error.message)); return; }
      const output = stdout.trim();
      try { resolve(output ? JSON.parse(output) as Record<string, unknown>[] : []); }
      catch { reject(new Error(`DuckDB returned unreadable JSON: ${output.slice(0, 200)}`)); }
    });
  });
}

const quoted = (ids: string[]) => ids.map(id => `'${id.replace(/[^A-Za-z0-9]/g, '')}'`).join(',');
const num = (value: unknown) => value === null || value === undefined ? undefined : Number(value);
const text = (value: unknown) => value === null || value === undefined ? undefined : String(value);

async function existingIdentities(opts: Args): Promise<ExistingIdentity[]> {
  if (opts.identitiesDb) {
    const pool = new Pool({ connectionString: opts.identitiesDb, max: 1 });
    try {
      const result = await pool.query(`SELECT e.id,e.kind,e.name,e.birth_date::text AS birth_date,e.country_id,e.level,
          coalesce(array_agg(a.label) FILTER (WHERE a.label <> e.name AND a.label IS NOT NULL), '{}') AS aliases
        FROM football_entity e LEFT JOIN football_alias a ON a.entity_id=e.id
        GROUP BY e.id,e.kind,e.name,e.birth_date,e.country_id,e.level`);
      return result.rows.map(row => ({
        id: row.id, kind: row.kind, name: row.name, birthDate: row.birth_date ?? undefined,
        countryId: row.country_id ?? undefined, aliases: row.aliases ?? [], level: row.level ?? undefined,
      }));
    } finally { await pool.end(); }
  }
  const parsed = JSON.parse(await readFile(opts.identities!, 'utf8')) as { entities?: ExistingIdentity[] };
  if (!Array.isArray(parsed.entities)) throw new Error(`No entities in ${opts.identities}`);
  return parsed.entities.map(e => ({ id: e.id, kind: e.kind, name: e.name, birthDate: e.birthDate, countryId: e.countryId, aliases: e.aliases ?? [], level: e.level }));
}

async function manualLinks(path: string): Promise<ManualIdentityLink[]> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as { links?: ManualIdentityLink[] };
    if (!Array.isArray(parsed.links)) throw new Error(`No links in ${path}`);
    return parsed.links;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function main() {
  const opts = args();
  const bin = process.env.DUCKDB_BIN ?? join(process.cwd(), '.local/tm/duckdb');
  for (const path of [bin, opts.duckdb]) {
    try { await access(path); }
    catch { throw new Error(`Missing ${path}. Download the DuckDB snapshot into .local/tm (see data/README.md) or pass --duckdb.`); }
  }
  const scope = `SELECT club_id FROM clubs WHERE domestic_competition_id IN (${quoted(opts.leagues)})
    UNION SELECT home_club_id FROM games WHERE competition_id IN (${quoted(opts.cups)})
    UNION SELECT away_club_id FROM games WHERE competition_id IN (${quoted(opts.cups)})`;
  await duck(bin, opts.duckdb, `CREATE OR REPLACE VIEW scope_clubs AS ${scope};`);

  const clubRows = await duck(bin, opts.duckdb, `SELECT c.club_id,c.name,c.domestic_competition_id AS competition_id,comp.country_name
      FROM clubs c LEFT JOIN competitions comp ON comp.competition_id=c.domestic_competition_id ORDER BY c.club_id`);
  const countryRows = await duck(bin, opts.duckdb, 'SELECT country_id,country_name FROM countries ORDER BY country_id');
  const ntRows = await duck(bin, opts.duckdb, `SELECT nt.national_team_id,nt.name,nt.country_id FROM national_teams nt
      WHERE EXISTS(SELECT 1 FROM appearances a JOIN games g ON g.game_id=a.game_id
        WHERE a.player_club_id=nt.national_team_id AND g.competition_type='national_team_competition') ORDER BY nt.national_team_id`);
  const playerRows = await duck(bin, opts.duckdb, `SELECT p.player_id,p.name,p.date_of_birth::date::text AS birth_date FROM players p
      WHERE EXISTS(SELECT 1 FROM appearances a WHERE a.player_id=p.player_id AND a.player_club_id IN (SELECT club_id FROM scope_clubs))
         OR EXISTS(SELECT 1 FROM appearances a JOIN games g ON g.game_id=a.game_id
            WHERE a.player_id=p.player_id AND g.competition_type='national_team_competition' AND a.player_club_id IN (SELECT national_team_id FROM national_teams))
      ORDER BY p.player_id`);
  const clubCareerRows = await duck(bin, opts.duckdb, `SELECT a.player_id,a.player_club_id AS team_id,min(a.date)::text AS first_date,max(a.date)::text AS last_date,
        count(*) AS appearances,coalesce(sum(a.goals),0) AS goals,coalesce(sum(a.assists),0) AS assists,
        coalesce(sum(a.minutes_played),0) AS minutes,string_agg(DISTINCT a.competition_id,',') AS competitions
      FROM appearances a JOIN games g ON g.game_id=a.game_id
      WHERE coalesce(g.competition_type,'')<>'national_team_competition' AND a.player_club_id IN (SELECT club_id FROM scope_clubs)
      GROUP BY 1,2 ORDER BY 1,2`);
  const ntCareerRows = await duck(bin, opts.duckdb, `SELECT a.player_id,a.player_club_id AS team_id,min(a.date)::text AS first_date,max(a.date)::text AS last_date,
        count(*) AS appearances,coalesce(sum(a.goals),0) AS goals,coalesce(sum(a.assists),0) AS assists,
        coalesce(sum(a.minutes_played),0) AS minutes,string_agg(DISTINCT a.competition_id,',') AS competitions
      FROM appearances a JOIN games g ON g.game_id=a.game_id
      WHERE g.competition_type='national_team_competition' AND a.player_club_id IN (SELECT national_team_id FROM national_teams)
      GROUP BY 1,2 ORDER BY 1,2`);
  const transferRows = await duck(bin, opts.duckdb, `SELECT t.player_id,t.transfer_date::text AS transfer_date,t.transfer_season AS season,
        t.from_club_id,t.to_club_id,t.from_club_name,t.to_club_name,t.transfer_fee,t.market_value_in_eur
      FROM transfers t WHERE EXISTS(SELECT 1 FROM appearances a WHERE a.player_id=t.player_id AND a.player_club_id IN (SELECT club_id FROM scope_clubs))
      ORDER BY t.player_id,t.transfer_date`);

  // Match rows name clubs that are absent from the clubs table. Only the same dataset's
  // game names are used, and only for clubs already inside the selected scope.
  const missingClubRows = await duck(bin, opts.duckdb, `WITH named AS (
        SELECT home_club_id AS club_id,home_club_name AS name FROM games WHERE home_club_id IS NOT NULL
        UNION ALL SELECT away_club_id,away_club_name FROM games WHERE away_club_id IS NOT NULL),
      candidate AS (
        SELECT club_id,any_value(name) AS name FROM named
        WHERE club_id IN (SELECT club_id FROM scope_clubs) AND club_id NOT IN (SELECT club_id FROM clubs) AND name IS NOT NULL
        GROUP BY club_id)
      SELECT c.club_id,c.name FROM candidate c
      WHERE EXISTS(SELECT 1 FROM appearances a WHERE a.player_club_id=c.club_id) ORDER BY c.club_id`);
  const unknownTotals = await duck(bin, opts.duckdb, `WITH unknown AS (
        SELECT a.player_club_id AS club_id,count(*) AS apps,count(DISTINCT a.player_id) AS players
        FROM appearances a JOIN games g ON g.game_id=a.game_id
        WHERE coalesce(g.competition_type,'')<>'national_team_competition' AND a.player_club_id NOT IN (SELECT club_id FROM clubs)
        GROUP BY 1) SELECT count(*) AS clubs,coalesce(sum(apps),0) AS appearances,coalesce(sum(players),0) AS career_groups FROM unknown`);
  const inScopeUnknown = await duck(bin, opts.duckdb, `WITH unknown AS (
        SELECT a.player_club_id AS club_id,count(*) AS apps,count(DISTINCT a.player_id) AS players
        FROM appearances a JOIN games g ON g.game_id=a.game_id
        WHERE coalesce(g.competition_type,'')<>'national_team_competition'
          AND a.player_club_id IN (SELECT club_id FROM scope_clubs) AND a.player_club_id NOT IN (SELECT club_id FROM clubs)
        GROUP BY 1) SELECT count(*) AS clubs,coalesce(sum(apps),0) AS appearances,coalesce(sum(players),0) AS career_groups FROM unknown`);
  const duplicatePlayers = await duck(bin, opts.duckdb, `WITH dup AS (
        SELECT lower(trim(name)) AS nm,date_of_birth FROM players WHERE date_of_birth IS NOT NULL GROUP BY 1,2 HAVING count(*)>1)
      SELECT p.player_id,p.name,p.date_of_birth::date::text AS birth_date FROM players p
      JOIN dup d ON lower(trim(p.name))=d.nm AND p.date_of_birth=d.date_of_birth ORDER BY p.name,p.player_id`);
  const duplicateClubs = await duck(bin, opts.duckdb, `WITH dup AS (SELECT lower(trim(name)) AS nm FROM clubs GROUP BY 1 HAVING count(*)>1)
      SELECT c.club_id,c.name FROM clubs c JOIN dup d ON lower(trim(c.name))=d.nm ORDER BY c.name,c.club_id`);

  const recoveredIds = new Set<string>();
  for (const row of missingClubRows) {
    const id = String(row.club_id);
    if (!text(row.name)) continue;
    recoveredIds.add(id);
    clubRows.push({ club_id: row.club_id, name: row.name, competition_id: null, country_name: null });
  }

  const existing = await existingIdentities(opts);

  const clubs = clubRows.map(row => {
    const name = String(row.name);
    return {
      id: String(row.club_id), name, competitionId: text(row.competition_id), countryName: text(row.country_name),
      recovered: recoveredIds.has(String(row.club_id)), level: classifyTeamLevel(name),
    };
  });
  const countries = countryRows.map(row => ({ id: String(row.country_id), name: String(row.country_name) }));
  const nationalTeams = ntRows.map(row => ({ id: String(row.national_team_id), name: String(row.name), countryId: String(row.country_id) }));
  const players = playerRows.map(row => ({ id: String(row.player_id), name: String(row.name), birthDate: text(row.birth_date) }));
  const playerIds = new Set(players.map(p => p.id));
  const clubById = new Map(clubs.map(c => [c.id, c]));

  const countryNameToExternal = new Map(countries.map(c => [c.name, c.id]));
  const clubCountryId = new Map<string, string>();
  for (const club of clubs) {
    const countryId = club.countryName ? countryNameToExternal.get(club.countryName) : undefined;
    if (countryId) clubCountryId.set(club.id, countryId);
  }

  const externalPlayers: ExternalPlayer[] = players.map(p => ({ id: p.id, name: p.name, birthDate: p.birthDate }));
  const externalClubs: ExternalClub[] = clubs.map(c => ({ id: c.id, name: c.name, countryId: clubCountryId.get(c.id) }));
  const externalCountries: ExternalCountry[] = countries;
  const externalTeams: ExternalNationalTeam[] = nationalTeams;

  const manual = await manualLinks(opts.aliases);
  const match = matchIdentities(existing, { players: externalPlayers, clubs: externalClubs, countries: externalCountries, nationalTeams: externalTeams }, manual);
  const links: IdentityLink[] = [...match.links];

  const linkByExternal = new Map(links.filter(l => l.status === 'confirmed').map(l => [l.externalId, l.entityId]));
  const resolve = (externalId: string) => linkByExternal.get(externalId) ?? externalId;

  const existingCountryById = new Map(existing.map(e => [e.id, e]));
  const existingNationalTeam = new Map<string, string>();
  for (const entity of existing) if (entity.kind === 'national_team' && entity.countryId) existingNationalTeam.set(entity.countryId, entity.id);
  for (const team of nationalTeams) {
    const externalCountry = `tm:country:${team.countryId}`;
    const countryEntity = existingCountryById.get(resolve(externalCountry)) ? resolve(externalCountry) : undefined;
    const existingTeam = countryEntity ? existingNationalTeam.get(countryEntity) : undefined;
    if (!existingTeam) continue;
    match.matched.add(`tm:nt:${team.id}`);
    links.push({ source: 'transfermarkt', externalId: `tm:nt:${team.id}`, entityId: existingTeam, method: 'name+country', status: 'confirmed',
      evidence: { rule: 'national-team-country', externalName: team.name, countryEntity } });
    linkByExternal.set(`tm:nt:${team.id}`, existingTeam);
  }

  const audit = auditIdentityLinks(existing, { players: externalPlayers, clubs: externalClubs, countries: externalCountries, nationalTeams: externalTeams }, links);
  if (audit.length) throw new Error(`Identity audit failed: ${JSON.stringify(audit.slice(0, 5))}`);
  const pending = findPendingMatches(existing, { players: externalPlayers, clubs: externalClubs, countries: externalCountries, nationalTeams: externalTeams }, links);

  const entities: Entity[] = [];
  const sources: Source[] = [
    { id: `tm-dataset-${SNAPSHOT}`, url: 'https://github.com/dcaribou/transfermarkt-datasets', license: 'CC0-1.0', retrieved: opts.retrieved, usagePermission: 'unresolved' },
    { id: `tm-appearances-${SNAPSHOT}`, url: 'https://huggingface.co/datasets/ngeorgea/transfermarkt-player-scores', license: 'CC0-1.0', retrieved: opts.retrieved, usagePermission: 'unresolved' },
    { id: `tm-transfers-${SNAPSHOT}`, url: 'https://huggingface.co/datasets/ngeorgea/transfermarkt-player-scores', license: 'CC0-1.0', retrieved: opts.retrieved, usagePermission: 'unresolved' },
  ];
  const sourceId = sources[0].id, appearanceSourceId = sources[1].id, transferSourceId = sources[2].id;

  for (const country of countries) {
    const externalId = `tm:country:${country.id}`;
    if (match.matched.has(externalId)) continue;
    entities.push({ id: externalId, kind: 'country', name: country.name, aliases: [], sourceId });
  }
  for (const club of clubs) {
    const externalId = `tm:club:${club.id}`;
    if (match.matched.has(externalId)) continue;
    entities.push({ id: externalId, kind: 'club', name: club.name, aliases: [], countryId: clubCountryId.get(club.id) ? resolve(`tm:country:${clubCountryId.get(club.id)}`) : undefined, level: club.level, sourceId });
  }
  for (const team of nationalTeams) {
    const externalId = `tm:nt:${team.id}`;
    if (match.matched.has(externalId)) continue;
    entities.push({ id: externalId, kind: 'national_team', name: team.name, aliases: [], countryId: resolve(`tm:country:${team.countryId}`), level: 'senior', sourceId });
  }
  for (const player of players) {
    const externalId = `tm:player:${player.id}`;
    if (match.matched.has(externalId)) continue;
    entities.push({ id: externalId, kind: 'player', name: player.name, aliases: [], birthDate: player.birthDate, sourceId });
  }

  const careers: Career[] = [];
  const skipped = { unknownPlayer: 0, unknownTeam: 0, noAppearance: 0 };
  const addCareer = (row: Record<string, unknown>, teamExternal: string, teamKind: 'club' | 'nt') => {
    const playerId = String(row.player_id);
    if (!playerIds.has(playerId)) { skipped.unknownPlayer++; return; }
    const appearances = Number(row.appearances);
    if (!(appearances >= 1)) { skipped.noAppearance++; return; }
    const first = String(row.first_date), last = String(row.last_date);
    const externalPlayer = `tm:player:${playerId}`;
    const externalTeam = teamKind === 'club' ? `tm:club:${teamExternal}` : `tm:nt:${teamExternal}`;
    const club = teamKind === 'club' ? clubById.get(teamExternal) : undefined;
    careers.push({
      id: `tm-career:${playerId}:${teamKind}:${teamExternal}`,
      playerId: resolve(externalPlayer), teamId: resolve(externalTeam),
      fromYear: Number(first.slice(0, 4)), toYear: Number(last.slice(0, 4)),
      appeared: true, verified: false, sourceId, evidenceId: appearanceSourceId,
      provenance: {
        evidence: 'appearance-rows', basis: 'appearance-rows', teamKind,
        teamLevel: club ? club.level : 'senior',
        appearances, goals: Number(row.goals), assists: Number(row.assists), minutes: Number(row.minutes),
        firstAppearance: first, lastAppearance: last,
        competitions: String(row.competitions ?? '').split(',').filter(Boolean).sort(),
        externalPlayerId: externalPlayer, externalTeamId: externalTeam,
        dataset: `transfermarkt-datasets@${SNAPSHOT}`,
        ...(club?.recovered ? { recoveredClub: true, clubNameSource: 'games.home_club_name/away_club_name' } : {}),
        note: 'Actual match appearance rows. Human review is still required before the link becomes playable.',
      },
    });
  };
  for (const row of clubCareerRows) {
    const clubId = String(row.team_id);
    if (!clubById.has(clubId)) { skipped.unknownTeam++; continue; }
    addCareer(row, clubId, 'club');
  }
  for (const row of ntCareerRows) addCareer(row, String(row.team_id), 'nt');

  const transfers: Transfer[] = [];
  const transferKeys = new Map<string, number>();
  for (const row of transferRows) {
    const playerId = String(row.player_id);
    if (!playerIds.has(playerId)) continue;
    const current = `tm:player:${playerId}`;
    const fromId = row.from_club_id === null ? undefined : `tm:club:${row.from_club_id}`;
    const toId = row.to_club_id === null ? undefined : `tm:club:${row.to_club_id}`;
    const date = text(row.transfer_date);
    const season = text(row.season) ?? '';
    const base = `tm-transfer:${playerId}:${date ?? 'unknown'}:${String(row.from_club_id ?? 0)}:${String(row.to_club_id ?? 0)}:${season.replace(/[^A-Za-z0-9_-]/g, '-')}`;
    const occurrence = (transferKeys.get(base) ?? 0) + 1;
    transferKeys.set(base, occurrence);
    const externalPlayerId = current;
    transfers.push({
      id: `${base}:${occurrence}`,
      playerId: resolve(current),
      fromTeamId: fromId && clubById.has(String(row.from_club_id)) ? resolve(fromId) : undefined,
      toTeamId: toId && clubById.has(String(row.to_club_id)) ? resolve(toId) : undefined,
      fromTeamName: text(row.from_club_name) ?? '', toTeamName: text(row.to_club_name) ?? '',
      date, season,
      feeEur: num(row.transfer_fee), marketValueEur: num(row.market_value_in_eur),
      sourceId: transferSourceId,
      provenance: { basis: 'transfer-record', externalPlayerId, externalFromClubId: text(row.from_club_id), externalToClubId: text(row.to_club_id), dataset: `transfermarkt-datasets@${SNAPSHOT}` },
    });
  }

  const dataset: Dataset = {
    version: `transfermarkt-${SNAPSHOT}-v2`,
    origin: 'transfermarkt-candidates',
    sources, entities, careers, transfers, identityLinks: links,
  };
  validateDataset(dataset);

  const levelOf = (career: Career) => String(career.provenance?.teamLevel ?? 'unknown');
  const appearancesOf = (list: Career[]) => list.reduce((sum, c) => sum + Number(c.provenance?.appearances ?? 0), 0);
  const recoveredCareers = careers.filter(c => c.provenance?.recoveredClub === true);
  const linkKind = (prefix: string) => links.filter(l => l.externalId.startsWith(prefix)).length;
  const pendingByReason = pending.reduce<Record<string, number>>((map, item) => { map[item.reason] = (map[item.reason] ?? 0) + 1; return map; }, {});

  let catalog: { clubs?: { id: string; name: string }[] } | undefined;
  try { catalog = JSON.parse(await readFile(opts.catalog, 'utf8')) as { clubs?: { id: string; name: string }[] }; }
  catch { catalog = undefined; }
  const catalogIds = (catalog?.clubs ?? []).map(club => String(club.id));
  const matchedClubIds = new Set(links.filter(l => l.status === 'confirmed' && l.externalId.startsWith('tm:club:')).map(l => l.entityId));
  const reviewedClubIds = new Set(existing.filter(e => e.kind === 'club').map(e => e.id));
  const coverage = catalogCoverage(catalogIds, careers, matchedClubIds);
  const withReviewed = catalogIds.filter(id => reviewedClubIds.has(id));
  const withoutReviewed = catalogIds.filter(id => !reviewedClubIds.has(id));
  const matchedCatalog = catalogIds.filter(id => matchedClubIds.has(id));
  const reviewedButUnmatched = withReviewed.filter(id => !matchedClubIds.has(id));
  const names = new Map((catalog?.clubs ?? []).map(club => [String(club.id), club.name]));
  const manualApplied = links.filter(link => link.method === 'manual');
  const sourceStatus = new Map(sources.map(source => [source.id, 'unresolved' as const]));
  const careerSummary = summarizeCareers(careers, { sourceStatus });
  // Candidate game scope mirrors the runtime rule: top-100 senior clubs plus
  // country-backed A national teams. Unmatched tm: clubs are not selectable yet.
  const catalogSet = new Set(catalogIds);
  const entityById = new Map([...entities, ...existing].map(e => [e.id, e]));
  const candidateCareers = careers.flatMap(c => {
    const team = entityById.get(c.teamId);
    if (!team) return [];
    if (team.kind === 'club' && team.level === 'senior' && catalogSet.has(team.id)) return [{ ...c, teamId: team.id }];
    if (team.kind === 'national_team' && team.level === 'senior' && team.countryId && entityById.get(team.countryId)?.kind === 'country') return [{ ...c, teamId: team.countryId }];
    return [];
  });
  const candidatePool = selectionCoverage([...new Set(candidateCareers.map(c => c.teamId))], candidateCareers);

  const report = {
    version: dataset.version,
    generatedAt: new Date().toISOString(),
    evidence: {
      careers: careers.length,
      appearanceSupported: careers.filter(c => c.appeared && c.provenance?.evidence === 'appearance-rows').length,
      transferOnlyCareers: careers.filter(c => c.provenance?.basis === 'transfer-record').length,
      transferRecords: transfers.length,
      appearances: appearancesOf(careers),
      clubCareers: careers.filter(c => c.provenance?.teamKind === 'club').length,
      nationalTeamCareers: careers.filter(c => c.provenance?.teamKind === 'nt').length,
      byLevel: {
        senior: careers.filter(c => levelOf(c) === 'senior').length,
        youth: careers.filter(c => levelOf(c) === 'youth').length,
        unknown: careers.filter(c => levelOf(c) === 'unknown').length,
      },
      skipped,
    },
    careers: careerSummary,
    missingClubs: {
      unknownClubIds: Number(unknownTotals[0]?.clubs ?? 0),
      unknownAppearanceRows: Number(unknownTotals[0]?.appearances ?? 0),
      unknownCareerGroups: Number(unknownTotals[0]?.career_groups ?? 0),
      inScopeClubs: Number(inScopeUnknown[0]?.clubs ?? 0),
      inScopeAppearanceRows: Number(inScopeUnknown[0]?.appearances ?? 0),
      inScopeCareerGroups: Number(inScopeUnknown[0]?.career_groups ?? 0),
      recoveredClubs: recoveredIds.size,
      recoveredClubIds: [...recoveredIds].sort(),
      recoveredCareerGroups: recoveredCareers.length,
      recoveredAppearanceRows: appearancesOf(recoveredCareers),
      unresolvedInScope: Number(inScopeUnknown[0]?.clubs ?? 0) - recoveredIds.size,
      outOfScopeClubs: Number(unknownTotals[0]?.clubs ?? 0) - Number(inScopeUnknown[0]?.clubs ?? 0),
      outOfScopeAppearanceRows: Number(unknownTotals[0]?.appearances ?? 0) - Number(inScopeUnknown[0]?.appearances ?? 0),
    },
    duplicates: {
      playerNameBirthDateGroups: new Set(duplicatePlayers.map(row => `${String(row.name).toLowerCase().trim()}|${String(row.birth_date)}`)).size,
      playerRows: duplicatePlayers.length,
      clubNameGroups: new Set(duplicateClubs.map(row => String(row.name).toLowerCase().trim())).size,
      clubRows: duplicateClubs.length,
      playerExamples: duplicatePlayers.slice(0, 20),
      clubExamples: duplicateClubs.slice(0, 20),
      review: {
        action: 'kept-separate',
        reason: 'Identical names and birth dates across two external IDs do not prove which record is canonical; no in-scope career is affected.',
      },
    },
    identity: {
      confirmed: {
        players: linkKind('tm:player:'), clubs: linkKind('tm:club:'), countries: linkKind('tm:country:'),
        nationalTeams: linkKind('tm:nt:'), total: links.length,
      },
      audit: { checked: links.length, failures: audit.length },
      manual: {
        configured: manual.length,
        applied: manualApplied.length,
        externalIds: manualApplied.map(link => link.externalId).sort(),
      },
      pending: {
        total: pending.length, byReason: pendingByReason, sample: pending.slice(0, 200),
        note: 'Same-name players with a different birth date are distinct people; they stay pending and are never merged.',
      },
    },
    top100: {
      catalog: opts.catalog,
      catalogClubs: catalogIds.length,
      catalogClubsWithReviewedIdentity: withReviewed.length,
      matchedClubs: coverage.matchedClubs,
      matchedClubNames: matchedCatalog.map(id => names.get(id) ?? id),
      unmatchedWithReviewedIdentity: reviewedButUnmatched.map(id => names.get(id) ?? id),
      catalogClubsWithoutReviewedIdentity: withoutReviewed.length,
      players: coverage.players,
      careers: coverage.careers,
      multiClubPlayers: coverage.multiClubPlayers,
      catalogPairs: coverage.catalogPairs,
      matchedPairs: coverage.matchedPairs,
      sharedPairs: coverage.sharedPairs,
      catalogPairsWithoutSharedPlayer: coverage.catalogPairsWithoutSharedPlayer,
      matchedPairsWithoutSharedPlayer: coverage.matchedPairsWithoutSharedPlayer,
      clubs: coverage.clubs.filter(club => club.careers > 0).sort((a, b) => b.careers - a.careers || a.id.localeCompare(b.id)),
    },
    // Candidate-only pool: matched clubs plus reviewed country selections. Never live.
    candidatePool,
  };

  const temporary = `${opts.out}.tmp`;
  await writeFile(temporary, `${JSON.stringify(dataset)}\n`);
  await rename(temporary, opts.out);
  const reportTemporary = `${opts.report}.tmp`;
  await writeFile(reportTemporary, `${JSON.stringify(report, null, 2)}\n`);
  await rename(reportTemporary, opts.report);

  const counts = {
    entities: entities.length, players: entities.filter(e => e.kind === 'player').length,
    clubs: entities.filter(e => e.kind === 'club').length, nationalTeams: entities.filter(e => e.kind === 'national_team').length,
    countries: entities.filter(e => e.kind === 'country').length,
    careers: careers.length, appearances: appearancesOf(careers),
    transfers: transfers.length, identityLinks: links.length, identityManual: manualApplied.length, identityPending: pending.length,
    recoveredClubs: recoveredIds.size, recoveredCareers: recoveredCareers.length, recoveredAppearances: appearancesOf(recoveredCareers),
    top100MatchedClubs: coverage.matchedClubs, top100Players: coverage.players, top100Careers: coverage.careers, skipped,
  };
  console.log(JSON.stringify({ out: opts.out, report: opts.report, version: dataset.version, ...counts }, null, 2));
  console.log('Lisans: dcaribou/transfermarkt-datasets CC0-1.0 (LICENSE). Kaynak site Transfermarkt kullanım koşulları ayrıca değerlendirilmelidir; adaylar oyuna alınmadı.');
}

await main();
