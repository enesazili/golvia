'use client';
import { useState } from 'react';

type Item = { career_id:string; player_name:string; birth_date:string; player_id:string;
  team_name:string; team_id:string; candidate_url:string; provenance:Record<string,unknown>;
  status:string; reason:string; revision:number; newPairsIfApproved:number; possiblePairs:number; priority:number };
type Reply = { items?:Item[]; error?:string };
const input = 'w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[var(--text)]';
export default function ReviewWorkbench() {
  const [secret,setSecret] = useState(''),[items,setItems] = useState<Item[]>([]),[selected,setSelected] = useState<Item|null>(null);
  const [error,setError] = useState(''),[busy,setBusy] = useState(false),[reason,setReason] = useState('');
  const [source,setSource] = useState(''),[identity,setIdentity] = useState(''),[matchId,setMatchId] = useState('');
  const [matchDate,setMatchDate] = useState(''),[competition,setCompetition] = useState(''),[event,setEvent] = useState('goal');
  const [sourceNote,setSourceNote] = useState(''),[identityNote,setIdentityNote] = useState('');
  const [minutes,setMinutes] = useState(''),[checked,setChecked] = useState(false);
  async function load(key = secret) {
    setBusy(true);setError('');
    try { const r = await fetch('/api/dev/football-review',{headers:{Authorization:`Bearer ${key}`},cache:'no-store'});
      const data:Reply = await r.json(); if(!r.ok || !data.items) throw new Error(data.error ?? 'Erişim reddedildi.');
      setItems(data.items);setSelected(null);
    } catch(e) { setError(e instanceof Error ? e.message:'Kuyruk yüklenemedi.'); } finally { setBusy(false); }
  }
  async function decide(decision:'approved'|'rejected'|'hold') {
    if(!selected || busy) return; setBusy(true);setError('');
    const observation = { matchUrl:source,identityUrl:identity,matchId,matchDate,competition,
      playerName:selected.player_name,birthDate:selected.birth_date,teamName:selected.team_name,
      teamLevel:'senior',matchStatus:'final',event,sourceNote,identityNote,
      ...(event==='minutes-played'?{minutesPlayed:Number(minutes)}:{}),reviewerChecked:checked };
    try { const r = await fetch('/api/dev/football-review',{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},
      body:JSON.stringify({careerId:selected.career_id,revision:selected.revision,decision,reason,requestId:crypto.randomUUID(),
        ...(decision==='approved'?{observation}:{})})});
      const data:Reply = await r.json();if(!r.ok)throw new Error(data.error ?? 'Karar kaydedilemedi.');
      setReason('');setChecked(false);setSourceNote('');setIdentityNote('');await load();
    } catch(e) { setError(e instanceof Error ? e.message:'Karar kaydedilemedi.'); } finally { setBusy(false); }
  }
  return <main id="main" className="mx-auto max-w-6xl py-10 md:py-16">
    <p className="text-xs font-bold uppercase tracking-[.25em] text-[var(--accent)]">Yerel araç · Staging</p>
    <h1 className="mt-3 text-3xl font-black md:text-5xl">Kariyer incelemesi</h1>
    <p className="mt-3 max-w-2xl text-sm text-[var(--muted)]">Her karar tek bir bağlantıyı etkiler. P54 üyeliği maç kanıtı sayılmaz.</p>
    <form className="mt-8 flex max-w-xl flex-wrap gap-3" onSubmit={e=>{e.preventDefault();void load();}}>
      <label className="min-w-52 flex-1 text-sm">Yerel erişim anahtarı<input type="password" autoComplete="off" value={secret} onChange={e=>setSecret(e.target.value)} className={`${input} mt-2`} /></label>
      <button disabled={busy} className="self-end rounded-md bg-[var(--accent)] px-5 py-2 font-bold text-[var(--accent-ink)]">Kuyruğu aç</button>
    </form>
    {error && <p role="alert" className="mt-5 text-red-400">{error}</p>}
    {items.length>0 && <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(240px,1fr)_minmax(0,1.5fr)]">
      <section aria-label="Öncelikli adaylar"><h2 className="mb-4 text-xl font-bold">Öncelikli adaylar</h2><div className="max-h-[70vh] overflow-y-auto border-y border-[var(--line)]">
        {items.map(item=><button key={item.career_id} type="button" onClick={()=>{setSelected(item);setReason('');setChecked(false);setSource('');setIdentity('');setMatchId('');setMatchDate('');setCompetition('');setSourceNote('');setIdentityNote('');}}
          className="block w-full border-b border-[var(--line)] px-3 py-4 text-left hover:bg-[var(--surface-2)] focus-visible:outline">
          <span className="block font-bold">{item.player_name} → {item.team_name}</span>
          <span className="mt-1 block text-xs text-[var(--muted)]">{item.status} · şimdi +{item.newPairsIfApproved} çift · potansiyel {item.possiblePairs}</span>
        </button>)}
      </div></section>
      {selected && <section aria-label="Aday incelemesi" className="min-w-0 border-t-2 border-[var(--accent)] bg-[var(--surface)] p-5 md:p-7">
        <h2 className="text-2xl font-black">{selected.player_name} / {selected.team_name}</h2>
        <p className="mt-2 break-all text-xs text-[var(--muted)]">{selected.player_id} · {selected.birth_date} · {selected.team_id}<br />{selected.career_id}</p>
        <a className="mt-4 inline-block break-all text-sm underline decoration-[var(--accent)]" href={selected.candidate_url} target="_blank" rel="noopener noreferrer">Wikidata aday kaynağı ↗</a>
        <p className="mt-2 text-sm text-[var(--muted)]">{selected.reason || 'Henüz karar yok.'}</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2">Resmî tamamlanmış maç URL’si<input className={`${input} mt-1`} value={source} onChange={e=>setSource(e.target.value)} /></label>
          {source.startsWith('https://') && <a className="text-sm underline sm:col-span-2" href={source} target="_blank" rel="noopener noreferrer">Maç kaynağını aç ↗</a>}
          <label className="text-sm sm:col-span-2">Maç kaynağı inceleme notu (en az 40 karakter)<textarea className={`${input} mt-1 min-h-20`} maxLength={800} value={sourceNote} onChange={e=>setSourceNote(e.target.value)} /></label>
          <label className="text-sm sm:col-span-2">Bağımsız kimlik URL’si (doğum tarihi)<input className={`${input} mt-1`} value={identity} onChange={e=>setIdentity(e.target.value)} /></label>
          {identity.startsWith('https://') && <a className="text-sm underline sm:col-span-2" href={identity} target="_blank" rel="noopener noreferrer">Kimlik kaynağını aç ↗</a>}
          <label className="text-sm sm:col-span-2">Kimlik kaynağı inceleme notu (en az 40 karakter)<textarea className={`${input} mt-1 min-h-20`} maxLength={800} value={identityNote} onChange={e=>setIdentityNote(e.target.value)} /></label>
          <label className="text-sm">Maç kimliği<input className={`${input} mt-1`} value={matchId} onChange={e=>setMatchId(e.target.value)} /></label>
          <label className="text-sm">Maç tarihi<input type="date" className={`${input} mt-1`} value={matchDate} onChange={e=>setMatchDate(e.target.value)} /></label>
          <label className="text-sm">Resmî yarışma<input className={`${input} mt-1`} value={competition} onChange={e=>setCompetition(e.target.value)} /></label>
          <label className="text-sm">Sahaya çıkma olayı<select className={`${input} mt-1`} value={event} onChange={e=>setEvent(e.target.value)}><option value="goal">Gol</option><option value="substituted-on">Oyuna girdi</option><option value="substituted-off">Oyundan çıktı</option><option value="minutes-played">Pozitif dakika</option></select></label>
          {event==='minutes-played' && <label className="text-sm">Oynanan dakika<input type="number" min="1" className={`${input} mt-1`} value={minutes} onChange={e=>setMinutes(e.target.value)} /></label>}
          <label className="text-sm sm:col-span-2">Karar gerekçesi<textarea className={`${input} mt-1 min-h-24`} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} /></label>
          <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)} />Maç, oyuncu kimliği ve erkek A takımını kaynakta kendim kontrol ettim.</label>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" disabled={busy || !checked || sourceNote.trim().length < 40 || identityNote.trim().length < 40 || reason.trim().length < 3} onClick={()=>void decide('approved')} className="rounded-md bg-[var(--accent)] px-4 py-2 font-bold text-[var(--accent-ink)] disabled:opacity-40">Tek bağı onayla</button>
          <button type="button" disabled={busy} onClick={()=>void decide('hold')} className="rounded-md border border-[var(--line)] px-4 py-2">Beklet</button>
          <button type="button" disabled={busy} onClick={()=>void decide('rejected')} className="rounded-md border border-red-700 px-4 py-2">Reddet</button>
        </div>
      </section>}
    </div>}
  </main>;
}
