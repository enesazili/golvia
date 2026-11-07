import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { CompetitiveRepository } from '../src/server/competitive/repository.ts';

test('PostgreSQL ranked results, atomic ELO, idempotency, account ownership and leaderboard', { timeout: 30000 }, async t => {
  const connection = process.env.TEST_DATABASE_URL;
  assert.ok(connection, 'TEST_DATABASE_URL required; real PostgreSQL test cannot silently skip');
  const target = new URL(connection);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) && target.pathname === '/golvia_account_test', 'Use only the isolated local golvia_account_test database');
  const admin = new Pool({ connectionString: connection, connectionTimeoutMillis: 2000 });
  const suffix = randomUUID().replaceAll('-', '');
  const schema = `golvia_ranked_test_${suffix}`;
  const users = ['a', 'b', 'c', 'd', 'unverified'].map(name => `ranked-${suffix}-${name}`);
  let pool: Pool | undefined;
  try {
    await admin.query(await readFile(new URL('../src/server/auth/schema.sql', import.meta.url), 'utf8'));
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: connection, max: 10, options: `-c search_path=${schema},public`, connectionTimeoutMillis: 2000 });
    const migration = await readFile(new URL('../src/server/competitive/schema.sql', import.meta.url), 'utf8');
    await pool.query(migration); await pool.query(migration);
    for (const [index, id] of users.entries()) await admin.query('INSERT INTO golvia_auth."user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,$4,now(),now())', [id, `Synthetic ${index}`, `${id}@example.invalid`, index < 4]);
    const repository = new CompetitiveRepository(pool);
    const at = Date.now() - 60000;
    await t.test('only active verified, distinct accounts may start a ranked match', async () => {
      assert.equal((await repository.profile(users[0])).ratings[0].elo, 1000);
      assert.equal((await repository.cancel('unknown-start', 'cancelled')).status, 'cancelled');
      await assert.rejects(repository.start('invalid', [users[0], users[4]], at), /doğrulanmış/);
      await assert.rejects(repository.start('self', [users[0], users[0]], at), /Kendi/);
      assert.equal((await pool!.query('SELECT COUNT(*)::int n FROM competitive_match')).rows[0].n, 0);
      await repository.start('first', [users[0], users[1]], at);
      await assert.rejects(repository.start('overlap', [users[0], users[2]], at), /devam eden/);
      assert.equal((await pool!.query("SELECT COUNT(*)::int n FROM competitive_match WHERE id='overlap'")).rows[0].n, 0);
    });
    await t.test('sixteen concurrent duplicates commit the result and both ratings exactly once', async () => {
      const results = await Promise.all(Array.from({ length: 16 }, () => repository.complete('first', [3, 1], 0, at + 1000)));
      for (const result of results) { assert.deepEqual(result.before, [1000, 1000]); assert.deepEqual(result.after, [1016, 984]); }
      const ratings = (await pool!.query('SELECT elo,wins,losses,draws FROM competitive_rating ORDER BY user_id')).rows;
      assert.deepEqual(ratings, [{ elo: 1016, wins: 1, losses: 0, draws: 0 }, { elo: 984, wins: 0, losses: 1, draws: 0 }]);
      await assert.rejects(repository.complete('first', [1, 3], 1, at + 2000), /çakışıyor/);
      await assert.rejects(repository.cancel('first', 'cancelled'), /Tamamlanmış/);
      assert.equal((await pool!.query('SELECT COUNT(*)::int n FROM competitive_participant WHERE active')).rows[0].n, 0);
    });
    await t.test('independent simultaneous results, draws and later matches use locked current ELO', async () => {
      await repository.start('second', [users[0], users[1]], at + 2000);
      await repository.start('third', [users[2], users[3]], at + 2000);
      const [second, third] = await Promise.all([repository.complete('second', [1, 3], 1, at + 3000), repository.complete('third', [2, 2], null, at + 3000)]);
      assert.deepEqual(second.before, [1016, 984]); assert.deepEqual(second.after, [999, 1001]);
      assert.deepEqual(third.before, [1000, 1000]); assert.deepEqual(third.after, [1000, 1000]);
      const profile = await repository.profile(users[2]); assert.equal(profile.ratings[0].draws, 1); assert.equal(profile.ratings[0].played, 1);
      await pool!.query('INSERT INTO competitive_rating(user_id,mode,elo) VALUES($1,$2,$3)', [users[0], 'synthetic-other-mode', 1450]);
      assert.equal((await repository.profile(users[0])).ratings.find(r => r.mode === 'synthetic-other-mode')?.elo, 1450);
    });
    await t.test('a failed second rating update rolls back the first rating and match result', async () => {
      await repository.start('rollback', [users[0], users[1]], at + 4000);
      const before = (await pool!.query('SELECT * FROM competitive_rating ORDER BY user_id,mode')).rows;
      await pool!.query(`CREATE FUNCTION fail_rating() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id='${users[1]}' THEN RAISE EXCEPTION 'synthetic update failure'; END IF; RETURN NEW; END $$`);
      await pool!.query('CREATE TRIGGER fail_second BEFORE UPDATE ON competitive_rating FOR EACH ROW EXECUTE FUNCTION fail_rating()');
      await assert.rejects(repository.complete('rollback', [3, 0], 0, at + 5000), /synthetic update failure/);
      assert.deepEqual((await pool!.query('SELECT * FROM competitive_rating ORDER BY user_id,mode')).rows, before);
      assert.equal((await pool!.query("SELECT status FROM competitive_match WHERE id='rollback'")).rows[0].status, 'active');
      await pool!.query('DROP TRIGGER fail_second ON competitive_rating');
      await repository.cancel('rollback', 'cancelled');
      await assert.rejects(repository.complete('rollback', [3, 0], 0, at + 6000), /kaydedilemez/);
    });
    await t.test('cancel and complete race has one terminal outcome and never partially rates a cancelled game', async () => {
      await repository.start('race', [users[0], users[1]], at + 7000);
      const before = (await repository.profile(users[0])).ratings.find(r => r.mode === '3-2-1')!;
      await Promise.allSettled([repository.cancel('race', 'cancelled'), repository.complete('race', [3, 0], 0, at + 8000)]);
      const match = (await pool!.query("SELECT status FROM competitive_match WHERE id='race'")).rows[0];
      const after = (await repository.profile(users[0])).ratings.find(r => r.mode === '3-2-1')!;
      assert.equal(after.played, before.played + (match.status === 'completed' ? 1 : 0));
    });
    await t.test('leaderboard is ordered, paginated and excludes unverified users; profile is private by caller ID', async () => {
      const board = await repository.leaderboard('3-2-1', 1, 2);
      assert.equal(board.items.length, 2); assert.equal(board.hasNext, true);
      assert.ok(board.items[0].elo >= board.items[1].elo);
      const next = await repository.leaderboard('3-2-1', 2, 2); assert.equal(next.items[0].rank, 3);
      assert.ok(!board.items.map(r => r.name).includes(next.items[0].name));
      assert.equal((await repository.leaderboard('overall', 1)).items.length, 4);
      await assert.rejects(repository.leaderboard("3-2-1'; DROP TABLE competitive_rating; --", 1), /Geçersiz/);
      await assert.rejects(repository.leaderboard('3-2-1', -1), /Geçersiz/);
    });
    await t.test('restart recovery cancels active matches and releases ownership without ELO', async () => {
      await repository.start('restart', [users[2], users[3]], at + 9000);
      const before = await repository.profile(users[2]); await repository.recover();
      assert.deepEqual(await repository.profile(users[2]), before);
      assert.equal((await pool!.query("SELECT status FROM competitive_match WHERE id='restart'")).rows[0].status, 'cancelled');
      assert.equal((await pool!.query('SELECT COUNT(*)::int n FROM competitive_participant WHERE active')).rows[0].n, 0);
    });
    await t.test('forfeit keeps the played score and rates both accounts only once', async () => {
      await pool!.query('ALTER TABLE competitive_match DROP CONSTRAINT competitive_match_result_check');
      await pool!.query("ALTER TABLE competitive_match ADD CONSTRAINT legacy_result_check CHECK (status <> 'completed' OR reason = 'finished')");
      await pool!.query(migration);
      await repository.start('forfeit', [users[0], users[1]], at + 11000);
      const before = await repository.profile(users[0]);
      const results = await Promise.all(Array.from({ length: 12 }, () => repository.complete('forfeit', [0, 0], 1, at + 12000, 'forfeit')));
      assert.ok(results.every(result => result.reason === 'forfeit' && result.winner === 1));
      const after = await repository.profile(users[0]);
      assert.equal(after.ratings.find(r => r.mode === '3-2-1')!.played, before.ratings.find(r => r.mode === '3-2-1')!.played + 1);
      assert.deepEqual((await pool!.query("SELECT status,reason,score0,score1,winner FROM competitive_match WHERE id='forfeit'")).rows[0], { status: 'completed', reason: 'forfeit', score0: 0, score1: 0, winner: 1 });
      await assert.rejects(pool!.query("UPDATE competitive_match SET reason=NULL WHERE id='forfeit'"), /competitive_match_result_check/);
      await assert.rejects(pool!.query("UPDATE competitive_match SET winner=NULL WHERE id='forfeit'"), /competitive_match_result_check/);
      await assert.rejects(repository.complete('forfeit', [0, 0], null, at + 12000), /çakışıyor/);
      await assert.rejects(repository.cancel('forfeit', 'disconnect'), /Tamamlanmış/);
    });
  } finally {
    await pool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
    await admin.query('DELETE FROM golvia_auth."user" WHERE id=ANY($1::text[])', [users]).catch(() => undefined);
    await admin.end();
  }
});
