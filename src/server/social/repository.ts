import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { GAME_MODE, rankProgress, type RankedResult } from '../../lib/rating.ts';
import { SessionError } from '../game/service.ts';
const pair = (a: string, b: string) => [a,b].sort();
export type SocialAction = 'request'|'accept'|'reject'|'cancel'|'remove'|'block'|'unblock'|'invite'|'invite-accept'|'invite-reject'|'invite-cancel';
export class SocialRepository {
  constructor(private readonly pool: Pool, private readonly inviteMs = 120000) {}
  private async users(client: PoolClient, users: string[], inactiveTarget?:string) {
    const rows = await client.query('SELECT id FROM golvia_auth."user" WHERE id=ANY($1::text[]) AND ((status=\'active\' AND "emailVerified") OR id=$2) ORDER BY id COLLATE "C" FOR UPDATE', [users,inactiveTarget??null]);
    if (rows.rowCount !== users.length) throw new SessionError(403, 'Oyuncu kullanılamıyor.');
  }
  private async friends(client: Pick<Pool,'query'>, a: string, b: string) {
    const ids = pair(a,b);
    const result = await client.query(`SELECT 1 FROM social_friendship WHERE user_a=$1 AND user_b=$2 AND status='accepted'
      AND NOT EXISTS(SELECT 1 FROM social_block WHERE (blocker=$1 AND blocked=$2) OR (blocker=$2 AND blocked=$1))`, ids);
    if (!result.rowCount) throw new SessionError(403, 'Arkadaşlık gerekli.');
  }
  private async notice(client: PoolClient, recipient: string, actor: string, kind: string, reference: string) {
    await client.query('INSERT INTO social_notification(recipient,actor,kind,reference) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [recipient,actor,kind,reference]);
  }
  async search(actor: string, term: string) {
    const q = term.normalize('NFKC').trim();
    if (q.length<2 || q.length>40 || /[\p{C}]/u.test(q)) throw new SessionError(400,'2–40 karakter kullan.');
    const result = await this.pool.query(`SELECT u.id,u.name,COALESCE(r.elo,1000) elo FROM golvia_auth."user" u
      LEFT JOIN competitive_rating r ON r.user_id=u.id AND r.mode=$3
      WHERE u.id<>$1 AND u.status='active' AND u."emailVerified" AND u.name ILIKE $2 ESCAPE '\\'
      AND NOT EXISTS(SELECT 1 FROM social_block WHERE (blocker=$1 AND blocked=u.id) OR (blocker=u.id AND blocked=$1))
      ORDER BY u.name,u.id LIMIT 10`, [actor,`%${q.replace(/[\\%_]/g,'\\$&')}%`,GAME_MODE]);
    return result.rows.map(row => ({...row,rank:rankProgress(row.elo)}));
  }
  async publicProfile(actor: string, target: string) {
    await this.friends(this.pool,actor,target);
    const row = (await this.pool.query(`SELECT u.id,u.name,COALESCE(r.elo,1000) elo,COALESCE(r.wins,0) wins,COALESCE(r.losses,0) losses,COALESCE(r.draws,0) draws
      FROM golvia_auth."user" u LEFT JOIN competitive_rating r ON r.user_id=u.id AND r.mode=$2 WHERE u.id=$1 AND u.status='active' AND u."emailVerified"`, [target,GAME_MODE])).rows[0];
    if (!row) throw new SessionError(404,'Oyuncu bulunamadı.');
    return {...row,rank:rankProgress(row.elo)};
  }
  async change(actor: string, action: SocialAction, target: string) {
    if (!target || target.length>160 || actor===target) throw new SessionError(400,'Geçersiz oyuncu.');
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      let invite;
      if (action.startsWith('invite-')) {
        invite=(await client.query('SELECT * FROM social_invite WHERE id=$1 AND (sender=$2 OR recipient=$2)',[target,actor])).rows[0];
        if(!invite) throw new SessionError(404,'Davet bulunamadı.');
        target=invite.sender===actor?invite.recipient:invite.sender;
      }
      await this.users(client,pair(actor,target),['block','unblock','remove','cancel','reject','invite-cancel','invite-reject'].includes(action)?target:undefined);
      if(invite) invite=(await client.query('SELECT * FROM social_invite WHERE id=$1 FOR UPDATE',[invite.id])).rows[0];
      const [a,b]=pair(actor,target);
      const relation=(await client.query('SELECT * FROM social_friendship WHERE user_a=$1 AND user_b=$2 FOR UPDATE',[a,b])).rows[0];
      const blocked=(await client.query('SELECT 1 FROM social_block WHERE (blocker=$1 AND blocked=$2) OR (blocker=$2 AND blocked=$1)',[a,b])).rowCount;
      if(action==='block') {
        await client.query('INSERT INTO social_block VALUES($1,$2) ON CONFLICT DO NOTHING',[actor,target]);
        await client.query("UPDATE social_friendship SET status='blocked',updated_at=now() WHERE user_a=$1 AND user_b=$2",[a,b]);
        await client.query("UPDATE social_invite SET status='cancelled' WHERE ((sender=$1 AND recipient=$2) OR (sender=$2 AND recipient=$1)) AND (status='pending' OR (status='accepted' AND match_id IS NULL))",[a,b]);
        await client.query('DELETE FROM social_notification WHERE (actor=$1 AND recipient=$2) OR (actor=$2 AND recipient=$1)',[a,b]);
      } else if(action==='unblock') {
        await client.query('DELETE FROM social_block WHERE blocker=$1 AND blocked=$2',[actor,target]);
        await client.query("UPDATE social_friendship SET status='cancelled',updated_at=now() WHERE user_a=$1 AND user_b=$2 AND status='blocked' AND NOT EXISTS(SELECT 1 FROM social_block WHERE (blocker=$1 AND blocked=$2) OR (blocker=$2 AND blocked=$1))",[a,b]);
      } else {
        if(blocked) throw new SessionError(403,'Bu işlem kullanılamıyor.');
        if(action==='request') {
          if(relation && ['pending','accepted'].includes(relation.status)) throw new SessionError(409,'İstek veya arkadaşlık zaten var.');
          if(relation && Date.now()-new Date(relation.updated_at).getTime()<60000) throw new SessionError(429,'Biraz sonra yeniden dene.');
          const count=(await client.query("SELECT count(*)::int n FROM social_friendship WHERE requester=$1 AND status='pending'",[actor])).rows[0].n;
          if(count>=50) throw new SessionError(429,'Çok fazla bekleyen istek.');
          const incoming=(await client.query("SELECT count(*)::int n FROM social_friendship WHERE (user_a=$1 OR user_b=$1) AND requester<>$1 AND status='pending'",[target])).rows[0].n;
          if(incoming>=50)throw new SessionError(429,'Oyuncunun istek kutusu dolu.');
          const id=randomUUID();
          await client.query(`INSERT INTO social_friendship(user_a,user_b,requester,request_id,status) VALUES($1,$2,$3,$4,'pending') ON CONFLICT(user_a,user_b) DO UPDATE SET requester=$3,request_id=$4,status='pending',updated_at=now()`,[a,b,actor,id]);
          await this.notice(client,target,actor,'request',id);
        } else if(['accept','reject','cancel','remove'].includes(action)) {
          if(!relation || (action==='remove' ? relation.status!=='accepted' : relation.status!=='pending') || (action==='cancel'?relation.requester!==actor:action!=='remove'&&relation.requester===actor)) throw new SessionError(409,'İstek değişmiş veya işlem yetkisiz.');
          if(action==='accept')for(const user of [actor,target]){
            const count=(await client.query("SELECT count(*)::int n FROM social_friendship WHERE (user_a=$1 OR user_b=$1) AND status='accepted'",[user])).rows[0].n;
            if(count>=200)throw new SessionError(409,'Arkadaş listesi dolu.');
          }
          await client.query('UPDATE social_friendship SET status=$3,updated_at=now() WHERE user_a=$1 AND user_b=$2',[a,b,action==='accept'?'accepted':action==='reject'?'rejected':'cancelled']);
          if(action==='accept') await this.notice(client,target,actor,'friend-accepted',relation.request_id);
          if(action==='remove') await client.query("UPDATE social_invite SET status='cancelled' WHERE ((sender=$1 AND recipient=$2) OR(sender=$2 AND recipient=$1)) AND (status='pending' OR(status='accepted' AND match_id IS NULL))",[a,b]);
        } else if(action==='invite') {
          await this.friends(client,actor,target);
          await client.query("UPDATE social_invite SET status='expired' WHERE expires_at<=now() AND (status='pending' OR(status='accepted' AND match_id IS NULL))");
          if((await client.query("SELECT 1 FROM social_invite WHERE (sender=ANY($1::text[]) OR recipient=ANY($1::text[])) AND status='pending' LIMIT 10",[[actor,target]])).rowCount!>=10) throw new SessionError(429,'Çok fazla açık davet.');
          const id=randomUUID();
          await client.query("INSERT INTO social_invite(id,sender,recipient,status,expires_at) VALUES($1,$2,$3,'pending',now()+($4*interval '1 millisecond'))",[id,actor,target,this.inviteMs]);
          await this.notice(client,target,actor,'invite',id); invite={id};
        } else if(invite) {
          await this.friends(client,actor,target);
          if(action==='invite-accept' && invite.recipient!==actor || action==='invite-reject' && invite.recipient!==actor || action==='invite-cancel' && invite.sender!==actor) throw new SessionError(403,'Davete erişim yok.');
          if(action==='invite-accept' && invite.match_id)throw new SessionError(409,'Davet zaten kullanıldı.');
          if(action==='invite-accept' && invite.status==='accepted' && new Date(invite.expires_at).getTime()>Date.now()) { /* Retry returns the same invitation, never creates another match. */ }
          else {
            if((invite.status!=='pending' && !(action==='invite-cancel' && invite.status==='accepted' && !invite.match_id)) || new Date(invite.expires_at).getTime()<=Date.now()) throw new SessionError(409,'Davet kapalı veya süresi dolmuş.');
            if(action==='invite-accept') {
              const occupied=await client.query(`SELECT 1 FROM social_invite WHERE id<>$2 AND status='accepted' AND match_id IS NULL AND expires_at>now() AND (sender=ANY($1::text[]) OR recipient=ANY($1::text[]))
                UNION ALL SELECT 1 FROM social_match WHERE status='active' AND (user0=ANY($1::text[]) OR user1=ANY($1::text[]))`,[[a,b],invite.id]);
              if(occupied.rowCount) throw new SessionError(409,'Oyunculardan biri başka maça hazırlanıyor.');
            }
            const status=action==='invite-accept'?'accepted':action==='invite-reject'?'rejected':'cancelled';
            await client.query('UPDATE social_invite SET status=$2 WHERE id=$1',[invite.id,status]); invite.status=status;
            await this.notice(client,target,actor,`invite-${status}`,invite.id);
          }
        } else throw new SessionError(400,'Geçersiz işlem.');
      }
      await client.query('COMMIT'); return { target,inviteId:invite?.id as string|undefined };
    } catch(error) {
      await client.query('ROLLBACK');
      if(error && typeof error==='object' && 'code' in error && error.code==='23505') throw new SessionError(409,'Açık davet zaten var.');
      throw error;
    } finally {client.release();}
  }
  async state(actor: string) {
    const friends=await this.pool.query(`SELECT u.id,u.name,f.status,f.requester,COALESCE(r.elo,1000) elo FROM social_friendship f
      JOIN golvia_auth."user" u ON u.id=CASE WHEN f.user_a=$1 THEN f.user_b ELSE f.user_a END
      LEFT JOIN competitive_rating r ON r.user_id=u.id AND r.mode=$2
      WHERE (f.user_a=$1 OR f.user_b=$1) AND f.status IN ('pending','accepted') AND u.status='active' AND u."emailVerified"
      AND NOT EXISTS(SELECT 1 FROM social_block WHERE (blocker=$1 AND blocked=u.id) OR(blocker=u.id AND blocked=$1)) ORDER BY f.updated_at DESC LIMIT 300`,[actor,GAME_MODE]);
    const invites=await this.pool.query(`SELECT i.id,i.sender,i.recipient,i.status,i.expires_at,i.match_id,u.name FROM social_invite i
      JOIN golvia_auth."user" u ON u.id=CASE WHEN i.sender=$1 THEN i.recipient ELSE i.sender END
      WHERE (i.sender=$1 OR i.recipient=$1) AND i.status IN ('pending','accepted') AND i.expires_at>now() AND i.match_id IS NULL
      AND EXISTS(SELECT 1 FROM social_friendship f WHERE f.user_a=LEAST(i.sender COLLATE "C",i.recipient COLLATE "C") AND f.user_b=GREATEST(i.sender COLLATE "C",i.recipient COLLATE "C") AND f.status='accepted')
      AND NOT EXISTS(SELECT 1 FROM social_block WHERE (blocker=$1 AND blocked=u.id) OR(blocker=u.id AND blocked=$1)) ORDER BY i.created_at DESC LIMIT 20`,[actor]);
    const blocks=await this.pool.query('SELECT u.id,u.name FROM social_block b JOIN golvia_auth."user" u ON u.id=b.blocked WHERE blocker=$1',[actor]);
    const notices=await this.pool.query(`SELECT n.id::text,n.kind,n.reference,n.seen,u.name,n.created_at FROM social_notification n LEFT JOIN golvia_auth."user" u ON u.id=n.actor
      WHERE n.recipient=$1 ORDER BY n.id DESC LIMIT 50`,[actor]);
    return { userId:actor,people:friends.rows.map(row=>({...row,rank:rankProgress(row.elo)})),invites:invites.rows,blocks:blocks.rows,notifications:notices.rows };
  }
  async read(actor: string) {await this.pool.query('UPDATE social_notification SET seen=true WHERE recipient=$1 AND NOT seen',[actor]);}
  async expire() {await this.pool.query("UPDATE social_invite SET status='expired' WHERE expires_at<=now() AND (status='pending' OR(status='accepted' AND match_id IS NULL))");}
  async inviteParty(actor:string,id:string){
    const row=(await this.pool.query('SELECT sender,recipient,expires_at FROM social_invite WHERE id=$1 AND (sender=$2 OR recipient=$2)',[id,actor])).rows[0];
    if(!row)throw new SessionError(404,'Davet bulunamadı.');return {other:String(row.sender===actor?row.recipient:row.sender),expires:new Date(row.expires_at).getTime()};
  }
  async cancelPreparing(actor:string,id:string){return (await this.pool.query("UPDATE social_invite SET status='cancelled' WHERE id=$1 AND(sender=$2 OR recipient=$2) AND status='accepted' AND match_id IS NULL RETURNING sender,recipient",[id,actor])).rows[0] as {sender:string;recipient:string}|undefined;}
  async invitation(actor: string, id: string) {
    const row=(await this.pool.query("SELECT * FROM social_invite WHERE id=$1 AND (sender=$2 OR recipient=$2) AND status='accepted' AND expires_at>now()",[id,actor])).rows[0];
    if(!row) throw new SessionError(409,'Davet kullanılamıyor.');
    await this.friends(this.pool,row.sender,row.recipient);return row as {id:string;sender:string;recipient:string;match_id:string|null;expires_at:string};
  }
  async startFriend(id: string, inviteId: string, users: [string,string], at: number) {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');await this.users(client,[...users].sort());await this.friends(client,...users);
      const invite=(await client.query("SELECT * FROM social_invite WHERE id=$1 AND status='accepted' AND expires_at>now() FOR UPDATE",[inviteId])).rows[0];
      if(!invite || invite.match_id || !users.includes(invite.sender) || !users.includes(invite.recipient)) throw new SessionError(409,'Davet zaten kullanıldı.');
      const active=await client.query("SELECT 1 FROM social_match WHERE status='active' AND (user0=ANY($1::text[]) OR user1=ANY($1::text[]))",[users]);
      if(active.rowCount) throw new SessionError(409,'Oyuncu maçta.');
      await client.query("INSERT INTO social_match(id,user0,user1,status,started_at) VALUES($1,$2,$3,'active',to_timestamp($4/1000.0))",[id,...users,at]);
      await client.query('UPDATE social_invite SET match_id=$2 WHERE id=$1',[inviteId,id]);await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async complete(id:string,score:[number,number],winner:0|1|null,at:number,reason='finished'):Promise<RankedResult>{
    if(!score.every(n=>Number.isInteger(n)&&n>=0&&n<=3) || !['finished','forfeit'].includes(reason) || (reason==='finished'?winner!==(score[0]===score[1]?null:score[0]>score[1]?0:1):winner!==0&&winner!==1)) throw new Error('Invalid friendly result');
    const row=(await this.pool.query(`UPDATE social_match SET status='completed',score0=$2,score1=$3,winner=$4,reason=$6,ended_at=to_timestamp($5/1000.0)
      WHERE id=$1 AND status='active' RETURNING id`,[id,...score,winner,at,reason])).rows[0];
    if(!row){const prior=(await this.pool.query('SELECT * FROM social_match WHERE id=$1',[id])).rows[0];if(!prior || prior.status!=='completed' || prior.score0!==score[0] || prior.score1!==score[1] || prior.winner!==winner || prior.reason!==reason)throw new SessionError(409,'Maç sonucu çakışıyor.');}
    return {matchId:id,status:'completed',reason,winner};
  }
  async cancel(id:string,reason:string):Promise<RankedResult>{
    await this.pool.query("UPDATE social_match SET status='cancelled',reason=$2,ended_at=now() WHERE id=$1 AND status='active'",[id,reason]);
    const prior=(await this.pool.query('SELECT status,reason FROM social_match WHERE id=$1',[id])).rows[0];
    if(prior?.status==='completed')throw new SessionError(409,'Tamamlanmış maç iptal edilemez.');
    return {matchId:id,status:'cancelled',reason:prior?.reason??reason};
  }
  async recover(){await this.pool.query("UPDATE social_match SET status='cancelled',reason='server-restart',ended_at=now() WHERE status='active'");await this.pool.query("UPDATE social_invite SET status='expired' WHERE status='accepted' AND match_id IS NULL");await this.expire();}
  async export(actor:string){
    return (await this.pool.query(`SELECT json_build_object(
      'friendships',COALESCE((SELECT json_agg(f) FROM (SELECT user_a,user_b,requester,status,updated_at FROM social_friendship WHERE user_a=$1 OR user_b=$1) f),'[]'),
      'blocks',COALESCE((SELECT json_agg(b) FROM (SELECT blocked FROM social_block WHERE blocker=$1) b),'[]'),
      'invites',COALESCE((SELECT json_agg(i) FROM social_invite i WHERE sender=$1 OR recipient=$1),'[]'),
      'notifications',COALESCE((SELECT json_agg(n) FROM social_notification n WHERE recipient=$1),'[]'),
      'matches',COALESCE((SELECT json_agg(m) FROM social_match m WHERE user0=$1 OR user1=$1),'[]')) data`,[actor])).rows[0].data;
  }
  async history(actor:string,page=1){
    if(!Number.isInteger(page)||page<1||page>10000)throw new SessionError(400,'Geçersiz sayfa.');
    const rows=(await this.pool.query(`SELECT m.id,m.status,m.score0,m.score1,m.winner,m.reason,m.started_at,m.ended_at,CASE WHEN m.user0=$1 THEN 0 ELSE 1 END seat,COALESCE(u.name,'Silinmiş oyuncu') opponent
      FROM social_match m LEFT JOIN golvia_auth."user" u ON u.id=CASE WHEN m.user0=$1 THEN m.user1 ELSE m.user0 END
      WHERE (m.user0=$1 OR m.user1=$1) AND m.status<>'active' ORDER BY m.started_at DESC,m.id DESC LIMIT 21 OFFSET $2`,[actor,(page-1)*20])).rows;
    return {items:rows.slice(0,20),hasNext:rows.length>20,page};
  }
}
