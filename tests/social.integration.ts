import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { Pool } from 'pg';
import { io, type Socket } from 'socket.io-client';
import { SocialRepository } from '../src/server/social/repository.ts';
import { CompetitiveRepository } from '../src/server/competitive/repository.ts';
import { createSocketServer } from '../src/server/socketServer.ts';
import { Matchmaking } from '../src/server/matchmaking.ts';
import { MatchService } from '../src/server/game/service.ts';
function socketOnce(socket:Socket,event:string):Promise<[{matchId:string;kind:string;seat:number;resumeToken:string;opponentAccountId:string}]>{return new Promise(resolve=>socket.once(event,data=>resolve([data])));}
import { TERMS_VERSION } from '../src/lib/legal.ts';
test('real PostgreSQL social relationships, invitations, private sockets and isolated friendly results', {timeout:45000}, async t=>{
  const connection=process.env.TEST_DATABASE_URL;assert.ok(connection);
  const target=new URL(connection);assert.ok(['127.0.0.1','localhost'].includes(target.hostname)&&target.pathname==='/golvia_account_test','Use isolated local test DB only');
  const admin=new Pool({connectionString:connection});const schema=`social_test_${randomUUID().replaceAll('-','')}`;
  const users=Array.from({length:4},()=>randomUUID());const [a,b,c,d]=users;
  let pool:Pool|undefined;let server:ReturnType<typeof createSocketServer>|undefined;const sockets:Socket[]=[];
  try{
    await admin.query(await readFile(new URL('../src/server/auth/schema.sql',import.meta.url),'utf8'));
    await admin.query(`CREATE SCHEMA ${schema}`);pool=new Pool({connectionString:connection,options:`-c search_path=${schema},public`,max:10});
    for(const name of ['competitive','social','social'])await pool.query(await readFile(new URL(`../src/server/${name}/schema.sql`,import.meta.url),'utf8'));
    for(const [i,id]of users.entries())await admin.query('INSERT INTO golvia_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt","termsVersion","termsAcceptedAt") VALUES($1,$2,$3,true,now(),now(),$4,now())',[id,`Synthetic Friend ${i}`,`${id}@example.invalid`,TERMS_VERSION]);
    const repo=new SocialRepository(pool),competitive=new CompetitiveRepository(pool);
    const reset=async()=>{await pool!.query('DELETE FROM social_notification');await pool!.query('DELETE FROM social_invite');await pool!.query('DELETE FROM social_block');await pool!.query('DELETE FROM social_friendship');};
    const befriend=async(x:string,y:string)=>{await repo.change(x,'request',y);await repo.change(y,'accept',x);};
    await t.test('self/duplicate/crossed requests serialize, acceptance is symmetric and profiles exclude private data',async()=>{
      await assert.rejects(repo.change(a,'request',a));
      const results=await Promise.allSettled([repo.change(a,'request',b),repo.change(b,'request',a)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
      const relation=(await pool!.query('SELECT * FROM social_friendship')).rows[0];const recipient=relation.requester===a?b:a;
      await assert.rejects(repo.change(relation.requester,'accept',recipient));await repo.change(recipient,'accept',relation.requester);
      assert.equal((await repo.state(a)).people[0].status,'accepted');assert.equal((await repo.state(b)).people[0].status,'accepted');
      const profile=await repo.publicProfile(a,b);assert.equal(profile.email,undefined);assert.equal(profile.password,undefined);
      const own=await repo.export(a);assert.equal(own.friendships.length,1);assert.equal((await repo.export(c)).friendships.length,0);assert.ok(!JSON.stringify(own).includes('@example.invalid'));
      assert.equal((await repo.search(a,'Synthetic Friend')).length,3);assert.equal((await repo.search(a,"%' OR true --")).length,0);
      await assert.rejects(repo.search(a,'x'));await assert.rejects(repo.publicProfile(c,b));
      assert.equal((await pool!.query("SELECT count(*)::int n FROM social_notification WHERE kind='friend-accepted'")).rows[0].n,1);
    });
    await t.test('request reject/cancel/remove and two-way blocks preserve authorization',async()=>{
      await repo.change(c,'request',d);await repo.change(d,'reject',c);assert.equal((await repo.state(c)).people.length,0);
      await pool!.query("UPDATE social_friendship SET updated_at=now()-interval '61 seconds'");await repo.change(c,'request',d);await repo.change(c,'cancel',d);
      await repo.change(a,'block',b);await assert.rejects(repo.change(b,'request',a));await assert.rejects(repo.change(a,'invite',b));assert.equal((await repo.state(a)).people.length,0);assert.equal((await repo.search(b,'Synthetic Friend 0')).length,0);
      await repo.change(b,'block',a);await admin.query('UPDATE golvia_auth."user" SET status=\'suspended\' WHERE id=$1',[b]);await repo.change(a,'unblock',b);await admin.query('UPDATE golvia_auth."user" SET status=\'active\' WHERE id=$1',[b]);await assert.rejects(repo.change(a,'request',b));await repo.change(b,'unblock',a);
      await reset();await befriend(a,b);await repo.change(a,'remove',b);assert.equal((await repo.state(b)).people.length,0);
    });
    await t.test('invite roles, rejection/cancel/expiry, simultaneous acceptance and notification replay',async()=>{
      await reset();await befriend(a,b);await befriend(b,c);
      let id=(await repo.change(a,'invite',b)).inviteId!;
      await assert.rejects(repo.change(a,'invite',b));await assert.rejects(repo.change(a,'invite-accept',id));await assert.rejects(repo.change(c,'invite-accept',id));
      await repo.change(b,'invite-reject',id);assert.equal((await pool!.query('SELECT status FROM social_invite WHERE id=$1',[id])).rows[0].status,'rejected');
      id=(await repo.change(a,'invite',b)).inviteId!;await repo.change(a,'invite-cancel',id);await assert.rejects(repo.change(b,'invite-accept',id));
      id=(await repo.change(a,'invite',b)).inviteId!;await pool!.query("UPDATE social_invite SET expires_at=now()-interval '1 second' WHERE id=$1",[id]);await assert.rejects(repo.change(b,'invite-accept',id));await repo.expire();assert.equal((await pool!.query('SELECT status FROM social_invite WHERE id=$1',[id])).rows[0].status,'expired');
      id=(await repo.change(a,'invite',b)).inviteId!;const other=(await repo.change(c,'invite',b)).inviteId!;
      const accepted=await Promise.allSettled([repo.change(b,'invite-accept',id),repo.change(b,'invite-accept',other)]);assert.equal(accepted.filter(x=>x.status==='fulfilled').length,1);
      const acceptedId=(await pool!.query("SELECT id FROM social_invite WHERE status='accepted'")).rows[0].id;
      await repo.change(b,'invite-accept',acceptedId);assert.equal((await pool!.query("SELECT count(*)::int n FROM social_notification WHERE kind='invite-accepted'")).rows[0].n,1);
      await repo.read(a);assert.ok((await repo.state(a)).notifications.every(row=>row.seen));
    });
    for(const user of [a,b])await pool.query("INSERT INTO competitive_rating(user_id,mode,elo,wins,losses,draws) VALUES($1,'3-2-1',1200,3,2,1)",[user]);
    const initialRatings=(await pool.query('SELECT * FROM competitive_rating ORDER BY user_id')).rows;
    let clock=Date.now();const service=new MatchService(async()=>({version:'social-synthetic',selectionIds:new Set(['x','y']),playerIds:new Set(['p']),links:new Map([['p',new Set(['x','y'])]])}),()=>clock);
    server=createSocketServer(service,async()=>true,async cookie=>{const index=users.findIndex(id=>cookie===`test=${id}`);return index<0?null:{id:users[index],name:`Synthetic Friend ${index}`};},{},undefined,competitive,repo);
    server.httpServer.listen(0,'127.0.0.1');await once(server.httpServer,'listening');const address=server.httpServer.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
    async function connect(user:string,ns='',resumeToken?:string){const socket=io(`${base}${ns}`,{autoConnect:false,forceNew:true,transports:['websocket'],reconnection:false,extraHeaders:{cookie:`test=${user}`},auth:resumeToken?{resumeToken}:{}});sockets.push(socket);const event=socketOnce(socket,ns?'connect':'session');const matched=ns?null:socketOnce(socket,'matchFound');socket.connect();const result=await event;return {socket,session:result[0],matched};}
    const call=(socket:Socket,action:string,extra:object={})=>socket.timeout(3000).emitWithAck('social',{action,...extra});
    await t.test('social sockets require server identity, scope presence to friends, and retain multi-tab presence',async()=>{
      await reset();await befriend(a,b);
      const stranger=io(`${base}/social`,{transports:['websocket'],reconnection:false,autoConnect:false,auth:{userId:a}});sockets.push(stranger);const rejected=socketOnce(stranger,'connect_error');stranger.connect();await rejected;
      const sa=(await connect(a,'/social')).socket,sb=(await connect(b,'/social')).socket,sb2=(await connect(b,'/social')).socket;
      assert.equal((await call(sa,'state')).data.people[0].presence,'online');sb.disconnect();await new Promise(resolve=>setTimeout(resolve,30));assert.equal((await call(sa,'state')).data.people[0].presence,'online');sb2.disconnect();await new Promise(resolve=>setTimeout(resolve,30));assert.equal((await call(sa,'state')).data.people[0].presence,'offline');
      const sc=(await connect(c,'/social')).socket;assert.equal((await call(sc,'state')).data.people.length,0);
      assert.equal((await call(sc,'state',{userId:a})).status,400);assert.equal((await call(sc,'profile',{target:b})).status,403);
      assert.equal((await call(sa,'invite',{target:b})).status,409);
    });
    await t.test('accepted invite starts one real private 1v1, survives reconnect, and never writes ranked ratings',async()=>{
      for(const socket of sockets)socket.disconnect();await new Promise(resolve=>setTimeout(resolve,30));await reset();await befriend(a,b);
      const sa=(await connect(a,'/social')).socket,sb=(await connect(b,'/social')).socket;
      const invite=await call(sa,'invite',{target:b});assert.equal(invite.status,200);const id=invite.data.inviteId;
      assert.equal((await call(sb,'invite-accept',{target:id})).status,200);
      assert.equal((await call(sb,'invite-accept',{target:id})).status,200);
      let ga=await connect(a);const gb=await connect(b);const foundA=socketOnce(ga.socket,'matchFound'),foundB=socketOnce(gb.socket,'matchFound');
      assert.equal((await ga.socket.timeout(3000).emitWithAck('quickMatch',{kind:'ranked'})).status,409);
      assert.equal((await ga.socket.timeout(3000).emitWithAck('joinFriendMatch',{inviteId:id,userId:b})).status,400);
      assert.equal((await ga.socket.timeout(3000).emitWithAck('joinFriendMatch',{inviteId:id})).status,200);
      assert.equal((await gb.socket.timeout(3000).emitWithAck('joinFriendMatch',{inviteId:id})).status,200);
      const [ma]=await foundA,[mb]=await foundB;assert.equal(ma.matchId,mb.matchId);assert.equal(ma.kind,'friendly');assert.equal(ma.opponentAccountId,b);assert.equal(mb.opponentAccountId,a);
      assert.equal((await pool!.query('SELECT count(*)::int n FROM social_match')).rows[0].n,1);
      assert.equal((await ga.socket.timeout(3000).emitWithAck('joinFriendMatch',{inviteId:id})).status,409);
      const intruder=await connect(a);assert.equal((await intruder.socket.timeout(3000).emitWithAck('quickMatch',{kind:'ranked'})).status,409);intruder.socket.disconnect();
      assert.equal((await call(sa,'state')).data.people[0].presence,'in-match');
      ga.socket.disconnect();ga=await connect(a,'',ga.session.resumeToken);const restored=await ga.matched!;assert.equal(restored[0].matchId,ma.matchId);
      const get=()=>ga.socket.timeout(3000).emitWithAck('getState',{matchId:ma.matchId});
      const act=(socket:Socket,type:string,choice:string,view:{round:number;attempt:number})=>socket.timeout(3000).emitWithAck('playerAction',{matchId:ma.matchId,action:{requestId:randomUUID(),round:view.round,attempt:view.attempt,type,id:choice}});
      let snapshot=(await get()).view;
      for(let round=0;round<3;round++){
        if(snapshot.phase==='result'){clock=snapshot.deadline+1;snapshot=(await get()).view;}
        assert.equal(snapshot.phase,'ready');await act(ga.socket,'ready','ready',snapshot);await act(gb.socket,'ready','ready',snapshot);
        snapshot=(await get()).view;clock=snapshot.deadline+1;snapshot=(await get()).view;
        await act(ga.socket,'choose','x',snapshot);await act(gb.socket,'choose','y',snapshot);
        snapshot=(await get()).view;clock=snapshot.deadline+1;snapshot=(await get()).view;clock=snapshot.deadline+1;snapshot=(await get()).view;
        const result=await act(ga.socket,'answer','p',snapshot);assert.equal(result.status,200);snapshot=result.view;
      }
      assert.equal(snapshot.phase,'finished');assert.equal(snapshot.score[ma.seat],3);
      assert.equal((await pool!.query('SELECT count(*)::int n FROM competitive_rating')).rows[0].n,2);assert.equal((await pool!.query('SELECT count(*)::int n FROM competitive_match')).rows[0].n,0);
      const repeats=await Promise.all(Array.from({length:12},()=>repo.complete(ma.matchId,[3,0],0,clock)));assert.ok(repeats.every(row=>row.status==='completed'));
      await assert.rejects(repo.cancel(ma.matchId,'cancelled'),/Tamamlanmış/);
      await assert.rejects(repo.complete(ma.matchId,[0,3],1,clock),/çakışıyor/);
      assert.deepEqual((await pool!.query('SELECT * FROM competitive_rating ORDER BY user_id')).rows,initialRatings);
      const history=await repo.history(a);assert.equal(history.items[0].status,'completed');assert.equal(history.items[0].winner,ma.seat);assert.equal((await repo.history(c)).items.length,0);
      assert.equal((await ga.socket.timeout(3000).emitWithAck('quitQueue',{})).status,200);
      assert.equal((await gb.socket.timeout(3000).emitWithAck('quitQueue',{})).status,200);
      const repeat=await call(sa,'invite',{target:b});assert.equal(repeat.status,200);assert.notEqual(repeat.data.inviteId,id);
      await repo.change(b,'block',a);await assert.rejects(repo.invitation(a,repeat.data.inviteId));
    });
    await t.test('friendly disconnect timeout persists one forfeit with no ELO and two absent players have no winner',async()=>{
      await reset();await befriend(a,b);
      const matching=new Matchmaking(service,competitive,repo);
      for(let round=0;round<2;round++){
        const invitation=(await repo.change(a,'invite',b)).inviteId!;await repo.change(b,'invite-accept',invitation);
        matching.register('friend-a',{accountId:a,notify:()=>{}});matching.register('friend-b',{accountId:b,notify:()=>{}});
        const id=await matching.pairFriends(['friend-a','friend-b'],(id,users,at)=>repo.startFriend(id,invitation,users,at));
        const ready={type:'ready' as const,id:'ready',round:1,attempt:1,requestId:randomUUID()};
        await matching.transact('friend-a',id,ready);await matching.transact('friend-b',id,ready);
        matching.handleDisconnect('friend-a',5);matching.handleDisconnect('friend-a',5);
        if(round===1)matching.handleDisconnect('friend-b',5);
        for(let i=0;i<25;i++){if((await pool!.query('SELECT status FROM social_match WHERE id=$1',[id])).rows[0].status!=='active')break;await new Promise(resolve=>setTimeout(resolve,10));}
        const saved=(await pool!.query('SELECT status,winner,reason FROM social_match WHERE id=$1',[id])).rows[0];
        assert.equal(saved.status,round===0?'completed':'cancelled');assert.equal(saved.winner,round===0?1:null);
        assert.equal((await pool!.query('SELECT count(*)::int n FROM competitive_rating')).rows[0].n,2);
      }
    });
    await t.test('accepted invitation cancellation releases reservations and closes the waiting arena',async()=>{
      await reset();await befriend(a,b);
      const sa=(await connect(a,'/social')).socket,sb=(await connect(b,'/social')).socket;
      const id=(await call(sa,'invite',{target:b})).data.inviteId;
      assert.equal((await call(sb,'invite-accept',{target:id})).status,200);
      const ga=await connect(a);assert.equal((await ga.socket.timeout(3000).emitWithAck('joinFriendMatch',{inviteId:id})).status,200);
      const closed=socketOnce(ga.socket,'matchCancelled');assert.equal((await call(sa,'invite-cancel',{target:id})).status,200);await closed;
      assert.equal(server!.matchmaking.busy(a),false);assert.equal(server!.matchmaking.busy(b),false);
      assert.equal((await ga.socket.timeout(3000).emitWithAck('joinFriendMatch',{inviteId:id})).status,409);
      const next=(await call(sa,'invite',{target:b})).data.inviteId;await call(sb,'invite-accept',{target:next});
      const other=await connect(c);await other.socket.timeout(3000).emitWithAck('quitQueue',{inviteId:next});assert.equal(server!.matchmaking.busy(a),true);other.socket.disconnect();
      await ga.socket.timeout(3000).emitWithAck('quitQueue',{inviteId:next});assert.equal(server!.matchmaking.busy(a),false);
      assert.equal((await pool!.query('SELECT status FROM social_invite WHERE id=$1',[next])).rows[0].status,'cancelled');
      sa.disconnect();sb.disconnect();ga.socket.disconnect();
    });
    await t.test('social rate limits apply per account across actions and reject forged actors',async()=>{
      const socket=(await connect(d,'/social')).socket;
      assert.equal((await call(socket,'request',{target:a,userId:b})).status,400);
      let last;for(let i=0;i<36;i++)last=await call(socket,'search',{query:'Synthetic Friend'});assert.equal(last.status,429);
    });
    await t.test('account deletion cascades social data; restart cancels unrecoverable games without false results',async()=>{
      await reset();await befriend(a,b);
      const invitation=(await repo.change(a,'invite',b)).inviteId!;await repo.change(b,'invite-accept',invitation);
      await repo.startFriend('unrecoverable',invitation,[a,b],clock);await repo.recover();
      const recovered=(await pool!.query("SELECT status,winner,reason FROM social_match WHERE id='unrecoverable'")).rows[0];
      assert.equal(recovered.status,'cancelled');assert.equal(recovered.winner,null);assert.equal(recovered.reason,'server-restart');
      await admin.query('DELETE FROM golvia_auth."user" WHERE id=$1',[b]);
      assert.equal((await pool!.query('SELECT count(*)::int n FROM social_friendship WHERE user_a=$1 OR user_b=$1',[b])).rows[0].n,0);
      assert.equal((await pool!.query('SELECT count(*)::int n FROM social_invite WHERE sender=$1 OR recipient=$1',[b])).rows[0].n,0);
      assert.equal((await pool!.query('SELECT count(*)::int n FROM social_notification WHERE actor=$1 OR recipient=$1',[b])).rows[0].n,0);
      assert.ok((await repo.history(a)).items.every(row=>row.opponent==='Silinmiş oyuncu'));
    });
  }finally{for(const socket of sockets)socket.disconnect();if(server)await new Promise<void>(resolve=>server!.io.close(()=>resolve()));await pool?.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.query('DELETE FROM golvia_auth."user" WHERE id=ANY($1::text[])',[users]);await admin.end();}
});
