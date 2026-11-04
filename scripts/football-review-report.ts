import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { atomicJson } from './wikidata/files.ts';
import { validateTop100Catalog } from './wikidata/top100.ts';
import { listReviewQueue } from '../src/server/football/review.ts';
import { reviewAvailable } from '../src/server/football/review-access.ts';
import { FootballRepository } from '../src/server/football/repository.ts';

const url = process.env.DATABASE_ADMIN_URL;
if (!reviewAvailable('development',url)) throw new Error('Local golvia_stage admin connection required');
const catalog: unknown = JSON.parse(await readFile('data/club-catalog.top100.json','utf8'));
validateTop100Catalog(catalog);
const pool = new Pool({connectionString:url,max:1});
try {
  const items = await listReviewQueue(pool,catalog.clubs.map(c=>({id:c.id,rank:c.rank})),50);
  const playable = await new FootballRepository(pool).catalog();
  const clubIds = new Set(catalog.clubs.map(c=>c.id));
  const pairs = new Set<string>(), players = new Set<string>(), usedClubs = new Set<string>();
  for (const [player, selections] of playable.links) {
    const ids = [...selections].filter(id=>clubIds.has(id));
    if (ids.length >= 2) players.add(player);
    for (const id of ids) usedClubs.add(id);
    for (let a=0;a<ids.length;a++) for (let b=a+1;b<ids.length;b++) pairs.add([ids[a],ids[b]].sort().join('/'));
  }
  const counts = await pool.query(`SELECT
    (SELECT count(*)::int FROM football_career WHERE verified AND appeared) AS verified_careers,
    (SELECT count(*)::int FROM football_review WHERE status='approved') AS new_approvals,
    (SELECT count(*)::int FROM football_review WHERE status='hold') AS held,
    (SELECT count(*)::int FROM football_review WHERE status='rejected') AS rejected,
    (SELECT count(*)::int FROM football_career c JOIN football_entity t ON t.id=c.team_id
      WHERE NOT (c.verified AND c.appeared) AND t.id=ANY($1::text[])) AS pending_candidates`,[[...clubIds]]);
  const metrics = {...counts.rows[0],playableClubs:usedClubs.size,playablePlayers:players.size,playablePairs:pairs.size};
  const report = { generatedAt:new Date().toISOString(),scope:'Local staging Top 100 A clubs',
    note:'Pending means not yet checked against an independent senior match source. P54 is only a lead.',
    metrics,
    items:items.map(item=>({ careerId:item.career_id,player:item.player_name,playerId:item.player_id,birthDate:item.birth_date,
      club:item.team_name,clubId:item.team_id,level:item.team_level,p54Url:item.candidate_url,
      status:item.status,reason:item.reason,revision:item.revision,newPairsIfApproved:item.newPairsIfApproved,
      possiblePairs:item.possiblePairs,priority:item.priority })) };
  await atomicJson('.local/football-review-queue.json',report);
  console.log(JSON.stringify({items:items.length,metrics,output:'.local/football-review-queue.json',
    top:report.items.slice(0,25).map(item=>({player:item.player,club:item.club,id:item.careerId,
      newPairs:item.newPairsIfApproved,possiblePairs:item.possiblePairs}))},null,2));
} finally { await pool.end(); }
