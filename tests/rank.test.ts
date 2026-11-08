import { test } from 'node:test';
import assert from 'node:assert/strict';
import { league, rankProgress } from '../src/lib/rating.ts';
test('existing rank boundaries, promotion, demotion and progress stay compatible', () => {
  for (const [elo, name] of [[0,'Bronz'],[899,'Bronz'],[900,'Gümüş'],[1099,'Gümüş'],[1100,'Altın'],[1299,'Altın'],[1300,'Platin'],[1499,'Platin'],[1500,'Elmas'],[1799,'Elmas'],[1800,'Usta'],[2400,'Usta']] as const) assert.equal(league(elo), name);
  assert.equal(rankProgress(1000).remaining, 100); assert.equal(rankProgress(1000).progress, 50);
  assert.equal(rankProgress(1100).progress, 0); assert.equal(rankProgress(1099).remaining, 1);
  assert.equal(rankProgress(1800).next, null); assert.equal(rankProgress(2000).progress, 100);
  for (const value of [-1, NaN, 10.1, Infinity]) assert.throws(() => rankProgress(value), /Invalid ELO/);
});
