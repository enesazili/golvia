import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { importDataset, validateDataset } from '../src/server/football/importer.ts';
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
