import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateDataset } from '../src/server/football/importer.ts';
import { classifyCareerEvidence } from '../src/server/football/quality.ts';
import {
  APPEARANCE_BASIS, appearanceCareerId, mergeAppearanceRows, validAppearanceProvenance,
  type AppearanceRow,
} from '../src/server/football/appearances.ts';
import { buildDataset, validateTargets, type AppearanceTargets } from '../scripts/wikidata-appearances.ts';
import type { Dataset } from '../src/server/football/types.ts';

const catalogue = { clubs: [{ id: 'Q100', name: 'Kulüp A', country: 'Turkey' }, { id: 'Q101', name: 'Kulüp B', country: 'Turkey' }] };
const priority = { clubs: [{ id: 'Q102', name: 'Öncelik Kulüp', countryId: 'Q2' }] };
const targets: AppearanceTargets = {
  version: 'wikidata-appearances-test-v1',
  retrieved: '2026-11-08',
  source: { id: 'wd-test-appearances', url: 'https://query.wikidata.org/', license: 'CC0-1.0' },
  rule: 'P54 membership with qualifier P1350 >= 1 at a curated senior team',
  countries: [{ id: 'Q1', name: 'Ülke A' }, { id: 'Q2', name: 'Ülke B' }],
  clubCountryIds: { Turkey: 'Q1' },
  nationalTeams: [{ id: 'Q10', name: 'A Millî Takımı', countryId: 'Q1' }],
};
const metadata = {
  Q1000: { name: 'Oyuncu Bir', aliases: ['Player One'], birthDate: '1990-01-02' },
  Q1001: { name: 'Oyuncu İki', aliases: [] as string[], birthDate: '1991-02-03' },
  Q1002: { name: 'Oyuncu Üç', aliases: [] as string[] },
  Q1003: { name: 'Oyuncu Dört', aliases: [] as string[], birthDate: '2020-06-18' },
};
function snapshot(rows: AppearanceRow[]) {
  return {
    version: 'wikidata-appearances-test-v1', retrieved: '2026-11-08',
    targetIds: ['Q100', 'Q101', 'Q102', 'Q10'],
    discoveryDone: true, membershipDone: true,
    players: ['Q1000', 'Q1001', 'Q1002', 'Q1003'], rows, metadata,
  };
}

test('appearance rows merge spells, ignore duplicates and keep the widest year envelope', () => {
  const merged = mergeAppearanceRows([
    { playerId: 'Q1', teamId: 'Q2', statementId: 's1', appearances: 10, fromYear: 2001, toYear: 2003 },
    { playerId: 'Q1', teamId: 'Q2', statementId: 's1', appearances: 10, fromYear: 2001, toYear: 2003 },
    { playerId: 'Q1', teamId: 'Q2', statementId: 's2', appearances: 4, fromYear: 2007, toYear: 2008 },
    { playerId: 'Q1', teamId: 'Q3', statementId: 's3', appearances: 0 },
    { playerId: 'Q1', teamId: 'Q4', statementId: '', appearances: 5 },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].appearances, 14);
  assert.deepEqual(merged[0].statementIds, ['s1', 's2']);
  assert.equal(merged[0].fromYear, 2001);
  assert.equal(merged[0].toYear, 2008);
  assert.equal(appearanceCareerId('Q1', 'Q2'), 'wd-p1350:Q1:Q2');
  const openEnded = mergeAppearanceRows([
    { playerId: 'Q5', teamId: 'Q6', statementId: 's1', appearances: 3, fromYear: 2020 },
    { playerId: 'Q5', teamId: 'Q6', statementId: 's2', appearances: 2, toYear: 2005 },
  ]);
  assert.equal(openEnded[0].fromYear, undefined);
  assert.equal(openEnded[0].toYear, undefined);
  assert.equal(openEnded[0].appearances, 5);
});

test('appearance provenance requires a CC0 match count and statement ids', () => {
  assert.equal(validAppearanceProvenance({ basis: APPEARANCE_BASIS, appearances: 3, statementIds: ['s'] }), true);
  assert.equal(validAppearanceProvenance({ basis: APPEARANCE_BASIS, appearances: 0, statementIds: ['s'] }), false);
  assert.equal(validAppearanceProvenance({ basis: APPEARANCE_BASIS, appearances: 3, statementIds: [] }), false);
  assert.equal(validAppearanceProvenance({ basis: 'membership-only', appearances: 3, statementIds: ['s'] }), false);
  assert.equal(validAppearanceProvenance(undefined), false);
  assert.equal(classifyCareerEvidence({
    appeared: true, verified: true, sourceId: 'wd', evidenceId: 'wd',
    provenance: { basis: APPEARANCE_BASIS, appearances: 3, statementIds: ['s'] },
  }), 'appearance-supported');
});

test('a generated appearance dataset is valid and keeps only answer-capable players', () => {
  const dataset = buildDataset({
    targets, catalog: catalogue, priority,
    snapshot: snapshot([
      { playerId: 'Q1000', teamId: 'Q100', statementId: 's1', appearances: 10, fromYear: 2001, toYear: 2003 },
      { playerId: 'Q1000', teamId: 'Q100', statementId: 's2', appearances: 5, fromYear: 2007, toYear: 2007 },
      { playerId: 'Q1000', teamId: 'Q101', statementId: 's3', appearances: 2 },
      { playerId: 'Q1001', teamId: 'Q100', statementId: 's4', appearances: 4 },
      { playerId: 'Q1001', teamId: 'Q10', statementId: 's5', appearances: 3 },
      { playerId: 'Q1002', teamId: 'Q100', statementId: 's6', appearances: 2 },
      { playerId: 'Q1003', teamId: 'Q100', statementId: 's7', appearances: 3, fromYear: 2020, toYear: 2078 },
      { playerId: 'Q1003', teamId: 'Q101', statementId: 's8', appearances: 2 },
    ]),
  });
  validateDataset(dataset);
  assert.equal(dataset.origin, 'wikidata-appearances');
  assert.equal(dataset.sources[0].usagePermission, 'unresolved');
  assert.deepEqual([...new Set(dataset.careers.map(career => career.playerId))].sort(), ['Q1000', 'Q1001']);
  const first = dataset.careers.find(career => career.playerId === 'Q1000' && career.teamId === 'Q100')!;
  assert.equal(first.id, 'wd-p1350:Q1000:Q100');
  assert.equal(first.fromYear, 2001);
  assert.equal(first.toYear, 2007);
  assert.equal(first.appeared, true);
  assert.equal(first.verified, true);
  assert.equal(first.provenance?.appearances, 15);
  // The priority club is present as a target but only linked players make it playable.
  assert.ok(dataset.entities.some(entity => entity.id === 'Q102' && entity.kind === 'club' && entity.level === 'senior'));
  assert.ok(!dataset.careers.some(career => career.playerId === 'Q1002'));
});

test('career years outside the football window are omitted, not invented', () => {
  const dataset = buildDataset({
    targets, catalog: catalogue, priority,
    snapshot: snapshot([
      { playerId: 'Q1000', teamId: 'Q100', statementId: 's1', appearances: 4, fromYear: 1700, toYear: 2078 },
      { playerId: 'Q1000', teamId: 'Q101', statementId: 's2', appearances: 2, fromYear: 1899, toYear: 2001 },
    ]),
  });
  const first = dataset.careers.find(career => career.playerId === 'Q1000' && career.teamId === 'Q100')!;
  assert.equal(first.fromYear, undefined);
  assert.equal(first.toYear, undefined);
  const second = dataset.careers.find(career => career.playerId === 'Q1000' && career.teamId === 'Q101')!;
  assert.equal(second.fromYear, 1899);
  assert.equal(second.toYear, 2001);
});

test('reviewed player/team pairs are not duplicated by the appearance snapshot', () => {
  const dataset = buildDataset({
    targets, catalog: catalogue, priority,
    snapshot: snapshot([
      { playerId: 'Q1000', teamId: 'Q100', statementId: 's1', appearances: 10 },
      { playerId: 'Q1000', teamId: 'Q101', statementId: 's2', appearances: 2 },
      { playerId: 'Q1001', teamId: 'Q100', statementId: 's3', appearances: 4 },
      { playerId: 'Q1001', teamId: 'Q10', statementId: 's4', appearances: 3 },
    ]),
    reviewedPairs: new Set(['Q1001:Q10']),
  });
  // Q1001 is left with one unreviewed team, so it is not answer-capable by itself.
  assert.deepEqual([...new Set(dataset.careers.map(career => career.playerId))], ['Q1000']);
});

test('appearance validation rejects membership-only, under-connected and non-Q identities', () => {
  const base = buildDataset({
    targets, catalog: catalogue, priority,
    snapshot: snapshot([
      { playerId: 'Q1000', teamId: 'Q100', statementId: 's1', appearances: 10 },
      { playerId: 'Q1000', teamId: 'Q101', statementId: 's2', appearances: 2 },
    ]),
  });
  const clone = (): Dataset => JSON.parse(JSON.stringify(base)) as Dataset;

  const noProvenance = clone();
  delete noProvenance.careers[0].provenance;
  assert.throws(() => validateDataset(noProvenance), /evidence is missing/);

  const notVerified = clone();
  notVerified.careers[0].verified = false;
  assert.throws(() => validateDataset(notVerified), /verified and appeared/);

  const singleTeam = clone();
  singleTeam.careers = [singleTeam.careers[0]];
  assert.throws(() => validateDataset(singleTeam), /fewer than two selections/);

  const duplicatePair = clone();
  duplicatePair.careers.push({ ...duplicatePair.careers[0], id: 'wd-p1350:Q1000:Q100:second' });
  assert.throws(() => validateDataset(duplicatePair), /Duplicate player\/team career/);

  const namespaced = clone();
  namespaced.entities.find(entity => entity.id === 'Q1000')!.id = 'player:Q1000';
  namespaced.careers.forEach(career => { if (career.playerId === 'Q1000') career.playerId = 'player:Q1000'; });
  assert.throws(() => validateDataset(namespaced), /Q-IDs/);
});

test('appearance target file and priority catalog stay curated and disjoint', async () => {
  const input: unknown = JSON.parse(await readFile('data/football.appearance-targets.json', 'utf8'));
  validateTargets(input);
  const top: { clubs: { id: string }[] } = JSON.parse(await readFile('data/club-catalog.top100.json', 'utf8'));
  const extra: { clubs: { id: string; countryId?: string; tier: string }[] } = JSON.parse(await readFile('data/club-catalog.priority.json', 'utf8'));
  const topIds = new Set(top.clubs.map(club => club.id));
  assert.equal(top.clubs.length, 100);
  assert.ok(extra.clubs.length > 0 && extra.clubs.length <= 20);
  const ids = new Set<string>();
  for (const club of extra.clubs) {
    assert.match(club.id, /^Q\d+$/);
    assert.equal(club.tier, 'P');
    assert.ok(club.countryId, 'priority club needs a country');
    assert.ok(!topIds.has(club.id), 'priority extension must not duplicate the top 100');
    assert.ok(!ids.has(club.id), 'priority club ids must be unique');
    ids.add(club.id);
  }
  const expected = ['Q172567', 'Q192641', 'Q170703', 'Q15799', 'Q35933', 'Q38568', 'Q80955', 'Q80987', 'Q188277'];
  for (const id of expected) assert.ok(ids.has(id), `missing priority club ${id}`);
});
