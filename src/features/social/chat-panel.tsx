'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@/server/social/chat';
import type { Person, SocialSend } from './social-provider';
import { requestId } from '@/features/game/request-id';
type History={messages:ChatMessage[];hasMore:boolean};
function merge(old:ChatMessage[],incoming:ChatMessage[]){
  const messages=new Map(old.map(message=>[message.id,message]));
  for(const message of incoming)if(!messages.get(message.id)?.deleted_at)messages.set(message.id,message);
  return [...messages.values()].sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:1);
}
export function ChatPanel({peer,userId,send,onClose}:{peer:Person;userId:string;send:SocialSend;onClose:()=>void}){
  const [messages,setMessages]=useState<ChatMessage[]>([]),[text,setText]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[hasMore,setHasMore]=useState(false),[typing,setTyping]=useState(false);
  const box=useRef<HTMLDivElement>(null),stick=useRef(true),oldest=useRef<string|null>(null),readTo=useRef('0'),lastTyping=useRef(0),typingTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const pending=useRef<{text:string;id:string}|null>(null);
  const load=useCallback(async()=>{
    try{const data=await send<History>({action:'chat-history',target:peer.id});setMessages(previous=>merge(previous,data.messages));if(oldest.current===null){oldest.current=data.messages[0]?.id??null;setHasMore(data.hasMore);}setError('');}
    catch(err){setError(err instanceof Error?err.message:'Sohbet okunamadı.');}
  },[peer.id,send]);
  useEffect(()=>{
    let active=true;queueMicrotask(()=>{if(active)void load();});
    const changed=(event:Event)=>{const data=(event as CustomEvent<{peerId:string;message?:ChatMessage}>).detail;if(data.peerId!==peer.id)return;if(data.message)setMessages(previous=>merge(previous,[data.message!]));else void load();};
    const writing=(event:Event)=>{const data=(event as CustomEvent<{from:string;active:boolean}>).detail;if(data.from!==peer.id)return;clearTimeout(typingTimer.current);setTyping(data.active);if(data.active)typingTimer.current=setTimeout(()=>setTyping(false),4000);};
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;document.getElementById('chat-message-input')?.focus({preventScroll:true});const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose();};window.addEventListener('keydown',escape);
    window.addEventListener('golvia:chat-refresh',changed);window.addEventListener('golvia:chat-typing',writing);
    return()=>{active=false;window.removeEventListener('keydown',escape);if(previous?.isConnected)previous.focus({preventScroll:true});clearTimeout(typingTimer.current);window.removeEventListener('golvia:chat-refresh',changed);window.removeEventListener('golvia:chat-typing',writing);void send({action:'chat-typing',target:peer.id,typing:false}).catch(()=>{});};
  },[load,peer.id,send,onClose]);
  const markRead=useCallback(()=>{
    const last=messages.at(-1)?.id;if(!last||last===readTo.current||document.visibilityState!=='visible'||!stick.current)return;
    void send({action:'chat-read',target:peer.id,upTo:last}).then(()=>{readTo.current=last;}).catch(()=>{});
  },[messages,peer.id,send]);
  useEffect(()=>{if(stick.current&&box.current)box.current.scrollTop=box.current.scrollHeight;markRead();const focus=()=>markRead();document.addEventListener('visibilitychange',focus);return()=>document.removeEventListener('visibilitychange',focus);},[markRead]);
  async function older(){if(busy||!oldest.current)return;setBusy(true);try{const data=await send<History>({action:'chat-history',target:peer.id,before:oldest.current});stick.current=false;setMessages(previous=>merge(data.messages,previous));oldest.current=data.messages[0]?.id??oldest.current;setHasMore(data.hasMore);}catch(err){setError(err instanceof Error?err.message:'Geçmiş okunamadı.');}finally{setBusy(false);}}
  async function submit(){
    if(busy||!text.trim())return;setBusy(true);setError('');
    try{const attempt=pending.current?.text===text?pending.current:{text,id:requestId()};pending.current=attempt;const message=await send<ChatMessage>({action:'chat-send',target:peer.id,text,requestId:attempt.id});stick.current=true;setMessages(previous=>merge(previous,[message]));setText('');pending.current=null;lastTyping.current=0;void send({action:'chat-typing',target:peer.id,typing:false}).catch(()=>{});}
    catch(err){setError(err instanceof Error?err.message:'Mesaj gönderilemedi.');}finally{setBusy(false);}
  }
  return <section className="chat-panel" aria-label={`${peer.name} ile sohbet`}><header><div><strong>{peer.name}</strong><small aria-live="polite">{typing?'Yazıyor…':peer.presence==='in-match'?'Maçta':peer.presence==='online'?'Çevrimiçi':'Çevrimdışı'}</small></div><button onClick={()=>{void send({action:'invite',target:peer.id}).catch(err=>setError(err.message));}}>Maça davet</button><button aria-label="Sohbeti kapat" onClick={onClose}>×</button></header>
    <div className="chat-messages" ref={box} onScroll={()=>{if(box.current)stick.current=box.current.scrollHeight-box.current.scrollTop-box.current.clientHeight<60;markRead();}}>{hasMore&&<button className="quiet-button" disabled={busy} onClick={()=>void older()}>Önceki mesajlar</button>}{messages.map(message=><article key={message.id} className={message.sender===userId?'chat-message mine':'chat-message'}><p>{message.deleted_at?'Mesaj silindi':message.body}</p><div><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})}</time>{message.sender===userId&&!message.deleted_at&&<button aria-label="Mesajı sil" disabled={busy} onClick={()=>{setBusy(true);void send<ChatMessage>({action:'chat-delete',target:peer.id,messageId:message.id}).then(saved=>setMessages(previous=>merge(previous,[saved]))).catch(err=>setError(err.message)).finally(()=>setBusy(false));}}>Sil</button>}</div></article>)}</div>
    {error&&<p className="chat-error" role="alert">{error}</p>}<form onSubmit={event=>{event.preventDefault();void submit();}}><label className="sr-only" htmlFor="chat-message-input">Mesaj</label><textarea id="chat-message-input" rows={2} maxLength={1000} value={text} placeholder="Mesaj yaz" onChange={event=>{setText(event.target.value);if(Date.now()-lastTyping.current>2000){lastTyping.current=Date.now();void send({action:'chat-typing',target:peer.id,typing:!!event.target.value.trim()}).catch(()=>{});}}}/><div><small>{Array.from(text).length}/500</small><button disabled={busy||!text.trim()||Array.from(text).length>500}>Gönder</button></div></form>
  </section>;
}
