/**
 * Read-only game-scope coverage for the reviewed live pool and the Transfermarkt
 * candidate pool. It never imports, writes or changes usage permission.
 *
 * Live pool: verified && appeared careers at top-100 senior clubs or A national teams.
 * Candidate pool: appearance-supported but unverified careers at the same selections.
 */
import { readFile } from 'node:fs/promises';
import { selectionCoverage, summarizeCareers } from '../src/server/football/quality.ts';
import type { Career, Dataset, Entity, Source } from '../src/server/football/types.ts';

type Catalog = { clubs: { id: string; name: string }[] };
type PoolEntity = Entity & { kind: Entity['kind'] };

const read = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T;
const arg = (name: string, fallback: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

function sourceStatus(sources: Source[], candidate: boolean): Map<string, 'cleared' | 'unresolved'> {
  return new Map(sources.map(source => [source.id, candidate
    ? 'unresolved'
    : source.license === 'CC0-1.0' && !source.id.startsWith('tm-') ? 'cleared' : 'unresolved']));
}

function resolvePool(
  careers: Career[],
  entities: Map<string, PoolEntity>,
  catalog: Set<string>,
): { selectionIds: string[]; careers: Career[]; clubs: string[]; countries: string[] } {
  const mapped: Career[] = [];
  const selections = new Set<string>();
  for (const career of careers) {
    const team = entities.get(career.teamId);
    if (!team) continue;
    if (team.kind === 'club' && catalog.has(team.id) && team.level === 'senior') {
      mapped.push({ ...career, teamId: team.id });
      selections.add(team.id);
    } else if (team.kind === 'national_team' && team.level === 'senior' && team.countryId && entities.get(team.countryId)?.kind === 'country') {
      mapped.push({ ...career, teamId: team.countryId });
      selections.add(team.countryId);
    }
  }
  const selectionIds = [...selections];
  return {
    selectionIds,
    careers: mapped,
    clubs: selectionIds.filter(id => entities.get(id)?.kind === 'club'),
    countries: selectionIds.filter(id => entities.get(id)?.kind === 'country'),
  };
}

function withNames(coverage: ReturnType<typeof selectionCoverage>, entities: Map<string, PoolEntity>) {
  const rows = coverage.mostConnected.map(row => ({
    id: row.id, name: entities.get(row.id)?.name ?? row.id, players: row.players, careers: row.careers,
  }));
  return {
    ...coverage,
    mostConnected: rows,
    mostConnectedClubs: rows.filter(row => entities.get(row.id)?.kind === 'club'),
  };
}

/** Original career.teamId values that resolve to a selectable senior club or country. */
function playableTeams(
  careers: Career[],
  entities: Map<string, PoolEntity>,
  catalog: Set<string>,
): Set<string> {
  const allowed = new Set<string>();
  for (const career of careers) {
    const team = entities.get(career.teamId);
    if (!team) continue;
    if (team.kind === 'club' && catalog.has(team.id) && team.level === 'senior') allowed.add(team.id);
    else if (team.kind === 'national_team' && team.level === 'senior' && team.countryId && entities.get(team.countryId)?.kind === 'country') allowed.add(team.id);
  }
  return allowed;
}

async function main() {
  const catalogPath = arg('catalog', 'data/club-catalog.top100.json');
  const priorityPath = arg('priority', 'data/club-catalog.priority.json');
  const reviewedPath = arg('reviewed', 'data/football.reviewed.json');
  const appearancePath = arg('appearances', 'data/football-wikidata-appearances.json');
  const candidatePath = arg('candidate', 'data/football-transfermarkt.json');
  const [catalog, priority, reviewed, appearance, candidate] = await Promise.all([
    read<Catalog>(catalogPath),
    read<{ clubs: { id: string }[] }>(priorityPath).catch(() => ({ clubs: [] })),
    read<Dataset>(reviewedPath),
    read<Dataset>(appearancePath).catch(() => undefined),
    read<Dataset>(candidatePath).catch(() => undefined),
  ]);
  const catalogIds = new Set([...catalog.clubs.map(club => club.id), ...priority.clubs.map(club => club.id)]);
  const reviewedEntities = new Map(reviewed.entities.map(entity => [entity.id, entity as PoolEntity]));
  const combinedEntities = new Map([...(appearance?.entities ?? []), ...reviewed.entities].map(entity => [entity.id, entity as PoolEntity]));
  const candidateEntities = new Map([...(candidate?.entities ?? []), ...(appearance?.entities ?? []), ...reviewed.entities].map(entity => [entity.id, entity as PoolEntity]));
  const liveSources = [...reviewed.sources, ...(appearance?.sources ?? [])];
  const liveCareers = [...reviewed.careers, ...(appearance?.careers ?? [])];
  const uniqueCareers = [...new Map(liveCareers.map(career => [`${career.playerId}:${career.teamId}`, career])).values()];
  const verifiedCareers = uniqueCareers.filter(career => career.verified && career.appeared);

  const reviewedResolved = resolvePool(reviewed.careers.filter(c => c.verified && c.appeared), reviewedEntities, catalogIds);
  const reviewedCoverage = withNames(selectionCoverage(reviewedResolved.selectionIds, reviewedResolved.careers), reviewedEntities);

  const liveResolved = resolvePool(verifiedCareers, combinedEntities, catalogIds);
  const liveCoverage = withNames(selectionCoverage(liveResolved.selectionIds, liveResolved.careers), combinedEntities);
  const liveTeams = playableTeams(verifiedCareers, combinedEntities, catalogIds);
  const liveSummary = summarizeCareers(uniqueCareers, {
    sourceStatus: sourceStatus(liveSources, false),
    teamPlayable: teamId => liveTeams.has(teamId),
  });

  const candidateResolved = candidate
    ? resolvePool(candidate.careers.filter(c => c.appeared && !c.verified), candidateEntities, catalogIds)
    : { selectionIds: [], careers: [], clubs: [], countries: [] };
  const candidateCoverage = withNames(selectionCoverage(candidateResolved.selectionIds, candidateResolved.careers), candidateEntities);
  const candidateTeams = candidate
    ? playableTeams(candidate.careers.filter(c => c.appeared && !c.verified), candidateEntities, catalogIds)
    : new Set<string>();
  const candidateSummary = candidate
    ? summarizeCareers(candidate.careers, {
      sourceStatus: sourceStatus(candidate.sources, true),
      teamPlayable: teamId => candidateTeams.has(teamId),
    })
    : undefined;

  console.log(JSON.stringify({
    reviewedVersion: reviewed.version,
    appearanceVersion: appearance?.version ?? null,
    candidateVersion: candidate?.version ?? null,
    catalogClubs: catalogIds.size,
    top100Clubs: catalog.clubs.length,
    priorityClubs: priority.clubs.length,
    reviewedOnly: {
      selections: { clubs: reviewedResolved.clubs.length, countries: reviewedResolved.countries.length, total: reviewedCoverage.selections },
      players: reviewedCoverage.players,
      careers: reviewedCoverage.careers,
      multiSelectionPlayers: reviewedCoverage.multiSelectionPlayers,
      pairs: reviewedCoverage.pairs,
      sharedPairs: reviewedCoverage.sharedPairs,
      nonSharedPairs: reviewedCoverage.nonSharedPairs,
    },
    appearance: appearance ? {
      version: appearance.version,
      players: new Set(appearance.careers.map(career => career.playerId)).size,
      careers: appearance.careers.length,
      sources: appearance.sources.length,
    } : null,
    live: {
      selections: { clubs: liveResolved.clubs.length, countries: liveResolved.countries.length, total: liveCoverage.selections },
      players: liveCoverage.players,
      answerCapablePlayers: liveCoverage.multiSelectionPlayers,
      careers: liveCoverage.careers,
      multiSelectionPlayers: liveCoverage.multiSelectionPlayers,
      pairs: liveCoverage.pairs,
      sharedPairs: liveCoverage.sharedPairs,
      nonSharedPairs: liveCoverage.nonSharedPairs,
      averageCareerLinksPerPlayer: liveCoverage.players ? Number((liveCoverage.careers / liveCoverage.players).toFixed(2)) : 0,
      mostConnected: liveCoverage.mostConnected,
      mostConnectedClubs: liveCoverage.mostConnectedClubs,
      careerSummary: liveSummary,
    },
    candidate: candidate ? {
      selections: { clubs: candidateResolved.clubs.length, countries: candidateResolved.countries.length, total: candidateCoverage.selections },
      players: candidateCoverage.players,
      careers: candidateCoverage.careers,
      multiSelectionPlayers: candidateCoverage.multiSelectionPlayers,
      pairs: candidateCoverage.pairs,
      sharedPairs: candidateCoverage.sharedPairs,
      nonSharedPairs: candidateCoverage.nonSharedPairs,
      mostConnected: candidateCoverage.mostConnected,
      mostConnectedClubs: candidateCoverage.mostConnectedClubs,
      careerSummary: candidateSummary,
    } : null,
    note: 'Availability is based on verified && appeared for the live pool and appearance-supported unverified rows for candidates. Usage permission is reported separately; the database clearance view is the final gate.',
  }, null, 2));
}

await main();
