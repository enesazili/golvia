import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { importDataset, validateDataset } from '../src/server/football/importer.ts';
import { FootballRepository } from '../src/server/football/repository.ts';
import { connects, type Dataset } from '../src/server/football/types.ts';
import { normalize } from '../src/server/football/normalize.ts';
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
      assert.equal(connects(c, 'Q11571', 'Q8682', 'Q482764'), true);
      assert.equal(connects(c, 'Q615', 'Q7156', 'Q483020'), true);
      assert.equal(connects(c, 'Q142794', 'Q7156', 'Q483020'), true);
      assert.equal(connects(c, 'Q459707', 'Q155', 'Q29'), true);
      assert.equal(connects(c, 'Q11571', 'Q8682', 'Q45'), true);
      assert.equal(connects(c, 'Q142794', 'Q8682', 'Q45'), false);
      assert.equal((await repo.search('selection', 'nassr'))[0]?.id, 'Q482764');
      assert.equal((await repo.search('selection', 'PSG'))[0]?.id, 'Q483020');
      assert.equal((await repo.search('player', 'Neymar Jr'))[0]?.id, 'Q142794');
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
      await importDataset(pool, d); await importDataset(pool, d);
      assert.equal((await pool.query('SELECT version FROM football_dataset WHERE id=1')).rows[0].version, reviewedVersion);
      assert.equal((await pool.query('SELECT name FROM football_entity WHERE id=$1', [seed.entities[0].id])).rows[0].name, seed.entities[0].name);
      assert.equal((await pool.query('SELECT verified FROM football_career WHERE id=$1', [seed.careers[0].id])).rows[0].verified, true);
      const row = (await pool.query("SELECT verified,appeared,provenance FROM football_career WHERE id='test-candidate'")).rows[0];
      assert.equal(row.verified, false); assert.equal(row.appeared, false);
      assert.equal(row.provenance.statementId, 'synthetic-statement');
      assert.equal((await repo.search('selection', 'Candidate alternative label'))[0]?.id, seed.entities[0].id);
      d.careers[0].verified = true; assert.throws(() => validateDataset(d), /Candidate/);
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
  } finally {
    await pool.end();
    // Only the generated, strictly alphanumeric test schema is removed; production tables untouched.
    await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});
