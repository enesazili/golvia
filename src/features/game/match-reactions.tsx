'use client';
import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { REACTIONS, type Reaction } from '@/lib/reactions';
type Emote={id:string;matchId:string;emoji:Reaction;own?:boolean};
export function MatchReactions({socket,matchId}:{socket:Socket;matchId:string}){
  const [muted,setMuted]=useState(false),[emote,setEmote]=useState<Emote|null>(null),[error,setError]=useState('');
  useEffect(()=>{const receive=(data:Emote)=>{if(!muted&&data.matchId===matchId&&Object.hasOwn(REACTIONS,data.emoji))setEmote(data);};socket.on('matchReaction',receive);return()=>{socket.off('matchReaction',receive);};},[socket,matchId,muted]);
  useEffect(()=>{if(!emote)return;const timer=setTimeout(()=>setEmote(null),1800);return()=>clearTimeout(timer);},[emote]);
  useEffect(()=>{if(!error)return;const timer=setTimeout(()=>setError(''),2000);return()=>clearTimeout(timer);},[error]);
  return <div className="match-reactions" aria-label="Maç tepkileri"><div>{Object.entries(REACTIONS).map(([key,value])=><button key={key} aria-label={`${value} tepkisi gönder`} onClick={()=>{void socket.timeout(3000).emitWithAck('matchReaction',{matchId,emoji:key}).then(reply=>{if(reply.status===200)setEmote({...reply.data,own:true});else setError(reply.error??'Tepki gönderilemedi.');}).catch(()=>setError('Bağlantı kurulamadı.'));}}>{value}</button>)}</div><span className="reaction-slot" aria-live="polite">{emote?.matchId===matchId&&(!muted||emote.own)&&<span key={emote.id} className="reaction-bubble">{REACTIONS[emote.emoji]}</span>}</span><button className="reaction-mute" aria-pressed={muted} onClick={()=>setMuted(value=>!value)}>{muted?'Rakip tepkileri kapalı':'Tepkileri sessize al'}</button>{error&&<small role="status">{error}</small>}</div>;
}
