'use client';
import { useEffect, useState } from 'react';
import { useSocial, type Person } from './social-provider';
import { RankBadge } from '@/features/competitive/rank-badge';
type Opponent=Person&{match_id:string;ended_at:string;kind:string;can_rematch:boolean};
export function RecentPlayers(){
  const {state,connected,send}=useSocial();const [players,setPlayers]=useState<Opponent[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{if(!connected)return;let active=true;void send<Opponent[]>({action:'recent'}).then(rows=>{if(active)setPlayers(rows);}).catch(err=>{if(active)setError(err.message);});return()=>{active=false;};},[connected,send]);
  async function act(action:string,target:string){if(busy)return;setBusy(true);setError('');try{await send({action,target});}catch(err){setError(err instanceof Error?err.message:'İşlem tamamlanamadı.');}finally{setBusy(false);}}
  return <section className="recent-players"><h2>Son karşılaşılanlar</h2>{error&&<p role="status">{error}</p>}{players.map(person=>{const relation=state?.people.find(row=>row.id===person.id);return <article className="friend-card" key={person.id}><span className="player-avatar">{person.name.slice(0,1)}</span><div className="friend-identity"><strong>{person.name}</strong><span><RankBadge rank={person.rank}/> · {person.elo} ELO</span><small>{new Date(person.ended_at).toLocaleDateString('tr-TR')}</small></div><div className="friend-actions">{relation?.status==='accepted'?<button onClick={()=>window.dispatchEvent(new CustomEvent('golvia:chat-open',{detail:person.id}))}>Sohbet</button>:!relation&&<button disabled={busy} onClick={()=>void act('request',person.id)}>Arkadaş ekle</button>}{person.can_rematch&&<button disabled={busy} onClick={()=>void act('rematch',person.match_id)}>Rövanş iste</button>}</div></article>;})}{connected&&!players.length&&<p className="fine-print">Henüz karşılaşma yok.</p>}</section>;
}
