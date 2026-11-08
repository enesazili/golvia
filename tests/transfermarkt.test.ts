import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { canonicalDataset, datasetChecksum, validateDataset } from '../src/server/football/importer.ts';
import { auditIdentityLinks, findPendingMatches, matchIdentities } from '../src/server/football/identity.ts';
import { catalogCoverage, classifyCareerEvidence, classifyTeamLevel, selectionCoverage, summarizeCareers } from '../src/server/football/quality.ts';
import type { Dataset, Source } from '../src/server/football/types.ts';

const sources = [
  { id: 'tm-dataset-x', url: 'https://github.com/dcaribou/transfermarkt-datasets', license: 'CC0-1.0' as const, retrieved: '2026-11-08' },
  { id: 'tm-appearances-x', url: 'https://huggingface.co/datasets/ngeorgea/transfermarkt-player-scores', license: 'CC0-1.0' as const, retrieved: '2026-11-08' },
  { id: 'tm-transfers-x', url: 'https://huggingface.co/datasets/ngeorgea/transfermarkt-player-scores', license: 'CC0-1.0' as const, retrieved: '2026-11-08' },
];
const entities = [
  { id: 'tm:country:1', kind: 'country' as const, name: 'Türkiye', aliases: [], sourceId: 'tm-dataset-x' },
  { id: 'tm:club:2', kind: 'club' as const, name: 'Test Kulüp', aliases: [], countryId: 'tm:country:1', level: 'senior' as const, sourceId: 'tm-dataset-x' },
  { id: 'tm:player:3', kind: 'player' as const, name: 'Test Oyuncu', aliases: [], birthDate: '1990-01-02', sourceId: 'tm-dataset-x' },
];
const career = {
  id: 'tm-career:3:club:2', playerId: 'tm:player:3', teamId: 'tm:club:2', fromYear: 2015, toYear: 2018,
  appeared: true, verified: false, sourceId: 'tm-dataset-x', evidenceId: 'tm-appearances-x',
  provenance: { evidence: 'appearance-rows', appearances: 42, externalPlayerId: 'tm:player:3', externalTeamId: 'tm:club:2' },
};
const transfer = {
  id: 'tm-transfer:3:2019-07-01:2:0:19-20:1', playerId: 'tm:player:3', fromTeamId: 'tm:club:2', fromTeamName: 'Test Kulüp', toTeamName: 'Bilinmeyen Kulüp',
  date: '2019-07-01', season: '19/20', feeEur: 100, sourceId: 'tm-transfers-x',
  provenance: { basis: 'transfer-record', externalPlayerId: 'tm:player:3' },
};
const base = (): Dataset => structuredClone({ version: 'transfermarkt-x-v1', origin: 'transfermarkt-candidates', sources, entities, careers: [career], transfers: [transfer], identityLinks: [] });

test('transfermarkt candidate dataset validates and keeps transfers separate from appearances', () => {
  const data = base();
  validateDataset(data);
  assert.equal(data.careers.length, 1);
  assert.equal(data.transfers!.length, 1);
  assert.equal(data.careers[0].appeared, true);
  assert.equal(data.careers[0].verified, false);
});

test('a transfer alone cannot create an appearance claim', () => {
  const data = base();
  data.careers = [];
  validateDataset(data);
  assert.equal(data.careers.length, 0);
  const missingBasis = base();
  delete (missingBasis.transfers![0].provenance as Record<string, unknown>).basis;
  assert.throws(() => validateDataset(missingBasis), /not appearance evidence/);
});

test('candidate appearances need real appearance rows and cannot be verified', () => {
  const noRows = base();
  noRows.careers[0].provenance = { evidence: 'transfer-record', appearances: 0 };
  assert.throws(() => validateDataset(noRows), /needs appearance rows/);
  const verified = base();
  verified.careers[0].verified = true;
  assert.throws(() => validateDataset(verified), /Playable career needs separate reviewed match evidence/);
});

test('candidate data stays inside the tm namespace and preserves reviewed IDs', () => {
  const entity = base();
  entity.entities[1].id = 'Q123';
  entity.careers[0].teamId = 'Q123';
  entity.careers[0].provenance = { ...entity.careers[0].provenance, externalTeamId: 'Q123' };
  entity.transfers![0].fromTeamId = 'Q123';
  assert.throws(() => validateDataset(entity), /tm: namespace/);
  const careerId = base();
  careerId.careers[0].id = 'wd-statement-1';
  assert.throws(() => validateDataset(careerId), /tm-career:/);
  const transferId = base();
  transferId.transfers![0].id = 'transfer-1';
  assert.throws(() => validateDataset(transferId), /tm-transfer:/);
});

test('duplicate identities and transfers are rejected', () => {
  const duplicateEntity = base();
  duplicateEntity.entities.push({ ...duplicateEntity.entities[2], name: 'Kopya' });
  assert.throws(() => validateDataset(duplicateEntity), /duplicate ID/);
  const duplicateTransfer = base();
  duplicateTransfer.transfers!.push({ ...duplicateTransfer.transfers![0] });
  assert.throws(() => validateDataset(duplicateTransfer), /duplicate transfer/);
});

test('matched players resolve through confirmed identity links', () => {
  const data = base();
  data.entities = data.entities.filter(e => e.id !== 'tm:player:3');
  data.identityLinks = [{ source: 'transfermarkt', externalId: 'tm:player:3', entityId: 'Q999', method: 'name+birthdate', status: 'confirmed', evidence: { rule: 'test' } }];
  data.careers[0].playerId = 'Q999';
  data.transfers![0].playerId = 'Q999';
  validateDataset(data);
  const pending = structuredClone(data);
  pending.identityLinks![0].status = 'pending';
  assert.throws(() => validateDataset(pending), /Invalid career or provenance/);
  pending.careers = [];
  assert.throws(() => validateDataset(pending), /confirmed identity link/);
});

test('identity matching needs a birth date and never guesses duplicate names', () => {
  const existing = [
    { id: 'Q1', kind: 'player' as const, name: 'Cristiano Ronaldo', birthDate: '1985-02-05' },
    { id: 'Q2', kind: 'club' as const, name: 'Liverpool FC' },
    { id: 'Q3', kind: 'club' as const, name: 'Liverpool FC' },
    { id: 'Q155', kind: 'country' as const, name: 'Brezilya' },
    { id: 'Q29', kind: 'country' as const, name: 'İspanya' },
  ];
  const result = matchIdentities(existing, {
    players: [
      { id: '10', name: 'Cristiano  Ronaldo', birthDate: '1985-02-05' },
      { id: '11', name: 'Cristiano Ronaldo' },
      { id: '12', name: 'Cristiano Ronaldo', birthDate: '1984-02-05' },
    ],
    clubs: [{ id: '20', name: 'Liverpool FC' }],
    countries: [{ id: '26', name: 'Brazil' }, { id: '157', name: 'Spain' }],
  });
  assert.deepEqual(result.links.map(l => [l.externalId, l.entityId]), [
    ['tm:player:10', 'Q1'], ['tm:country:26', 'Q155'], ['tm:country:157', 'Q29'],
  ]);
  assert.ok(!result.matched.has('tm:club:20'), 'ambiguous club names must not merge');
  assert.ok(result.links.every(l => l.status === 'confirmed'));
});

test('club matching refuses a different known country', () => {
  const result = matchIdentities(
    [{ id: 'Q5', kind: 'club', name: 'Sporting CP', countryId: 'Q45' }],
    { players: [], clubs: [{ id: '30', name: 'Sporting CP', countryId: 'Q155' }], countries: [] },
  );
  assert.equal(result.links.length, 0);
});

test('checksums stay stable for existing datasets and change with transfers', () => {
  const reviewed = { version: 'reviewed-x-v1', sources: [sources[0]], entities: [entities[0]], careers: [] };
  const before = datasetChecksum(reviewed);
  assert.equal(before, datasetChecksum({ ...reviewed, entities: [...reviewed.entities] }));
  const withTransfer = base();
  const first = datasetChecksum(withTransfer);
  withTransfer.transfers![0].feeEur = 101;
  assert.notEqual(first, datasetChecksum(withTransfer));
  const reordered = base();
  reordered.transfers = [structuredClone(reordered.transfers![0])];
  assert.equal(datasetChecksum(reordered), datasetChecksum(base()));
  assert.deepEqual(canonicalDataset(base()).transfers!.map(t => t.id), [transfer.id]);
});

test('club aliases match only exact curated labels and never ambiguous ones', () => {
  const existing = [
    { id: 'Q1', kind: 'club' as const, name: 'A.C. Milan', aliases: ['AC Milan', 'Milan'] },
    { id: 'Q2', kind: 'club' as const, name: 'FC Internazionale Milano', aliases: ['Inter', 'Inter Milan'] },
  ];
  const result = matchIdentities(existing, {
    players: [],
    clubs: [{ id: '5', name: 'AC Milan' }, { id: '46', name: 'Inter Milan' }],
    countries: [],
  });
  assert.deepEqual(result.links.map(l => [l.externalId, l.entityId]), [['tm:club:5', 'Q1'], ['tm:club:46', 'Q2']]);
  assert.equal(result.links[0].evidence?.matchedAlias, true);
  assert.equal(result.links[0].evidence?.rule, 'curated-alias');

  const ambiguous = matchIdentities([
    { id: 'A', kind: 'club', name: 'Alpha FC', aliases: ['United'] },
    { id: 'B', kind: 'club', name: 'Beta FC', aliases: ['United'] },
  ], { players: [], clubs: [{ id: '9', name: 'United' }], countries: [] });
  assert.equal(ambiguous.links.length, 0, 'an alias shared by two clubs must not merge');
});

test('player aliases match only with an identical birth date', () => {
  const existing = [
    { id: 'Q1', kind: 'player' as const, name: 'Lee Kang-in', birthDate: '2001-02-19', aliases: ['Kang-in Lee'] },
    { id: 'Q2', kind: 'player' as const, name: 'Mariano', birthDate: '1993-08-01', aliases: ['Mariano Díaz'] },
  ];
  const result = matchIdentities(existing, {
    players: [
      { id: '1', name: 'Kang-in Lee', birthDate: '2001-02-19' },
      { id: '2', name: 'Mariano Díaz', birthDate: '1993-08-02' },
    ],
    clubs: [], countries: [],
  });
  assert.deepEqual(result.links.map(l => [l.externalId, l.entityId]), [['tm:player:1', 'Q1']]);
  assert.equal(result.links[0].evidence?.matchedAlias, true);
  assert.equal(result.links[0].evidence?.rule, 'curated-alias+birth-date');
});

test('alias matching still refuses a different known country', () => {
  const result = matchIdentities(
    [{ id: 'Q5', kind: 'club', name: 'Sporting CP', countryId: 'Q45', aliases: ['Sporting'] }],
    { players: [], clubs: [{ id: '30', name: 'Sporting', countryId: 'Q155' }], countries: [] },
  );
  assert.equal(result.links.length, 0);
});

test('pending queue keeps near matches out of the confirmed set', () => {
  const existing = [
    { id: 'Q1', kind: 'player' as const, name: 'Rafinha', birthDate: '1993-02-12' },
    { id: 'Q2', kind: 'club' as const, name: 'Sporting CP', countryId: 'Q45' },
  ];
  const external = {
    players: [{ id: '10', name: 'Rafinha', birthDate: '1985-09-07' }, { id: '11', name: 'Rafinha' }],
    clubs: [{ id: '20', name: 'Sporting CP', countryId: 'Q155' }],
    countries: [],
  };
  const match = matchIdentities(existing, external);
  assert.equal(match.links.length, 0);
  const pending = findPendingMatches(existing, external, match.links);
  assert.deepEqual(Object.fromEntries(pending.map(item => [item.externalId, item.reason])), {
    'tm:club:20': 'country-conflict',
    'tm:player:10': 'birthdate-mismatch',
    'tm:player:11': 'missing-birthdate',
  });
});

test('confirmed identity audit catches a tampered link', () => {
  const existing = [
    { id: 'Q1', kind: 'player' as const, name: 'Test Player', birthDate: '1990-01-02' },
    { id: 'Q2', kind: 'club' as const, name: 'Alpha FC' },
  ];
  const external = { players: [{ id: '3', name: 'Test Player', birthDate: '1990-01-02' }], clubs: [{ id: '4', name: 'Alpha FC' }], countries: [] };
  const links = matchIdentities(existing, external).links;
  assert.equal(auditIdentityLinks(existing, external, links).length, 0);
  const tampered = structuredClone(links);
  tampered[0].entityId = 'Q2';
  assert.ok(auditIdentityLinks(existing, external, tampered).length > 0);
});

test('team levels split senior, youth and unknown reserve names', () => {
  assert.equal(classifyTeamLevel('FC Barcelona'), 'senior');
  assert.equal(classifyTeamLevel('Willem II Tilburg'), 'senior');
  assert.equal(classifyTeamLevel('FC Barcelona U19'), 'youth');
  assert.equal(classifyTeamLevel('Jong Ajax'), 'youth');
  assert.equal(classifyTeamLevel('Real Madrid Castilla'), 'youth');
  assert.equal(classifyTeamLevel('Borussia Dortmund II'), 'unknown');
  assert.equal(classifyTeamLevel('Barcelona B'), 'unknown');
});

test('catalog coverage counts shared and non-shared club pairs', () => {
  const coverage = catalogCoverage(['A', 'B', 'C', 'D'], [
    { playerId: 'p1', teamId: 'A' }, { playerId: 'p1', teamId: 'B' },
    { playerId: 'p2', teamId: 'A' }, { playerId: 'p3', teamId: 'C' },
  ], new Set(['A', 'B', 'C']));
  const { clubs, ...totals } = coverage;
  assert.deepEqual(totals, {
    catalogClubs: 4, matchedClubs: 3, players: 3, careers: 4, multiClubPlayers: 1,
    catalogPairs: 6, matchedPairs: 3, sharedPairs: 1, catalogPairsWithoutSharedPlayer: 5, matchedPairsWithoutSharedPlayer: 2,
  });
  assert.deepEqual(clubs, [
    { id: 'A', players: 2, careers: 2 }, { id: 'B', players: 1, careers: 1 },
    { id: 'C', players: 1, careers: 1 }, { id: 'D', players: 0, careers: 0 },
  ]);
});

test('a candidate career whose club record is missing is rejected', () => {
  const data = base();
  data.entities = data.entities.filter(e => e.id !== 'tm:club:2');
  assert.throws(() => validateDataset(data), /Invalid career or provenance/);
});

test('a recovered senior club without a country validates', () => {
  const data = base();
  data.entities.push({ id: 'tm:club:77', kind: 'club', name: 'Recovered FC', aliases: [], level: 'senior', sourceId: 'tm-dataset-x' });
  data.careers.push({
    id: 'tm-career:3:club:77', playerId: 'tm:player:3', teamId: 'tm:club:77', appeared: true, verified: false,
    sourceId: 'tm-dataset-x', evidenceId: 'tm-appearances-x',
    provenance: { evidence: 'appearance-rows', teamKind: 'club', teamLevel: 'senior', appearances: 2, recoveredClub: true, externalPlayerId: 'tm:player:3', externalTeamId: 'tm:club:77' },
  });
  validateDataset(data);
  assert.equal(data.entities.find(e => e.id === 'tm:club:77')?.level, 'senior');
});

test('tracked reviewed dataset still validates after the candidate extension', async () => {
  const reviewed: unknown = JSON.parse(await readFile(new URL('../data/football.reviewed.json', import.meta.url), 'utf8'));
  validateDataset(reviewed);
  assert.equal(reviewed.origin, undefined);
});

test('usage permission is validated and reference-only sources can never be cleared', () => {
  const clearCco = base();
  clearCco.sources[0].usagePermission = 'cleared';
  validateDataset(clearCco);
  const invalid = base();
  (invalid.sources[0] as unknown as Record<string, unknown>).usagePermission = 'maybe';
  assert.throws(() => validateDataset(invalid), /Invalid usage permission/);
  const referenceOnly = base();
  referenceOnly.sources[0] = { ...referenceOnly.sources[0], license: 'reference-only', usagePermission: 'cleared' };
  assert.throws(() => validateDataset(referenceOnly), /Reference-only source cannot be cleared/);
});

test('manual identity links are explicit and still audited for kind, date and country', () => {
  const existing = [
    { id: 'Q1', kind: 'player' as const, name: 'Rafinha', birthDate: '1985-09-07' },
    { id: 'Q2', kind: 'club' as const, name: 'Olympique Lyonnais', countryId: 'Q142' },
  ];
  const external = {
    players: [
      { id: '33947', name: 'Rafael de Souza', birthDate: '1985-09-07' },
      { id: '47931', name: 'Rafinha', birthDate: '1982-06-29' },
    ],
    clubs: [{ id: '1041', name: 'Olympique Lyon', countryId: 'Q142' }],
    countries: [],
  };
  const manual = [
    { externalId: 'tm:player:33947', entityId: 'Q1', evidence: { rule: 'manual-reviewed-identity' } },
    { externalId: 'tm:club:1041', entityId: 'Q2', evidence: { rule: 'manual-reviewed-identity' } },
  ];
  const match = matchIdentities(existing, external, manual);
  assert.deepEqual(match.links.map(link => [link.externalId, link.entityId, link.method]), [
    ['tm:player:33947', 'Q1', 'manual'], ['tm:club:1041', 'Q2', 'manual'],
  ]);
  assert.equal(auditIdentityLinks(existing, external, match.links).length, 0);

  const wrongDate = structuredClone(manual);
  wrongDate[0].entityId = 'Q9';
  const withOther = matchIdentities([...existing, { id: 'Q9', kind: 'player' as const, name: 'Other Rafinha', birthDate: '1982-06-29' }], external, wrongDate);
  assert.ok(auditIdentityLinks([...existing, { id: 'Q9', kind: 'player' as const, name: 'Other Rafinha', birthDate: '1982-06-29' }], external, withOther.links).length > 0);

  assert.throws(() => matchIdentities(existing, external, [{ externalId: 'tm:player:33947', entityId: 'Q2' }]), /not a player/);
  const missingExternal = matchIdentities(existing, external, [{ externalId: 'tm:player:999', entityId: 'Q1' }]);
  assert.equal(missingExternal.links.length, 0);
});

test('career evidence, review and usage permission are classified separately', () => {
  const cited = {
    id: 'c1', playerId: 'p1', teamId: 't1', appeared: true, verified: true,
    sourceId: 's1', evidenceId: 'e1', provenance: { evidence: 'appearance-rows', appearances: 4 },
  };
  const separate = { ...cited, id: 'c2', evidenceId: 'e2', provenance: undefined };
  const transferOnly = { ...cited, id: 'c3', appeared: false, verified: false, provenance: { basis: 'transfer-record' } };
  const ambiguous = { ...cited, id: 'c4', verified: false, sourceId: 's1', evidenceId: 's1', provenance: { evidence: 'membership' } };
  assert.equal(classifyCareerEvidence(cited), 'appearance-supported');
  assert.equal(classifyCareerEvidence(separate), 'appearance-supported');
  assert.equal(classifyCareerEvidence(transferOnly), 'transfer-only');
  assert.equal(classifyCareerEvidence(ambiguous), 'ambiguous');

  const summary = summarizeCareers([
    cited, separate, transferOnly, ambiguous,
    { ...cited, id: 'c5', playerId: 'p2', verified: false, sourceId: 's2' },
    { ...cited, id: 'c6', playerId: 'p3', verified: false, sourceId: 's2' },
  ], {
    sourceStatus: new Map([['s1', 'cleared'], ['s2', 'unresolved']]),
    reviewStatus: new Map([['c5', 'approved'], ['c6', 'rejected']]),
  });
  assert.equal(summary.total, 6);
  assert.deepEqual(summary.evidence, { 'appearance-supported': 4, 'transfer-only': 1, ambiguous: 1 });
  assert.deepEqual(summary.review, { approved: 1, rejected: 1, pending: 0, hold: 0, none: 4 });
  assert.deepEqual(summary.license, { cleared: 4, unresolved: 2, blocked: 0, unknown: 0 });
  assert.equal(summary.playable, 2, 'only verified, cleared careers are playable');
  assert.equal(summary.candidates, 3);
  assert.equal(summary.candidateLicenseUnresolved, 2);
});

test('selection coverage reports shared pairs, non-shared pairs and most-connected clubs', () => {
  const coverage = selectionCoverage(['club-a', 'club-b', 'club-c', 'country-x'], [
    { playerId: 'p1', teamId: 'club-a' }, { playerId: 'p1', teamId: 'club-b' },
    { playerId: 'p2', teamId: 'club-a' }, { playerId: 'p3', teamId: 'country-x' },
    { playerId: 'p4', teamId: 'unmatched' },
  ]);
  assert.equal(coverage.selections, 4);
  assert.equal(coverage.players, 3);
  assert.equal(coverage.careers, 4);
  assert.equal(coverage.multiSelectionPlayers, 1);
  assert.equal(coverage.pairs, 6);
  assert.equal(coverage.sharedPairs, 1);
  assert.equal(coverage.nonSharedPairs, 5);
  assert.deepEqual(coverage.mostConnected.map(row => [row.id, row.players]), [
    ['club-a', 2], ['club-b', 1], ['country-x', 1],
  ]);
});

test('a cleared source type still cannot be submitted as a reference-only evidence page', () => {
  const source: Source = { id: 'evidence-page', url: 'https://example.com/match', license: 'reference-only', retrieved: '2026-11-08', usagePermission: 'unresolved' };
  assert.equal(source.license, 'reference-only');
  assert.throws(() => validateDataset({ ...base(), sources: [...base().sources, { ...source, usagePermission: 'cleared' }] }), /Reference-only source cannot be cleared/);
});
