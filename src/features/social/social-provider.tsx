'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { io, type Socket } from 'socket.io-client';
import type { RankProgress } from '@/lib/rating';
export type Person={id:string;name:string;elo:number;rank:RankProgress;status?:string;requester?:string;presence?:'online'|'in-match'|'offline'};
export type Invite={id:string;sender:string;recipient:string;status:string;expires_at:string;match_id:string|null;name:string};
type Notice={id:string;kind:string;name:string;reference:string;seen:boolean};
export type SocialState={userId:string;people:Person[];invites:Invite[];blocks:{id:string;name:string}[];notifications:Notice[]};
type Command={action:string;target?:string;query?:string;page?:number};
const labels:Record<string,string>={request:'Arkadaşlık isteği', 'friend-accepted':'Arkadaşlık kabul edildi',invite:'Maç daveti','invite-accepted':'Davet kabul edildi','invite-rejected':'Davet reddedildi','invite-cancelled':'Davet iptal edildi'};
const Context=createContext<{state:SocialState|null;connected:boolean;error:string;send:<T=unknown>(data:Command)=>Promise<T>}|null>(null);
export function useSocial(){const context=useContext(Context);if(!context)throw new Error('Social provider missing');return context;}
export function SocialProvider({enabled,children}:{enabled:boolean;children:ReactNode}){
  const [state,setState]=useState<SocialState|null>(null),[connected,setConnected]=useState(false),[error,setError]=useState(''),[toast,setToast]=useState('');
  const socket=useRef<Socket|null>(null),joining=useRef('');
  const router=useRouter(),path=usePathname();const pathRef=useRef(path);useEffect(()=>{pathRef.current=path;},[path]);
  const send=useCallback(async<T,>(data:Command):Promise<T>=>{
    if(!socket.current?.connected)throw new Error('Sosyal bağlantı kurulamadı.');
    const response=await socket.current.timeout(8000).emitWithAck('social',data);
    if(response.status!==200)throw new Error(response.error??'İşlem tamamlanamadı.');
    return response.data as T;
  },[]);
  useEffect(()=>{
    if(!enabled)return;
    const base=process.env.NEXT_PUBLIC_WS_URL||(process.env.NODE_ENV==='production'?location.origin:`${location.protocol}//${location.hostname}:${process.env.NEXT_PUBLIC_WS_PORT||'3001'}`);
    const connection=io(`${base.replace(/\/$/,'')}/social`,{transports:['websocket'],withCredentials:true,autoConnect:false});socket.current=connection;
    let active=true,reading=false;
    const refresh=async()=>{
      if(!active||!connection.connected||reading)return;reading=true;
      try{
        const next=await send<SocialState>({action:'state'});if(!active)return;
        setState(next);setError('');
        const newest=next.notifications[0],key=`golvia:social-seen:${next.userId}`;
        if(newest&&localStorage.getItem(key)!==newest.id){if(!newest.seen)setToast(`${newest.name||'Oyuncu'} · ${labels[newest.kind]||'Bildirim'}`);localStorage.setItem(key,newest.id);}
        const accepted=next.invites.find(item=>item.status==='accepted');
        if(accepted&&document.visibilityState==='visible'&&joining.current!==accepted.id){joining.current=accepted.id;if(sessionStorage.getItem('golvia:friend-invite')!==accepted.id){sessionStorage.removeItem('golvia:resume-token');sessionStorage.removeItem('golvia:match-kind');}sessionStorage.setItem('golvia:friend-invite',accepted.id);window.dispatchEvent(new Event('golvia:friend-ready'));if(pathRef.current!=='/')router.push('/');}
      }catch(err){if(active)setError(err instanceof Error?err.message:'Sosyal hizmet kullanılamıyor.');}finally{reading=false;}
    };
    connection.on('connect',()=>{setConnected(true);void refresh();});
    connection.on('disconnect',()=>{setConnected(false);setState(null);joining.current='';});
    connection.on('connect_error',()=>{setConnected(false);setError('Sosyal hizmet için doğrulanmış hesabınla giriş yap.');});
    connection.on('socialChanged',()=>{void refresh();});
    connection.connect();const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},5000);
    const focus=()=>{if(document.visibilityState==='visible')void refresh();};document.addEventListener('visibilitychange',focus);
    return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',focus);connection.removeAllListeners();connection.disconnect();socket.current=null;};
  },[enabled,router,send]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),6000);return()=>clearTimeout(timer);},[toast]);
  const incoming=state?.invites.find(item=>item.status==='pending'&&item.recipient===state.userId);
  return <Context.Provider value={{state:enabled?state:null,connected:enabled&&connected,error:enabled?error:'Doğrulanmış hesabınla giriş yap ve koşulları onayla.',send}}>{children}{enabled&&<Link href="/arkadaslar" className="social-launch" aria-label={`Arkadaşlar, ${state?.notifications.filter(item=>!item.seen).length??0} bildirim`}>Arkadaşlar{state?.notifications.some(item=>!item.seen)&&<span className="notification-dot"/>}</Link>}{enabled&&(toast||incoming)&&<aside className="social-toast" aria-live="polite"><p>{incoming?`${incoming.name} · Maç daveti`:toast}</p>{incoming&&error&&<p role="alert">{error}</p>}{incoming?<div><button onClick={()=>{void send({action:'invite-accept',target:incoming.id}).catch(err=>{setError(err.message);setToast(err.message);});}}>Kabul et</button><button onClick={()=>{void send({action:'invite-reject',target:incoming.id}).catch(err=>{setError(err.message);setToast(err.message);});}}>Reddet</button></div>:<button onClick={()=>setToast('')} aria-label="Bildirimi kapat">×</button>}</aside>}</Context.Provider>;
}
