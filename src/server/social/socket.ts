import type { Server, Socket } from 'socket.io';
import type { Matchmaking } from '../matchmaking.ts';
import { SessionError } from '../game/service.ts';
import { SocialRepository, type SocialAction } from './repository.ts';
type Resolver=(cookie?:string)=>Promise<string|{id:string;name:string}|null>;
const actions=new Set(['request','accept','reject','cancel','remove','block','unblock','invite','invite-accept','invite-reject','invite-cancel']);
/** Presence and game ownership belong to this single socket process. Invitations/notifications are durable. */
export function installSocial(io:Server,repo:SocialRepository,matchmaking:Matchmaking,resolve:Resolver,
  authenticate:(socket:Socket,next:(err?:Error)=>void)=>void,release:(account:string,ip:string)=>void,online:(account:string)=>boolean){
  const ns=io.of('/social');ns.use(authenticate);
  const attempts=new Map<string,{n:number;until:number}>();
  const joins=new Map<string,{users:Map<string,string>;participants:string[];expires:number}>();
  const clearJoin=(id:string,except?:string)=>{
    const entry=joins.get(id);if(entry)for(const player of entry.users.values())if(player!==except)for(const socket of io.sockets.sockets.values())if(socket.data.playerId===player)socket.emit('matchCancelled');
    joins.delete(id);matchmaking.releaseInvite(id);
  };
  const changed=(...users:string[])=>{for(const user of new Set(users))ns.to(`user:${user}`).emit('socialChanged');};
  const authorized=async(socket:Socket)=>{const account=await resolve(socket.handshake.headers.cookie);if(socket.data.accountId!==(typeof account==='string'?account:account?.id))throw new SessionError(401,'Oturum sona erdi.');return String(socket.data.accountId);};
  const presence=(user:string)=>online(user)?matchmaking.activity(user):'offline';
  ns.on('connection',socket=>{
    const actor=String(socket.data.accountId);void socket.join(`user:${actor}`);
    socket.on('social',async(data:unknown,ack:unknown)=>{
      if(typeof ack!=='function')return;
      try{
        await authorized(socket);
        const now=Date.now();let slot=attempts.get(actor);if(!slot||slot.until<=now){slot={n:0,until:now+10000};attempts.set(actor,slot);}if(++slot.n>35)throw new SessionError(429,'Çok fazla işlem. Biraz bekle.');
        if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!['action','target','query','page'].includes(k)))throw new SessionError(400,'Geçersiz işlem.');
        const body=data as {action?:unknown;target?:unknown;query?:unknown;page?:unknown};
        if(body.action==='state'){
          const state=await repo.state(actor);ack({status:200,data:{...state,people:state.people.map(row=>({...row,presence:row.status==='accepted'?presence(row.id):undefined}))}});return;
        }
        if(body.action==='search'){if(typeof body.query!=='string')throw new SessionError(400,'Arama gerekli.');ack({status:200,data:await repo.search(actor,body.query)});return;}
        if(body.action==='read'){await repo.read(actor);changed(actor);ack({status:200});return;}
        if(body.action==='history'){ack({status:200,data:await repo.history(actor,body.page===undefined?1:Number(body.page))});return;}
        if(typeof body.target!=='string'||body.target.length>160)throw new SessionError(400,'Oyuncu veya davet gerekli.');
        if(body.action==='profile'){ack({status:200,data:await repo.publicProfile(actor,body.target)});return;}
        if(!actions.has(String(body.action)))throw new SessionError(400,'Geçersiz işlem.');
        if(body.action==='invite' && (!online(body.target)||matchmaking.busy(actor)||matchmaking.busy(body.target)))throw new SessionError(409,!online(body.target)?'Arkadaşın çevrimdışı.':'Oyunculardan biri müsait değil.');
        let party:string|undefined,expires:number|undefined;
        if(body.action==='invite-accept'){
          // Repository still owns recipient authorization, expiry, block and replay checks.
          if(matchmaking.busy(actor,body.target))throw new SessionError(409,'Önce mevcut maçını bitir.');
          const info=await repo.inviteParty(actor,body.target);party=info.other;expires=info.expires;
          if(!online(info.other)||matchmaking.busy(info.other,body.target))throw new SessionError(409,'Arkadaşın şu anda müsait değil.');

        }
        const target=body.target;
        const result=party?await matchmaking.reserveInvite(target,[actor,party],()=>repo.change(actor,body.action as SocialAction,target),expires):await repo.change(actor,body.action as SocialAction,target);
        if(body.action==='invite-cancel'&&result.inviteId)clearJoin(result.inviteId);
        if(body.action==='block'||body.action==='remove'){matchmaking.releaseBetween(actor,result.target);for(const [id,entry]of joins)if(entry.participants.includes(actor)&&entry.participants.includes(result.target))clearJoin(id);}
        changed(actor,result.target);ack({status:200,data:result});
      }catch(error){ack({status:error instanceof SessionError?error.status:503,error:error instanceof SessionError?error.message:'Sosyal hizmet şu anda kullanılamıyor.'});}
    });
    socket.on('disconnect',()=>release(actor,String(socket.data.ip)));
  });
  const timer=setInterval(()=>{
    void repo.expire().catch(()=>{/* Retry expiry after a database outage. */});
    for(const [actor,slot]of attempts)if(slot.until<=Date.now())attempts.delete(actor);
    for(const [id,entry]of joins)if(entry.expires<=Date.now())clearJoin(id);
    // Revalidate quiet connections too: revoked sessions must not retain inbox or presence access.
    for(const socket of ns.sockets.values())void authorized(socket).catch(()=>socket.disconnect());
  },5000);timer.unref?.();io.httpServer?.on('close',()=>clearInterval(timer));
  return {
    async join(socket:Socket,playerId:string,id:string,current:()=>boolean){
      const actor=await authorized(socket),invite=await repo.invitation(actor,id);
      if(invite.match_id)throw new SessionError(409,'Davet zaten kullanıldı.');
      if(!current())throw new SessionError(409,'Davet iptal edildi.');
      const entry=joins.get(id)??{users:new Map<string,string>(),participants:[invite.sender,invite.recipient],expires:new Date(invite.expires_at).getTime()};
      const previous=entry.users.get(actor);
      if(previous && previous!==playerId && matchmaking.connected(previous))throw new SessionError(409,'Davet başka sekmede açık.');
      entry.users.set(actor,playerId);joins.set(id,entry);
      if(entry.users.has(invite.sender)&&entry.users.has(invite.recipient)){
        try{
          await matchmaking.pairFriends([entry.users.get(invite.sender)!,entry.users.get(invite.recipient)!],(match,users,at)=>repo.startFriend(match,id,users,at),id);
          joins.delete(id);changed(invite.sender,invite.recipient);
        }catch(error){joins.delete(id);throw error;}
      }
    },
    async leave(actor:string,playerId:string,invitationId?:string){
      if(invitationId){const cancelled=await repo.cancelPreparing(actor,invitationId);if(cancelled){clearJoin(invitationId,playerId);changed(cancelled.sender,cancelled.recipient);}}
      for(const [id,entry]of joins)if(entry.users.get(actor)===playerId&&(!invitationId||invitationId===id)){await repo.cancelPreparing(actor,id);clearJoin(id,playerId);changed(...entry.participants);}
    },
  };
}
