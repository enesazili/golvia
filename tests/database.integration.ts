import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { importDataset, publishApprovedCareers, revertPublish, setSourceClearance, validateDataset } from '../src/server/football/importer.ts';
import { FootballRepository } from '../src/server/football/repository.ts';
import { PostgresMatchJournal } from '../src/server/matchJournal.ts';
import { connects, type Dataset } from '../src/server/football/types.ts';
import { normalize } from '../src/server/football/normalize.ts';
import { decideReview, listReviewQueue } from '../src/server/football/review.ts';
test('real PostgreSQL migration, import, queries and relation rules', async t => {
  const adminUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  assert.ok(adminUrl, 'DATABASE_ADMIN_URL or DATABASE_URL required; this test must not silently skip');
  // Migrations and temporary test schemas need a role with DDL rights; the runtime app role stays read-only for football data.
  const admin = new Pool({ connectionString: adminUrl });
  const schema = `golvia_test_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: adminUrl, options: `-c search_path=${schema},public` });
  try {
    const sql = await readFile(new URL('../src/server/football/schema.sql', import.meta.url), 'utf8');
    await pool.query(sql); await pool.query(sql);
    const seed: Dataset = JSON.parse(await readFile(new URL('../data/football.seed.json', import.meta.url), 'utf8'));
    await importDataset(pool, seed); await importDataset(pool, seed);
    const repo = new FootballRepository(pool);
    await t.test('import is idempotent and IDs remain stable', async () => {
      assert.equal((await pool.query('SELECT count(*) FROM football_entity')).rows[0].count, '10');
      assert.equal((await pool.query('SELECT count(*) FROM football_career')).rows[0].count, '9');
      assert.equal((await pool.query('SELECT count(*) FROM football_import_batch')).rows[0].count, '1');
    });
    await t.test('accent, Turkish case, aliases, substring and SQL metacharacters', async () => {
      assert.equal((await repo.search('player', ' LUİS '))[0]?.id, 'Q483145');
      assert.equal((await repo.search('player', 'di mar'))[0]?.id, 'Q251683');
      assert.equal((await repo.search('player', 'CR7'))[0]?.id, 'Q11571');
      assert.equal((await repo.search('selection', 'barça'))[0]?.id, 'Q7156');
      assert.equal((await repo.search('player', "%' OR 1=1 --")).length, 0);
      assert.equal((await repo.search('player', '%')).length, 0);
      assert.equal(normalize('IĞDIR İSTANBUL'), 'igdir istanbul');
    });
    await t.test('historical clubs and senior representations form valid links', async () => {
      const c = await repo.catalog();
      assert.equal(connects(c, 'Q483145', 'Q7156', 'Q8682'), true);
      assert.equal(connects(c, 'Q11571', 'Q8682', 'Q45'), true);
      assert.equal(connects(c, 'Q615', 'Q8682', 'Q414'), false);
      assert.equal(connects(c, 'Q251683', 'Q8682', 'Q414'), true);
    });
    await t.test('reviewed real careers support club pairs, nationality and suggestions', async () => {
      const reviewed: Dataset = JSON.parse(await readFile(new URL('../data/football.reviewed.json', import.meta.url), 'utf8'));
      await importDataset(pool, reviewed); await importDataset(pool, reviewed);
      const c = await repo.catalog();
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM football_career WHERE verified AND appeared")).rows[0].n, reviewed.careers.length);
      assert.equal(connects(c, 'Q128912', 'Q15789', 'Q11945'), true);
      assert.equal(connects(c, 'Q128912', 'Q15789', 'Q8682'), false);
      assert.equal((await repo.search('player', 'daley blind'))[0]?.id, 'Q128912');
      assert.equal((await repo.search('selection', 'girona'))[0]?.id, 'Q11945');
      assert.equal((await repo.search('selection', 'schalke')).length, 0, 'catalog-external reference club is not selectable');
      assert.equal((await repo.selections()).some(row => row.id === 'Q32494'), false);
      assert.equal(connects(c, 'Q11571', 'Q8682', 'Q482764'), true);
      assert.equal(connects(c, 'Q615', 'Q7156', 'Q483020'), true);
      assert.equal(connects(c, 'Q142794', 'Q7156', 'Q483020'), true);
      assert.equal(connects(c, 'Q459707', 'Q155', 'Q29'), true);
      assert.equal(connects(c, 'Q11571', 'Q8682', 'Q45'), true);
      assert.equal(connects(c, 'Q142794', 'Q8682', 'Q45'), false);
      assert.equal((await repo.search('selection', 'nassr'))[0]?.id, 'Q482764');
      assert.equal((await repo.search('selection', 'PSG'))[0]?.id, 'Q483020');
      assert.equal((await repo.search('player', 'Neymar Jr'))[0]?.id, 'Q142794');
      assert.equal((await repo.search('player', 'Bruma'))[0]?.id, 'Q1185419');
      assert.equal((await repo.search('selection', 'PSV'))[0]?.id, 'Q11938');
      assert.equal(connects(c, 'Q1185419', 'Q11938', 'Q131499'), true);
      assert.equal(connects(c, 'Q1185419', 'Q11938', 'Q75684'), true);
      assert.equal(connects(c, 'Q142794', 'Q7156', 'Q73965'), true);
    });
    await t.test('same names remain distinct; citizenship, youth, unverified and unused squads excluded', async () => {
      const d = structuredClone(seed); d.version = 'synthetic-test-only';
      d.entities.push({ id: 'test-player', kind: 'player', name: 'Lionel Messi', aliases: [], birthDate: '2000-01-01', countryId: 'Q45', sourceId: 'wd-messi' }, { id: 'test-youth', kind: 'national_team', name: 'Synthetic youth', aliases: [], countryId: 'Q45', level: 'youth', sourceId: 'wd-portugal' });
      d.careers.push({ id: 'test-youth-career', playerId: 'test-player', teamId: 'test-youth', appeared: true, verified: true, sourceId: 'wd-messi', evidenceId: 'real-ronaldo' }, { id: 'test-unplayed', playerId: 'test-player', teamId: 'Q8682', appeared: false, verified: true, sourceId: 'wd-messi', evidenceId: 'wd-messi' }, { id: 'test-unverified', playerId: 'test-player', teamId: 'Q7156', appeared: true, verified: false, sourceId: 'wd-messi', evidenceId: 'wd-messi' });
      await importDataset(pool, d);
      const found = await repo.search('player', 'Lionel Messi'); assert.equal(found.length, 1); assert.equal(found[0].id, 'Q615');
      assert.equal((await pool.query("SELECT count(*) FROM football_entity WHERE name='Lionel Messi'")).rows[0].count, '2');
      const c = await repo.catalog(); assert.equal(c.links.has('test-player'), false);
    });
    await t.test('candidate import preserves reviewed seed and stores unverified provenance', async () => {
      const reviewedVersion = (await pool.query('SELECT version FROM football_dataset WHERE id=1')).rows[0].version;
      const d = structuredClone(seed); d.origin = 'wikidata-candidates';
      d.version = 'candidate-only-version';
      d.entities[0].name = 'Candidate alternative label';
      d.careers = d.careers.map(c => ({ ...c, appeared: false, verified: false, provenance: { statementId: 'synthetic-statement' } }));
      d.careers.push({ ...d.careers[0], id: 'test-candidate' });
      d.entities.push({ id: 'test-reference-club', kind: 'club', name: 'Synthetic Reference Club', aliases: [], level: 'senior', sourceId: seed.sources[0].id });
      d.careers.push({ id: 'test-reference-career', playerId: seed.careers[0].playerId, teamId: 'test-reference-club', appeared: false, verified: false, sourceId: seed.sources[0].id, evidenceId: seed.sources[0].id, provenance: { statementId: 'synthetic-reference' } });
      await importDataset(pool, d); await importDataset(pool, d);
      assert.equal((await pool.query('SELECT version FROM football_dataset WHERE id=1')).rows[0].version, reviewedVersion);
      assert.equal((await pool.query('SELECT name FROM football_entity WHERE id=$1', [seed.entities[0].id])).rows[0].name, seed.entities[0].name);
      assert.equal((await pool.query('SELECT verified FROM football_career WHERE id=$1', [seed.careers[0].id])).rows[0].verified, true);
      const row = (await pool.query("SELECT verified,appeared,provenance FROM football_career WHERE id='test-candidate'")).rows[0];
      assert.equal(row.verified, false); assert.equal(row.appeared, false);
      assert.equal(row.provenance.statementId, 'synthetic-statement');
      assert.equal((await repo.search('selection', 'Synthetic Reference Club')).length, 0);
      assert.equal((await repo.search('selection', 'Candidate alternative label'))[0]?.id, seed.entities[0].id);
      d.careers[0].verified = true; assert.throws(() => validateDataset(d), /Candidate/);
    });
    await t.test('transfermarkt candidates keep transfers separate and add no playable links', async () => {
      const sourceId = seed.sources.find(s => s.license === 'CC0-1.0')!.id;
      const lead = seed.careers.find(c => c.verified && c.appeared)!;
      const linksBefore = (await pool.query('SELECT count(*)::int n FROM football_link')).rows[0].n;
      const careersBefore = (await pool.query('SELECT count(*)::int n FROM football_career')).rows[0].n;
      const versionBefore = (await pool.query('SELECT version FROM football_dataset WHERE id=1')).rows[0].version;
      const clubExternal = `tm:club:${lead.teamId}`;
      const tm: Dataset = {
        version: 'transfermarkt-synthetic-v1', origin: 'transfermarkt-candidates',
        sources: [{ id: sourceId, url: 'https://github.com/dcaribou/transfermarkt-datasets', license: 'CC0-1.0', retrieved: '2026-11-08' }],
        entities: [
          { id: 'tm:country:999', kind: 'country', name: 'Synthetic TM Land', aliases: [], sourceId },
          { id: 'tm:club:999', kind: 'club', name: 'Synthetic TM Club', aliases: [], countryId: 'tm:country:999', level: 'senior', sourceId },
          { id: 'tm:club:1000', kind: 'club', name: 'Recovered Senior Club', aliases: [], level: 'senior', sourceId },
          { id: 'tm:club:1001', kind: 'club', name: 'Synthetic Youth Club U19', aliases: [], level: 'youth', sourceId },
          { id: 'tm:player:999', kind: 'player', name: 'Synthetic TM Player', aliases: [], birthDate: '1990-01-01', sourceId },
        ],
        careers: [
          { id: 'tm-career:999:club:999', playerId: 'tm:player:999', teamId: 'tm:club:999', fromYear: 2015, toYear: 2016, appeared: true, verified: false, sourceId, evidenceId: sourceId, provenance: { evidence: 'appearance-rows', teamKind: 'club', teamLevel: 'senior', appearances: 4, externalPlayerId: 'tm:player:999', externalTeamId: 'tm:club:999' } },
          { id: 'tm-career:999:club:matched', playerId: lead.playerId, teamId: lead.teamId, fromYear: 2016, toYear: 2017, appeared: true, verified: false, sourceId, evidenceId: sourceId, provenance: { evidence: 'appearance-rows', teamKind: 'club', teamLevel: 'senior', appearances: 5, externalPlayerId: 'tm:player:999', externalTeamId: clubExternal } },
          { id: 'tm-career:999:club:1000', playerId: 'tm:player:999', teamId: 'tm:club:1000', fromYear: 2017, toYear: 2018, appeared: true, verified: false, sourceId, evidenceId: sourceId, provenance: { evidence: 'appearance-rows', teamKind: 'club', teamLevel: 'senior', appearances: 3, recoveredClub: true, externalPlayerId: 'tm:player:999', externalTeamId: 'tm:club:1000' } },
          { id: 'tm-career:999:club:1001', playerId: 'tm:player:999', teamId: 'tm:club:1001', fromYear: 2018, toYear: 2019, appeared: true, verified: false, sourceId, evidenceId: sourceId, provenance: { evidence: 'appearance-rows', teamKind: 'club', teamLevel: 'youth', appearances: 6, externalPlayerId: 'tm:player:999', externalTeamId: 'tm:club:1001' } },
        ],
        transfers: [{ id: 'tm-transfer:999:2020-01-01:999:0:19-20:1', playerId: 'tm:player:999', fromTeamId: 'tm:club:999', fromTeamName: 'Synthetic TM Club', date: '2020-01-01', season: '19/20', sourceId, provenance: { basis: 'transfer-record', externalPlayerId: 'tm:player:999' } }],
        identityLinks: [
          { source: 'transfermarkt', externalId: 'tm:player:999', entityId: lead.playerId, method: 'name+birthdate', status: 'confirmed', evidence: { rule: 'synthetic' } },
          { source: 'transfermarkt', externalId: clubExternal, entityId: lead.teamId, method: 'name-exact', status: 'confirmed', evidence: { rule: 'synthetic' } },
        ],
      };
      await importDataset(pool, tm); await importDataset(pool, tm);
      assert.equal((await pool.query('SELECT count(*)::int n FROM football_link')).rows[0].n, linksBefore);
      assert.equal((await pool.query("SELECT count(*)::int n FROM football_link WHERE player_id LIKE 'tm:%' OR selection_id LIKE 'tm:%'")).rows[0].n, 0);
      assert.equal((await repo.catalog()).playerIds.has('tm:player:999'), false, 'candidate players never enter the game answer pool');
      assert.equal((await pool.query('SELECT count(*)::int n FROM football_career')).rows[0].n, careersBefore + 4);
      assert.equal((await pool.query("SELECT count(*)::int n FROM football_link WHERE selection_id IN ('tm:club:1000','tm:club:1001')")).rows[0].n, 0, 'candidate senior and youth clubs never create playable links');
      const levels = (await pool.query("SELECT id,level,country_id FROM football_entity WHERE id IN ('tm:club:1000','tm:club:1001') ORDER BY id")).rows;
      assert.deepEqual(levels, [
        { id: 'tm:club:1000', level: 'senior', country_id: null },
        { id: 'tm:club:1001', level: 'youth', country_id: null },
      ]);
      assert.equal((await pool.query('SELECT version FROM football_dataset WHERE id=1')).rows[0].version, versionBefore);
      assert.equal((await pool.query('SELECT count(*)::int n FROM football_transfer')).rows[0].n, 1);
      assert.equal((await pool.query('SELECT count(*)::int n FROM football_identity_link')).rows[0].n, 2);
      assert.equal((await pool.query("SELECT count(*)::int n FROM football_career WHERE provenance->>'basis'='transfer-record'")).rows[0].n, 0);
      assert.equal((await repo.search('selection', 'Synthetic TM Club')).length, 0);

      // A newer revision may resolve an unverified candidate career, but a reviewed career is frozen.
      const revised = structuredClone(tm);
      revised.careers.find(c => c.id === 'tm-career:999:club:1000')!.playerId = lead.playerId;
      await importDataset(pool, revised);
      assert.equal((await pool.query("SELECT player_id FROM football_career WHERE id='tm-career:999:club:1000'")).rows[0].player_id, lead.playerId);
      await pool.query("INSERT INTO football_review(career_id,status,reason,revision) VALUES('tm-career:999:club:1000','pending','synthetic candidate review',0)");
      revised.careers.find(c => c.id === 'tm-career:999:club:1000')!.playerId = 'tm:player:999';
      await importDataset(pool, revised);
      assert.equal((await pool.query("SELECT player_id FROM football_career WHERE id='tm-career:999:club:1000'")).rows[0].player_id, lead.playerId, 'a career under review is not overwritten by a candidate re-import');
    });
    await t.test('usage permission gates live links and controlled publish is reversible', async () => {
      const referenceOnly = seed.sources.find(source => source.license === 'reference-only')!;
      await assert.rejects(setSourceClearance(pool, {
        sourceId: referenceOnly.id, status: 'cleared', basis: 'synthetic', evidence: 'synthetic', reviewedBy: 'test-reviewer',
      }), /Reference-only/);
      const sourceId = 'tm-dataset-license-test';
      const tm: Dataset = {
        version: 'transfermarkt-license-test-v1', origin: 'transfermarkt-candidates',
        sources: [
          { id: sourceId, url: 'https://github.com/dcaribou/transfermarkt-datasets', license: 'CC0-1.0', retrieved: '2026-11-08', usagePermission: 'unresolved' },
          { id: 'tm-evidence-license-test', url: 'https://huggingface.co/datasets/ngeorgea/transfermarkt-player-scores', license: 'CC0-1.0', retrieved: '2026-11-08', usagePermission: 'unresolved' },
        ],
        entities: [
          { id: 'tm:country:5000', kind: 'country', name: 'License Test Land', aliases: [], sourceId },
          { id: 'tm:club:5000', kind: 'club', name: 'License Test Club', aliases: [], countryId: 'tm:country:5000', level: 'senior', sourceId },
          { id: 'tm:player:5000', kind: 'player', name: 'License Test Player', aliases: [], birthDate: '1995-05-05', sourceId },
        ],
        careers: [{
          id: 'tm-career:5000:club:5000', playerId: 'tm:player:5000', teamId: 'tm:club:5000', fromYear: 2020, toYear: 2022,
          appeared: true, verified: false, sourceId, evidenceId: 'tm-evidence-license-test',
          provenance: { evidence: 'appearance-rows', appearances: 12, externalPlayerId: 'tm:player:5000', externalTeamId: 'tm:club:5000' },
        }],
        transfers: [], identityLinks: [],
      };
      await importDataset(pool, tm); await importDataset(pool, tm);
      assert.equal((await pool.query('SELECT count(*)::int n FROM football_career WHERE id=$1', [tm.careers[0].id])).rows[0].n, 1, 'repeated candidate import does not duplicate careers');
      assert.equal((await pool.query('SELECT status FROM football_source_clearance WHERE source_id=$1', [sourceId])).rows[0].status, 'unresolved');
      assert.equal((await pool.query('SELECT count(*)::int n FROM football_link WHERE selection_id=$1', [tm.careers[0].teamId])).rows[0].n, 0, 'unresolved candidates never reach the live view');
      await pool.query(`INSERT INTO football_review(career_id,status,reason,revision) VALUES($1,'approved','Synthetic publish approval',0)`, [tm.careers[0].id]);
      await assert.rejects(publishApprovedCareers(pool, { sourceId, publishedBy: 'test-reviewer' }), /not cleared/);
      await setSourceClearance(pool, {
        sourceId, status: 'cleared', basis: 'synthetic-test-clearance',
        evidence: 'Synthetic isolated-schema clearance for the publish workflow test.', reviewedBy: 'test-reviewer',
      });
      const published = await publishApprovedCareers(pool, { sourceId, publishedBy: 'test-reviewer' });
      assert.deepEqual(published.careers, [tm.careers[0].id]);
      assert.ok(published.batchId);
      assert.equal((await pool.query('SELECT verified FROM football_career WHERE id=$1', [tm.careers[0].id])).rows[0].verified, true);
      assert.equal((await pool.query('SELECT count(*)::int n FROM football_link WHERE player_id=$1 AND selection_id=$2', ['tm:player:5000', 'tm:club:5000'])).rows[0].n, 1);
      const repeated = await publishApprovedCareers(pool, { sourceId, publishedBy: 'test-reviewer' });
      assert.deepEqual(repeated, { batchId: null, careers: [] });
      // A re-import of the candidate dataset must not undo or duplicate the published row.
      await importDataset(pool, tm);
      assert.equal((await pool.query('SELECT verified FROM football_career WHERE id=$1', [tm.careers[0].id])).rows[0].verified, true);
      assert.equal((await pool.query('SELECT count(*)::int n FROM football_career WHERE id=$1', [tm.careers[0].id])).rows[0].n, 1);
      const reverted = await revertPublish(pool, { batchId: published.batchId!, revertedBy: 'test-reviewer' });
      assert.deepEqual(reverted.careers, [tm.careers[0].id]);
      assert.equal((await pool.query('SELECT verified FROM football_career WHERE id=$1', [tm.careers[0].id])).rows[0].verified, false);
      assert.equal((await pool.query('SELECT count(*)::int n FROM football_link WHERE player_id=$1', ['tm:player:5000'])).rows[0].n, 0);
      assert.deepEqual(await revertPublish(pool, { batchId: published.batchId!, revertedBy: 'test-reviewer' }), { careers: [] });
    });
    await t.test('a blocked reviewed source cannot create live links', async () => {
      const d = structuredClone(seed);
      d.version = 'synthetic-blocked-source';
      d.sources.push(
        { id: 'synthetic-blocked-data', url: 'https://example.com/blocked-data', license: 'CC0-1.0', retrieved: '2026-11-08', usagePermission: 'blocked' },
        { id: 'synthetic-blocked-evidence', url: 'https://example.com/blocked-match', license: 'reference-only', retrieved: '2026-11-08' },
      );
      d.entities.push({ id: 'Q999993', kind: 'player', name: 'Synthetic Blocked Player', aliases: [], birthDate: '1996-06-06', sourceId: 'synthetic-blocked-data' });
      d.careers.push({
        id: 'wd-statement-q999993-blocked', playerId: 'Q999993', teamId: 'Q8682', appeared: true, verified: true,
        sourceId: 'synthetic-blocked-data', evidenceId: 'synthetic-blocked-evidence', provenance: { statementId: 'synthetic-blocked' },
      });
      await importDataset(pool, d);
      assert.equal((await pool.query('SELECT usage_permission FROM football_source WHERE id=$1', ['synthetic-blocked-data'])).rows[0].usage_permission, 'blocked');
      assert.equal((await pool.query('SELECT count(*)::int n FROM football_link WHERE player_id=$1', ['Q999993'])).rows[0].n, 0);
    });
    await t.test('wikidata appearance snapshot is additive, gated and idempotent', async () => {
      const { APPEARANCE_BASIS } = await import('../src/server/football/appearances.ts');
      const sourceId = 'wd-appearance-test-v1';
      const linksBefore = (await pool.query('SELECT count(*)::int n FROM football_link')).rows[0].n;
      const reviewedName = (await pool.query("SELECT name FROM football_entity WHERE id='Q8682'")).rows[0].name;
      const dataset: Dataset = {
        version: 'wikidata-appearances-test-v1', origin: 'wikidata-appearances',
        sources: [{ id: sourceId, url: 'https://query.wikidata.org/', license: 'CC0-1.0', retrieved: '2026-11-08', usagePermission: 'unresolved' }],
        entities: [
          { id: 'Q8682', kind: 'club', name: 'Synthetic Real Madrid Label', aliases: [], level: 'senior', sourceId },
          { id: 'Q7156', kind: 'club', name: 'Synthetic Barcelona Label', aliases: [], level: 'senior', sourceId },
          { id: 'Q999801', kind: 'player', name: 'Synthetic Appearance One', aliases: ['Synthetic Alias One'], birthDate: '1992-03-04', sourceId },
          { id: 'Q999802', kind: 'player', name: 'Synthetic Appearance Two', aliases: [], sourceId },
        ],
        careers: [
          { id: 'wd-p1350:Q999801:Q8682', playerId: 'Q999801', teamId: 'Q8682', fromYear: 2010, toYear: 2014, appeared: true, verified: true, sourceId, evidenceId: sourceId, provenance: { basis: APPEARANCE_BASIS, appearances: 40, statementIds: ['s1'], license: 'CC0-1.0' } },
          { id: 'wd-p1350:Q999801:Q7156', playerId: 'Q999801', teamId: 'Q7156', fromYear: 2015, toYear: 2018, appeared: true, verified: true, sourceId, evidenceId: sourceId, provenance: { basis: APPEARANCE_BASIS, appearances: 20, statementIds: ['s2'], license: 'CC0-1.0' } },
          { id: 'wd-p1350:Q999802:Q8682', playerId: 'Q999802', teamId: 'Q8682', fromYear: 2019, toYear: 2020, appeared: true, verified: true, sourceId, evidenceId: sourceId, provenance: { basis: APPEARANCE_BASIS, appearances: 12, statementIds: ['s3'], license: 'CC0-1.0' } },
          { id: 'wd-p1350:Q999802:Q7156', playerId: 'Q999802', teamId: 'Q7156', fromYear: 2021, toYear: 2022, appeared: true, verified: true, sourceId, evidenceId: sourceId, provenance: { basis: APPEARANCE_BASIS, appearances: 8, statementIds: ['s4'], license: 'CC0-1.0' } },
        ],
      };
      await importDataset(pool, dataset); await importDataset(pool, dataset);
      assert.equal((await pool.query('SELECT count(*)::int n FROM football_link')).rows[0].n, linksBefore, 'the import cannot clear its own source');
      assert.equal((await pool.query('SELECT status FROM football_source_clearance WHERE source_id=$1', [sourceId])).rows[0].status, 'unresolved');
      assert.equal((await pool.query('SELECT count(*)::int n FROM football_career WHERE source_id=$1', [sourceId])).rows[0].n, 4);
      assert.equal((await pool.query('SELECT count(*)::int n FROM football_import_batch WHERE origin=$1', ['wikidata-appearances'])).rows[0].n, 1, 'repeated import is idempotent');
      assert.equal((await pool.query("SELECT name FROM football_entity WHERE id='Q8682'")).rows[0].name, reviewedName, 'reviewed entity labels are not overwritten');
      assert.equal((await repo.catalog()).playerIds.has('Q999801'), false);
      await setSourceClearance(pool, {
        sourceId, status: 'cleared', basis: 'CC0-1.0',
        evidence: 'Synthetic isolated-schema CC0 appearance clearance for the test.', reviewedBy: 'test-reviewer',
      });
      const catalog = await repo.catalog();
      assert.equal(connects(catalog, 'Q999801', 'Q8682', 'Q7156'), true);
      assert.equal(connects(catalog, 'Q999802', 'Q8682', 'Q7156'), true);
      assert.equal(catalog.playerIds.has('Q999801'), true);
      await importDataset(pool, dataset);
      assert.equal((await pool.query('SELECT status FROM football_source_clearance WHERE source_id=$1', [sourceId])).rows[0].status, 'cleared', 'an explicit clearance survives re-import');
      assert.equal((await pool.query('SELECT count(*)::int n FROM football_career WHERE source_id=$1', [sourceId])).rows[0].n, 4);
    });
    await t.test('invalid provenance, duplicate IDs and invalid career reference rejected', async () => {
      const duplicate = structuredClone(seed); duplicate.entities.push(duplicate.entities[0]); assert.throws(() => validateDataset(duplicate), /duplicate/);
      const invalid = structuredClone(seed); invalid.careers[0].playerId = 'Q45'; await assert.rejects(importDataset(pool, invalid), /career/);
      const unlicensed = structuredClone(seed); unlicensed.sources[0].license = 'reference-only'; assert.throws(() => validateDataset(unlicensed), /unlicensed/);
    });
    await t.test('transaction rolls back earlier writes when existing identity conflicts', async () => {
      const invalid = structuredClone(seed); invalid.sources[0].url = 'https://invalid.example/'; invalid.entities[0].kind = 'player';
      invalid.entities = invalid.entities.filter(e => e.kind !== 'national_team'); invalid.careers = invalid.careers.filter(c => !['Q267245', 'Q79800'].includes(c.teamId));
      await assert.rejects(importDataset(pool, invalid), /immutable/);
      assert.equal((await pool.query("SELECT url FROM football_source WHERE id='wd-ronaldo'")).rows[0].url, seed.sources[0].url);
    });
    await t.test('single-career review is atomic, versioned, reversible and protected from reimport', async () => {
      const d = structuredClone(seed);
      d.version = 'synthetic-review-test';
      d.entities.push({ id:'Q999991',kind:'player',name:'Synthetic Reviewer Player',aliases:[],birthDate:'1994-10-24',sourceId:'wd-ronaldo' });
      d.sources.push({id:'review:synthetic-preverified',url:'https://www.laliga.com/match/preverified',license:'reference-only',retrieved:'2026-11-01'});
      d.careers.push({id:'wd-statement-Q999991-test',playerId:'Q999991',teamId:'Q8682',appeared:false,verified:false,sourceId:'wd-ronaldo',evidenceId:'wd-ronaldo',provenance:{statementId:'synthetic'} });
      d.careers.push({id:'wd-statement-q999991-preverified',playerId:'Q999991',teamId:'Q7156',appeared:true,verified:true,sourceId:'wd-ronaldo',evidenceId:'review:synthetic-preverified',provenance:{statementId:'synthetic-preverified'} });
      d.entities.push({ id:'Q999992',kind:'club',name:'Synthetic Unknown Club',aliases:[],level:'unknown',sourceId:'wd-ronaldo',mark:'SUC' });
      d.careers.push({id:'wd-statement-Q999991-unknown',playerId:'Q999991',teamId:'Q999992',appeared:false,verified:false,sourceId:'wd-ronaldo',evidenceId:'wd-ronaldo',provenance:{statementId:'synthetic-unknown'} });
      await importDataset(pool,d);
      await assert.rejects(decideReview(pool,{careerId:'wd-statement-q999991-preverified',revision:0,decision:'hold',reason:'Must preserve existing proof'},new Set(['Q7156'])),/Önceden doğrulanmış/);
      const top = [{id:'Q8682',rank:1}];
      assert.ok((await listReviewQueue(pool,top)).some(row=>row.career_id==='wd-statement-Q999991-test'));
      const action = { careerId:'wd-statement-Q999991-test',revision:0,decision:'approved' as const,reason:'Resmî maç ve bağımsız kimlik kontrol edildi.',
        actor:'test-reviewer',requestId:'req-approve',
        observation:{ matchUrl:'https://www.laliga.com/match/test-123',identityUrl:'https://www.laliga.com/player/test-123',matchId:'test-123',matchDate:'2024-05-01',competition:'LaLiga',playerName:'Synthetic Reviewer Player',birthDate:'1994-10-24',teamName:'Real Madrid',teamLevel:'senior' as const,matchStatus:'final' as const,event:'minutes-played' as const,minutesPlayed:20,
          sourceNote:'LaLiga resmî maç sayfası oyuncunun 20 dakika oynadığını ve maçın tamamlandığını gösteriyor.',identityNote:'LaLiga resmî oyuncu profili doğum tarihini ve tam adı bağımsız doğruluyor.',reviewerChecked:true as const } };
      await assert.rejects(decideReview(pool,{...action,observation:{...action.observation,teamName:'Barcelona'}},new Set(['Q8682'])),/A takım/);
      await assert.rejects(decideReview(pool,{...action,observation:{...action.observation,sourceNote:''}},new Set(['Q8682'])),/notu/);
      await decideReview(pool,action,new Set(['Q8682']));
      const audit = (await pool.query("SELECT action,actor,request_id FROM football_review_event WHERE career_id='wd-statement-Q999991-test' ORDER BY id DESC LIMIT 1")).rows[0];
      assert.deepEqual(audit,{action:'decision',actor:'test-reviewer',request_id:'req-approve'});
      const unknown = { ...action, careerId:'wd-statement-Q999991-unknown',requestId:'req-unknown',
        observation:{...action.observation,teamName:'Synthetic Unknown Club',matchId:'test-unknown'} };
      await decideReview(pool,unknown,new Set(['Q999992']));
      assert.equal((await pool.query("SELECT level FROM football_entity WHERE id='Q999992'")).rows[0].level,'senior');
      assert.equal((await pool.query("SELECT count(*)::int n FROM football_link WHERE player_id='Q999991' AND selection_id='Q999992'")).rows[0].n,1);
      const levelAudit = (await pool.query("SELECT action FROM football_review_event WHERE career_id='wd-statement-Q999991-unknown' ORDER BY id DESC LIMIT 1")).rows[0];
      assert.equal(levelAudit.action,'decision+level-correction');
      assert.equal((await pool.query("SELECT count(*)::int n FROM football_link WHERE player_id='Q999991' ")).rows[0].n,3);
      await assert.rejects(decideReview(pool,action,new Set(['Q8682'])),/sürümü/);
      await importDataset(pool,d);
      assert.equal((await pool.query("SELECT verified FROM football_career WHERE id='wd-statement-Q999991-test'")).rows[0].verified,true);
      await decideReview(pool,{careerId:action.careerId,revision:1,decision:'hold',reason:'Kaynakla yeni uyuşmazlık saptandı.'},new Set(['Q8682']));
      assert.equal((await pool.query("SELECT count(*)::int n FROM football_link WHERE player_id='Q999991' ")).rows[0].n,1);
      await importDataset(pool,d);
      assert.equal((await pool.query("SELECT verified FROM football_career WHERE id='wd-statement-Q999991-test'")).rows[0].verified,false);
      assert.equal((await pool.query("SELECT count(*)::int n FROM football_review_event WHERE career_id='wd-statement-Q999991-test'")).rows[0].n,2);
      await pool.query(`INSERT INTO football_review(career_id,status,reason,revision)
        VALUES('wd-statement-q999991-preverified','pending','Bağımsız kimlik kanıtı eksik; yeniden inceleme.',0)`);
      const flagged = await listReviewQueue(pool,[{id:'Q7156',rank:2}]);
      assert.ok(flagged.some(row => row.career_id === 'wd-statement-q999991-preverified'), 'verified career flagged pending must return to the queue');
    });
  } finally {
    await pool.end();
    // Only the generated, strictly alphanumeric test schema is removed; production tables untouched.
    await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});

test('match journal persists lifecycle, closes stale matches once and stays idempotent', async () => {
  const adminUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  assert.ok(adminUrl, 'DATABASE_ADMIN_URL or DATABASE_URL required; this test must not silently skip');
  const admin = new Pool({ connectionString: adminUrl });
  const schema = `golvia_match_test_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: adminUrl, options: `-c search_path=${schema},public` });
  try {
    for (const file of ['../src/server/football/schema.sql', '../src/server/match/schema.sql']) {
      await pool.query(await readFile(new URL(file, import.meta.url), 'utf8'));
    }
    const now = Date.now();
    const first = new PostgresMatchJournal(pool, 'versus');
    await first.start({ matchId: 'match-one', createdAt: now, expiresAt: now + 60_000 });
    await first.start({ matchId: 'match-one', createdAt: now, expiresAt: now + 60_000 });
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM golvia_match')).rows[0].n, 1, 'duplicate start does not create a second row');
    assert.equal((await pool.query("SELECT closed_at FROM golvia_match WHERE id='match-one'")).rows[0].closed_at, null);
    await first.close('match-one', 'finished');
    const closedAt = (await pool.query("SELECT closed_at FROM golvia_match WHERE id='match-one'")).rows[0].closed_at;
    await first.close('match-one', 'expired');
    assert.equal((await pool.query("SELECT close_reason FROM golvia_match WHERE id='match-one'")).rows[0].close_reason, 'finished', 'a finished match cannot be closed twice with a different reason');
    assert.ok(closedAt);
    await first.start({ matchId: 'match-two', createdAt: now, expiresAt: now + 60_000 });
    const second = new PostgresMatchJournal(pool, 'versus');
    assert.equal(await second.recover(), 1, 'a new process closes matches it cannot own');
    const stale = (await pool.query("SELECT close_reason FROM golvia_match WHERE id='match-two'")).rows[0];
    assert.equal(stale.close_reason, 'server-restart');
    assert.equal(await second.recover(), 1, 'recovery result is memoized for the process');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM golvia_match WHERE closed_at IS NULL')).rows[0].n, 0, 'no open matches remain after recovery');
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});
