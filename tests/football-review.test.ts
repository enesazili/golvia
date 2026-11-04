import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedObservations } from '../src/server/football/match-feed.ts';
import { reviewActor, reviewAuthorized, reviewAvailable, reviewRateLimited } from '../src/server/football/review-access.ts';
import { reviewPriority, validateObservation } from '../src/server/football/review.ts';

const identity = { playerName:'Same Name',birthDate:'1994-10-24',teamName:'PSV Eindhoven',aliases:[],teamAliases:['PSV'],teamLevel:'senior' };
const observation = { matchUrl:'https://www.psv.nl/match/123',identityUrl:'https://www.psv.nl/player/abc',
  matchId:'psv-2024-123',matchDate:'2024-05-01',competition:'Eredivisie',playerName:'Same Name',birthDate:'1994-10-24',
  teamName:'PSV Eindhoven',teamLevel:'senior',matchStatus:'final',event:'minutes-played',minutesPlayed:20,
  sourceNote:'Resmî maç sayfasında oyuncunun 20 dakika oynadığı ve maçın tamamlandığı insan tarafından kontrol edildi.',
  identityNote:'Kulübün resmî oyuncu profili doğum tarihini ve tam adı eşleştirerek kimliği bağımsız doğruluyor.',
  reviewerChecked:true };

test('structured observation requires independent identity, final senior match and a positive event', () => {
  assert.doesNotThrow(() => validateObservation(observation,identity));
  assert.throws(() => validateObservation({ ...observation,minutesPlayed:0 },identity),/Sahaya/);
  assert.throws(() => validateObservation({ ...observation,birthDate:'1995-10-24' },identity),/Oyuncu/);
  assert.throws(() => validateObservation({ ...observation,teamName:'PSV II' },identity),/A takım/);
  assert.throws(() => validateObservation({ ...observation,competition:'Friendly' },identity),/maç kimliği/);
  assert.throws(() => validateObservation({ ...observation,reviewerChecked:false },identity),/insan kontrolü/);
  assert.throws(() => validateObservation({ ...observation,matchUrl:'https://example.com/match/123' },identity),/Onaylanmamış/);
  assert.throws(() => validateObservation({ ...observation,identityUrl:observation.matchUrl },identity),/farklı/);
  assert.throws(() => validateObservation({ ...observation,sourceNote:'' },identity),/notu/);
  assert.throws(() => validateObservation({ ...observation,identityNote:'kısa' },identity),/notu/);
  assert.doesNotThrow(() => validateObservation({ ...observation,sourceNote:undefined,identityNote:undefined },identity,{ allowLegacyNotes:true }));
  assert.doesNotThrow(() => validateObservation({ ...observation,identityUrl:'https://www.psv.nl/player/other' },identity));
});

test('priority favors new playable pairs, then potential pairs and catalog rank', () => {
  const rows = [{careerId:'a',playerId:'p',teamId:'B',rank:50,status:'pending'},
    {careerId:'b',playerId:'q',teamId:'C',rank:1,status:'pending'},
    {careerId:'c',playerId:'q',teamId:'D',rank:2,status:'pending'}];
  const ranked = reviewPriority(rows,[{playerId:'p',teamId:'A'}]);
  assert.equal(ranked[0].careerId,'a'); assert.equal(ranked[0].newPairsIfApproved,1);
  assert.equal(ranked.find(x=>x.careerId==='b')?.possiblePairs,1);
});

test('licensed feed adapter requires exact provider IDs and positive senior minutes but never attests review', () => {
  const feed = { provider:'licensed-test',rightsUrl:'https://provider.example/rights',redistributionAllowed:true,checkedAt:'2026-11-04',
    matches:[{id:'m1',url:'https://www.psv.nl/match/123',date:'2024-05-01',competition:'Eredivisie',status:'final' as const,
      team:{externalId:'team-1',name:'PSV Eindhoven',level:'senior' as const},
      players:[{externalId:'player-1',name:'Same Name',birthDate:'1994-10-24',minutesPlayed:20}]}] };
  const map = [{playerId:'Q1',teamId:'Q2',externalPlayerId:'player-1',externalTeamId:'team-1',identityUrl:'https://www.psv.nl/player/abc'}];
  assert.throws(() => feedObservations(feed,map,new Set()),/rights/);
  const found = feedObservations(feed,map,new Set(['licensed-test']));
  assert.equal(found.length,1);assert.equal('reviewerChecked' in found[0].observation,false);
  assert.equal(feedObservations({ ...feed,matches:[{ ...feed.matches[0],team:{...feed.matches[0].team,level:'reserve' as const} }] },map,new Set(['licensed-test'])).length,0);
  assert.equal(feedObservations(feed,[{...map[0],externalPlayerId:'someone-else'}],new Set(['licensed-test'])).length,0);
  assert.equal(feedObservations({...feed,matches:[{...feed.matches[0],status:'scheduled' as const}]},map,new Set(['licensed-test'])).length,0);
  assert.throws(() => feedObservations({...feed,redistributionAllowed:false},map,new Set(['licensed-test'])),/rights/);
});

test('review access is local staging only and requires a long bearer secret', () => {
  assert.equal(reviewAvailable('development','postgresql://u:p@127.0.0.1:55437/golvia_stage'),true);
  assert.equal(reviewAvailable('production','postgresql://u:p@127.0.0.1:55437/golvia_stage'),false);
  assert.equal(reviewAvailable('development','postgresql://u:p@remote.example/golvia_stage'),false);
  const token = 'a'.repeat(64);
  assert.equal(reviewAuthorized(new Request('http://localhost',{headers:{Authorization:`Bearer ${token}`}}),token),true);
  assert.equal(reviewAuthorized(new Request('http://localhost',{headers:{Authorization:`Bearer ${'b'.repeat(64)}`}}),token),false);
  assert.equal(reviewAuthorized(new Request('http://localhost',{headers:{Authorization:'Bearer short'}}),token),false);
  assert.equal(reviewActor(undefined,'  '),'local-reviewer');
  assert.equal(reviewActor('x'.repeat(64),'Reviewer A'),'Reviewer A');
  assert.equal(reviewActor('x'.repeat(64),'bad\nactor').startsWith('local-'),true);
  const now = 1_000_000;
  for (let i = 0; i < 5; i++) assert.equal(reviewRateLimited('key',now,5,1000),false);
  assert.equal(reviewRateLimited('key',now,5,1000),true);
  assert.equal(reviewRateLimited('key',now+1001,5,1000),false);
});
