import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MatchService} from '../src/server/game/service.ts';
import {Matchmaking} from '../src/server/matchmaking.ts';
test('reactions enforce per-player cooldown and burst window without advancing game time',async t=>{
  let now=100000; t.mock.method(Date,'now',()=>now);
  const service=new MatchService(async()=>({version:'reactions',selectionIds:new Set(['x','y']),playerIds:new Set(['p']),links:new Map([['p',new Set(['x','y'])]])}),()=>now);
  const matchmaking=new Matchmaking(service);let matchId='',received=0;
  matchmaking.register('a',{notify:(event,data)=>{if(event==='matchFound')matchId=(data as {matchId:string}).matchId;}});
  matchmaking.register('b',{notify:event=>{if(event==='matchReaction')received++;}});
  await matchmaking.enqueue('a');await matchmaking.enqueue('b');
  const view=(await matchmaking.transact('a',matchId)).view;
  for(let i=0;i<4;i++){matchmaking.react('a',matchId,'gg');assert.throws(()=>matchmaking.react('a',matchId,'gg'),/bekle/);now+=1501;}
  assert.equal(received,4);assert.throws(()=>matchmaking.react('a',matchId,'gg'),/bekle/);
  now=110001;matchmaking.react('a',matchId,'clap');assert.equal(received,5);
  assert.throws(()=>matchmaking.react('stranger',matchId,'clap'),/erişim/);assert.throws(()=>matchmaking.react('b',matchId,'__proto__'),/Geçersiz/);
  const after=(await matchmaking.transact('a',matchId)).view;assert.equal(after.deadline,view.deadline);assert.deepEqual(after.score,view.score);
  await matchmaking.dequeue('a');assert.throws(()=>matchmaking.react('b',matchId,'gg'),/erişim/);
});
