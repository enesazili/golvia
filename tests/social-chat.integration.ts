import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
function socketOnce(socket:Socket,event:string):Promise<Record<string,unknown>[]> {return new Promise(resolve=>socket.once(event,data=>resolve([data])));}
import {Pool} from 'pg';
import {io,type Socket} from 'socket.io-client';
import {SocialRepository} from '../src/server/social/repository.ts';
import {createSocketServer} from '../src/server/socketServer.ts';
import {MatchService} from '../src/server/game/service.ts';
import {TERMS_VERSION} from '../src/lib/legal.ts';

test('persistent friend chat, scoped sockets, post-match rematches and reactions',{timeout:45000},async t=>{
  const connection=process.env.TEST_DATABASE_URL;assert.ok(connection);
  const target=new URL(connection);assert.ok(['localhost','127.0.0.1'].includes(target.hostname)&&target.pathname==='/golvia_account_test','Isolated local DB only');
  const admin=new Pool({connectionString:connection}),schema=`chat_test_${randomUUID().replaceAll('-','')}`,users=Array.from({length:4},()=>randomUUID());
  const [a,b,c,d]=users;let pool:Pool|undefined,server:ReturnType<typeof createSocketServer>|undefined;const sockets:Socket[]=[];
  try{
    await admin.query(await readFile(new URL('../src/server/auth/schema.sql',import.meta.url),'utf8'));await admin.query(`CREATE SCHEMA ${schema}`);
    pool=new Pool({connectionString:connection,options:`-c search_path=${schema},public`});
    for(const name of ['competitive','social','social'])await pool.query(await readFile(new URL(`../src/server/${name}/schema.sql`,import.meta.url),'utf8'));
    for(const [i,id]of users.entries())await admin.query('INSERT INTO golvia_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt","termsVersion","termsAcceptedAt") VALUES($1,$2,$3,true,now(),now(),$4,now())',[id,`Chat ${i}`,`${id}@example.invalid`,TERMS_VERSION]);
    const repo=new SocialRepository(pool),befriend=async(x:string,y:string)=>{await repo.change(x,'request',y);await repo.change(y,'accept',x);};
    await befriend(a,b);await befriend(a,c);
    await t.test('only accepted friends can send, read, type or delete; messages are validated',async()=>{
      for(const action of [()=>repo.chat.send(a,d,'hello','bad'),()=>repo.chat.history(d,a),()=>repo.chat.typing(d,a),()=>repo.chat.remove(d,a,'1'),()=>repo.chat.read(d,a,'1')])await assert.rejects(action);
      for(const text of ['', ' '.repeat(30),'x'.repeat(501),'a\u0000b'])await assert.rejects(repo.chat.send(a,b,text,randomUUID()));
      await assert.rejects(repo.chat.history(a,b,'-1'));await assert.rejects(repo.chat.read(a,b,'9999999999999999999'));
      const unicode=await repo.chat.send(a,b,' 😀 '.repeat(100),randomUUID());assert.equal(unicode.body?.trim(),unicode.body);
      const html=await repo.chat.send(a,b,'<script>alert(1)</script>',randomUUID());assert.equal(html.body,'<script>alert(1)</script>');
      await admin.query('UPDATE golvia_auth."user" SET status=\'suspended\' WHERE id=$1',[b]);await assert.rejects(repo.chat.send(a,b,'no',randomUUID()));await admin.query('UPDATE golvia_auth."user" SET status=\'active\' WHERE id=$1',[b]);
    });
    await t.test('concurrent retries persist once; deletion is sender-only, idempotent and cannot resurrect',async()=>{
      const nonce=randomUUID(),messages=await Promise.all(Array.from({length:8},()=>repo.chat.send(a,b,'single',nonce)));
      assert.ok(messages.every(message=>message.id===messages[0].id));assert.equal((await pool!.query('SELECT count(*)::int n FROM social_message WHERE request_id=$1',[nonce])).rows[0].n,1);
      await assert.rejects(repo.chat.send(a,b,'different',nonce));await assert.rejects(repo.chat.send(a,c,'single',nonce));
      await assert.rejects(repo.chat.remove(b,a,messages[0].id));await assert.rejects(repo.chat.remove(c,a,messages[0].id));
      const removed=await repo.chat.remove(a,b,messages[0].id);assert.equal(removed.body,null);assert.ok(removed.deleted_at);assert.equal((await repo.chat.remove(a,b,removed.id)).body,null);
      assert.equal((await repo.chat.send(a,b,'single',nonce)).body,null);
    });
    await t.test('history uses stable cursors, unread is per recipient and read cursor never moves backwards',async()=>{
      for(let i=0;i<33;i++)await repo.chat.send(a,b,`page ${i}`,randomUUID());
      const latest=await repo.chat.history(b,a);assert.equal(latest.messages.length,30);assert.ok(latest.hasMore);
      const older=await repo.chat.history(b,a,latest.messages[0].id);assert.equal(older.hasMore,false);
      const all=[...older.messages,...latest.messages];assert.equal(new Set(all.map(m=>m.id)).size,all.length);assert.equal(all.length,36);
      const summary=() =>repo.chat.summaries(b).then(rows=>rows.find(row=>row.peer_id===a)!);
      assert.equal((await summary()).unread,35);await repo.chat.read(b,a,latest.messages.at(-1)!.id);assert.equal((await summary()).unread,0);
      await repo.chat.read(b,a,older.messages[0].id);assert.equal((await summary()).unread,0);
      await repo.chat.send(a,b,'new',randomUUID());assert.equal((await summary()).unread,1);assert.equal((await repo.chat.summaries(a)).find(row=>row.peer_id===b)!.unread,0);
      assert.equal((await repo.export(a)).messages.length,37);assert.equal((await repo.export(d)).messages.length,0);
    });
    await t.test('block and removal revoke old history and typing; block/send races serialize safely',async()=>{
      await repo.change(c,'block',a);
      for(const action of [()=>repo.chat.send(a,c,'blocked',randomUUID()),()=>repo.chat.history(a,c),()=>repo.chat.read(c,a,'1'),()=>repo.chat.typing(c,a)])await assert.rejects(action);
      assert.ok(!(await repo.chat.summaries(a)).some(row=>row.peer_id===c));
      await repo.change(c,'unblock',a);await pool!.query("UPDATE social_friendship SET updated_at=now()-interval '61 seconds'");await befriend(a,c);
      await Promise.allSettled([repo.chat.send(a,c,'racing',randomUUID()),repo.change(c,'block',a)]);await assert.rejects(repo.chat.send(a,c,'after',randomUUID()));
      await repo.change(a,'remove',b);await assert.rejects(repo.chat.history(a,b));await pool!.query("UPDATE social_friendship SET updated_at=now()-interval '61 seconds'");await befriend(a,b);
    });
    await t.test('recent opponents are own, unique, completed, active and unblocked; rematch is participant-scoped',async()=>{
      for(const [id,other,ended]of [['source',b,'now()'],['old',b,"now()-interval '1 day'"],['hidden',c,'now()']])await pool!.query(`INSERT INTO social_match(id,user0,user1,status,started_at,ended_at,score0,score1,winner,reason) VALUES($1,$2,$3,'completed',now()-interval '2 days',${ended},3,1,0,'finished')`,[id,a,other]);
      const recent=await repo.recent(a);assert.equal(recent.length,1);assert.equal(recent[0].id,b);assert.equal(recent[0].match_id,'source');assert.equal((await repo.recent(d)).length,0);
      await pool!.query("INSERT INTO competitive_match(id,mode,status,started_at,ended_at,score0,score1,winner,reason) VALUES('rank-source','3-2-1','completed',now()-interval '1 minute',now(),3,0,0,'finished')");
      await pool!.query("INSERT INTO competitive_participant(match_id,seat,user_id,active) VALUES('rank-source',0,$1,false),('rank-source',1,$2,false)",[d,b]);
      assert.equal((await repo.recent(d))[0].id,b);assert.equal(await repo.rematchTarget(d,'rank-source'),b);await assert.rejects(repo.rematchTarget(a,'rank-source'));
      await pool!.query("DELETE FROM competitive_participant WHERE match_id='rank-source'");await pool!.query("DELETE FROM competitive_match WHERE id='rank-source'");
      await assert.rejects(repo.change(d,'rematch','source'));await assert.rejects(repo.change(a,'rematch','old'));
      await repo.change(a,'remove',b);await assert.rejects(repo.chat.history(a,b));
      const id=(await repo.change(a,'rematch','source')).inviteId!;assert.equal((await repo.state(b)).invites[0].kind,'rematch');
      await repo.change(b,'invite-accept',id);await repo.change(b,'invite-accept',id);await assert.rejects(repo.change(d,'invite-accept',id));
      await repo.startFriend('rematch-result',id,[a,b],Date.now());await repo.complete('rematch-result',[3,1],0,Date.now());
      assert.equal((await pool!.query('SELECT count(*)::int n FROM competitive_rating')).rows[0].n,0);assert.equal((await pool!.query('SELECT count(*)::int n FROM competitive_match')).rows[0].n,0);
      await repo.change(b,'block',a);await assert.rejects(repo.change(a,'rematch','source'));await repo.change(b,'unblock',a);await pool!.query("UPDATE social_friendship SET updated_at=now()-interval '61 seconds'");await befriend(a,b);
    });
    const service=new MatchService(async()=>({version:'chat-synthetic',selectionIds:new Set(['x','y']),playerIds:new Set(['p']),links:new Map([['p',new Set(['x','y'])]])}));
    server=createSocketServer(service,async()=>true,async cookie=>{const id=users.find(user=>cookie===`test=${user}`);return id?{id,name:'Chat player'}:null;},{},undefined,undefined,repo);
    server.httpServer.listen(0,'127.0.0.1');await once(server.httpServer,'listening');const address=server.httpServer.address();assert.ok(address&&typeof address!=='string');
    async function connect(user:string,ns='/social') {const socket=io(`http://127.0.0.1:${typeof address==='object'&&address?.port}${ns}`,{autoConnect:false,forceNew:true,transports:['websocket'],reconnection:false,extraHeaders:{cookie:`test=${user}`}});sockets.push(socket);const ready=socketOnce(socket,ns?'connect':'session');socket.connect();await ready;return socket;}
    const call=(socket:Socket,action:string,extra:object={})=>socket.timeout(3000).emitWithAck('social',{action,...extra});
    await t.test('Socket.IO sends only to recipient and own tabs, authenticates actor, limits messages and typing',async()=>{
      const sa=await connect(a),sb=await connect(b),sd=await connect(d);let leaked=false;sd.on('chatChanged',()=>leaked=true);
      const typing=socketOnce(sb,'chatTyping');assert.equal((await call(sa,'chat-typing',{target:b,typing:true})).status,200);assert.equal((await typing)[0].from,a);
      const changed=socketOnce(sb,'chatChanged');assert.equal((await call(sa,'chat-send',{target:b,text:'live',requestId:randomUUID()})).status,200);assert.equal((await changed)[0].peerId,a);
      assert.equal((await call(sd,'chat-history',{target:a})).status,403);assert.equal((await call(sd,'chat-send',{target:b,text:'forged',requestId:randomUUID(),userId:a})).status,400);
      for(let i=0;i<7;i++)assert.equal((await call(sa,'chat-send',{target:b,text:'rate',requestId:randomUUID()})).status,200);
      assert.equal((await call(sa,'chat-send',{target:b,text:'limited',requestId:randomUUID()})).status,429);
      for(let i=0;i<5;i++)assert.equal((await call(sa,'chat-typing',{target:b,typing:true})).status,200);assert.equal((await call(sa,'chat-typing',{target:b,typing:true})).status,429);assert.equal(leaked,false);
      const own=await repo.chat.send(b,a,'delete-live',randomUUID()),removed=socketOnce(sa,'chatChanged');assert.equal((await call(sb,'chat-delete',{target:a,messageId:own.id})).status,200);assert.equal(((await removed)[0].message as {body:string|null}).body,null);
      sa.disconnect();sb.disconnect();sd.disconnect();
    });
    await t.test('emoji recipients are match-scoped, spam/invalid payloads rejected and game view/timer untouched',async()=>{
      const id=(await repo.change(a,'invite',b)).inviteId!;await repo.change(b,'invite-accept',id);
      const ga=await connect(a,''),gb=await connect(b,''),outsider=await connect(d,'');const found=socketOnce(ga,'matchFound');
      await ga.timeout(3000).emitWithAck('joinFriendMatch',{inviteId:id});await gb.timeout(3000).emitWithAck('joinFriendMatch',{inviteId:id});const matchId=(await found)[0].matchId;
      const before=await ga.timeout(3000).emitWithAck('getState',{matchId}),event=socketOnce(gb,'matchReaction');
      assert.equal((await ga.timeout(3000).emitWithAck('matchReaction',{matchId,emoji:'gg'})).status,200);assert.equal((await event)[0].emoji,'gg');
      assert.equal((await ga.timeout(3000).emitWithAck('matchReaction',{matchId,emoji:'gg'})).status,429);
      assert.equal((await gb.timeout(3000).emitWithAck('matchReaction',{matchId,emoji:'bad'})).status,400);
      assert.equal((await outsider.timeout(3000).emitWithAck('matchReaction',{matchId,emoji:'gg'})).status,403);
      assert.equal((await gb.timeout(3000).emitWithAck('matchReaction',{matchId,emoji:'gg',playerId:'forged'})).status,400);
      const after=await ga.timeout(3000).emitWithAck('getState',{matchId});assert.equal(after.view.deadline,before.view.deadline);assert.equal(after.view.revision,before.view.revision);assert.deepEqual(after.view.score,before.view.score);
      await ga.timeout(3000).emitWithAck('quitQueue',{});assert.equal((await gb.timeout(3000).emitWithAck('matchReaction',{matchId,emoji:'clap'})).status,403);
    });
    await t.test('account deletion cascades private messages and read state; recent excludes deleted users',async()=>{
      await admin.query('DELETE FROM golvia_auth."user" WHERE id=$1',[b]);
      assert.equal((await pool!.query('SELECT count(*)::int n FROM social_message WHERE sender=$1 OR recipient=$1',[b])).rows[0].n,0);
      assert.equal((await pool!.query('SELECT count(*)::int n FROM social_chat_read WHERE user_id=$1 OR peer_id=$1',[b])).rows[0].n,0);assert.equal((await repo.recent(a)).length,0);
    });
  }finally{for(const socket of sockets)socket.disconnect();if(server)await new Promise<void>(resolve=>server!.io.close(()=>resolve()));await pool?.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.query('DELETE FROM golvia_auth."user" WHERE id=ANY($1::text[])',[users]);await admin.end();}
});
