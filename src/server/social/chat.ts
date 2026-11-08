import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { SocialRepository } from './repository.ts';
import { SessionError } from '../game/service.ts';
export type ChatMessage={id:string;sender:string;recipient:string;body:string|null;created_at:string;deleted_at:string|null;request_id:string};
const fields='id::text,sender,recipient,body,created_at,deleted_at,request_id';
function cursor(value:unknown,optional=false):string|null{
  if(optional&&value===undefined)return null;
  if(typeof value!=='string'||!/^\d{1,19}$/.test(value)||BigInt(value)>BigInt('9223372036854775807'))throw new SessionError(400,'Geçersiz mesaj kimliği.');
  return value;
}
export class ChatRepository{
  constructor(private readonly pool:Pool,private readonly social:Pick<SocialRepository,'withFriend'>){}
  async send(actor:string,peer:string,input:unknown,nonce:unknown):Promise<ChatMessage>{
    if(typeof input!=='string'||input.length>2000||typeof nonce!=='string'||!/^[a-zA-Z0-9:-]{1,80}$/.test(nonce))throw new SessionError(400,'Geçersiz mesaj.');
    const text=input.normalize('NFC').trim();
    if(!text||Array.from(text).length>500||Buffer.byteLength(text)>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))throw new SessionError(400,'Mesaj 1–500 karakter olmalı.');
    const hash=createHash('sha256').update(text).digest('hex');
    return this.social.withFriend(actor,peer,async client=>{
      const saved=(await client.query(`SELECT ${fields},content_hash FROM social_message WHERE sender=$1 AND request_id=$2`,[actor,nonce])).rows[0];
      if(saved){if(saved.recipient!==peer||saved.content_hash!==hash)throw new SessionError(409,'Mesaj kimliği başka içerikle kullanılmış.');const {content_hash:_,...message}=saved;void _;return message as ChatMessage;}
      return (await client.query(`INSERT INTO social_message(sender,recipient,request_id,body,content_hash) VALUES($1,$2,$3,$4,$5) RETURNING ${fields}`,[actor,peer,nonce,text,hash])).rows[0] as ChatMessage;
    });
  }
  async history(actor:string,peer:string,before?:unknown){
    const id=cursor(before,true);
    return this.social.withFriend(actor,peer,async client=>{
      const rows=(await client.query(`SELECT ${fields} FROM social_message WHERE LEAST(sender COLLATE "C",recipient COLLATE "C")=LEAST($1 COLLATE "C",$2 COLLATE "C") AND GREATEST(sender COLLATE "C",recipient COLLATE "C")=GREATEST($1 COLLATE "C",$2 COLLATE "C") AND ($3::bigint IS NULL OR id<$3) ORDER BY social_message.id DESC LIMIT 31`,[actor,peer,id])).rows as ChatMessage[];
      return {messages:rows.slice(0,30).reverse(),hasMore:rows.length>30};
    });
  }
  async read(actor:string,peer:string,upTo:unknown){
    const id=cursor(upTo);
    return this.social.withFriend(actor,peer,async client=>{
      const last=(await client.query('SELECT LEAST(COALESCE(MAX(id),0),$3::bigint)::text value FROM social_message WHERE LEAST(sender COLLATE "C",recipient COLLATE "C")=LEAST($1 COLLATE "C",$2 COLLATE "C") AND GREATEST(sender COLLATE "C",recipient COLLATE "C")=GREATEST($1 COLLATE "C",$2 COLLATE "C")',[actor,peer,id])).rows[0].value;
      await client.query('INSERT INTO social_chat_read(user_id,peer_id,last_read) VALUES($1,$2,$3) ON CONFLICT(user_id,peer_id) DO UPDATE SET last_read=GREATEST(social_chat_read.last_read,EXCLUDED.last_read)',[actor,peer,last]);
    });
  }
  async remove(actor:string,peer:string,id:unknown):Promise<ChatMessage>{
    const value=cursor(id);
    return this.social.withFriend(actor,peer,async client=>{
      const row=(await client.query(`UPDATE social_message SET body=NULL,deleted_at=COALESCE(deleted_at,now()) WHERE id=$1 AND sender=$2 AND recipient=$3 RETURNING ${fields}`,[value,actor,peer])).rows[0];
      if(!row)throw new SessionError(404,'Mesaj bulunamadı.');return row as ChatMessage;
    });
  }
  async typing(actor:string,peer:string){return this.social.withFriend(actor,peer,async()=>undefined);}
  async summaries(actor:string){
    return (await this.pool.query(`SELECT u.id peer_id,COALESCE(latest.id,0)::text last_id,
      (SELECT count(*)::int FROM social_message m WHERE m.sender=u.id AND m.recipient=$1 AND m.deleted_at IS NULL AND m.id>COALESCE(r.last_read,0)) unread
      FROM social_friendship f JOIN golvia_auth."user" u ON u.id=CASE WHEN f.user_a=$1 THEN f.user_b ELSE f.user_a END
      LEFT JOIN social_chat_read r ON r.user_id=$1 AND r.peer_id=u.id
      LEFT JOIN LATERAL(SELECT max(id) id FROM social_message WHERE LEAST(sender COLLATE "C",recipient COLLATE "C")=LEAST($1 COLLATE "C",u.id COLLATE "C") AND GREATEST(sender COLLATE "C",recipient COLLATE "C")=GREATEST($1 COLLATE "C",u.id COLLATE "C")) latest ON true
      WHERE (f.user_a=$1 OR f.user_b=$1) AND f.status='accepted' AND u.status='active' AND u."emailVerified"
      AND NOT EXISTS(SELECT 1 FROM social_block WHERE(blocker=$1 AND blocked=u.id)OR(blocker=u.id AND blocked=$1)) ORDER BY latest.id DESC NULLS LAST LIMIT 200`,[actor])).rows as {peer_id:string;last_id:string;unread:number}[];
  }
}
