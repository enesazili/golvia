import { test } from 'node:test';
import assert from 'node:assert/strict';
import { datasetChecksum, nextReviewedVersion } from '../src/server/football/importer.ts';
import { buildReviewedExport, type ExportSnapshot } from '../src/server/football/review-export.ts';
import type { Career, Dataset } from '../src/server/football/types.ts';

const base: Dataset = {
  version: 'reviewed-test-v1',
  sources: [
    { id: 'wd-player', url: 'https://www.wikidata.org/wiki/Q1', license: 'CC0-1.0', retrieved: '2026-11-01' },
    { id: 'wd-club', url: 'https://www.wikidata.org/wiki/Q2', license: 'CC0-1.0', retrieved: '2026-11-01' },
    { id: 'review:career-1', url: 'https://www.psv.nl/match/1', license: 'reference-only', retrieved: '2026-11-01' },
  ],
  entities: [
    { id: 'Q1', kind: 'player', name: 'Test Player', aliases: [], birthDate: '1994-10-24', sourceId: 'wd-player', mark: '' },
    { id: 'Q2', kind: 'club', name: 'PSV Eindhoven', aliases: ['PSV'], level: 'senior', sourceId: 'wd-club', mark: 'PSV' },
  ],
  careers: [{
    id: 'career-1', playerId: 'Q1', teamId: 'Q2', appeared: false, verified: false,
    sourceId: 'wd-player', evidenceId: 'wd-player', provenance: {},
  }],
};
const snapshot = (reviewStatus: [string, string][] = [], careers: Career[] = base.careers): ExportSnapshot => ({
  careers, entities: base.entities, sources: base.sources, reviewStatus: new Map(reviewStatus),
});
const approved: Career = { ...base.careers[0], appeared: true, verified: true, evidenceId: 'review:career-1' };

test('export is a deterministic no-op when the database matches the JSON', () => {
  const result = buildReviewedExport(base, snapshot());
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.changed, []);
  assert.equal(datasetChecksum(result.dataset), datasetChecksum(base));
});

test('unreviewed database drift is a conflict, never overwritten', () => {
  const result = buildReviewedExport(base, snapshot([], [approved]));
  assert.equal(result.conflicts.length, 1);
  assert.match(result.conflicts[0], /incelenmemiş/);
});

test('reviewed database state is canonical and only bumps the version on change', () => {
  const result = buildReviewedExport(base, snapshot([['career-1', 'approved']], [approved]));
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.changed, ['career-1']);
  assert.equal(result.dataset.careers[0].verified, true);
  assert.equal(result.dataset.version, 'reviewed-test-v1');
  assert.equal(nextReviewedVersion(result.dataset.version), 'reviewed-test-v2');
});

test('approved database-only careers are added; unapproved ones are conflicts', () => {
  const extra: Career = { ...approved, id: 'career-2' };
  const added = buildReviewedExport(base, snapshot([['career-2', 'approved']], [...base.careers, extra]));
  assert.deepEqual(added.conflicts, []);
  assert.deepEqual(added.added, ['career-2']);
  assert.equal(added.dataset.careers.length, 2);

  const orphan = buildReviewedExport(base, snapshot([], [...base.careers, extra]));
  assert.equal(orphan.conflicts.length, 1);
  assert.match(orphan.conflicts[0], /onaylı\/oynanabilir değil/);
});

test('approved but unplayable careers are reported', () => {
  const broken: Career = { ...base.careers[0], verified: false, appeared: false };
  const result = buildReviewedExport(base, snapshot([['career-1', 'approved']], [broken]));
  assert.ok(result.conflicts.some(message => /onaylı ama oynanabilir değil/.test(message)));
});
