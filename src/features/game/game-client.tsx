'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuickMatch } from '@/hooks/useQuickMatch';
import { PracticeGame } from './practice-game';
import { TERMS_VERSION } from '@/lib/legal';
import { guestName } from '@/lib/guest';
type Viewer = { name: string; verified: boolean; termsAccepted: boolean };
export function GameClient({ viewer = null }: { viewer?: Viewer | null }) {
  const match = useQuickMatch();
  const [mode, setMode] = useState<'practice' | 'live'>('practice');
  const currentMode = match.socket ? 'live' : mode;
  const [identityOpen, setIdentityOpen] = useState(false);
  const [guest, setGuest] = useState(false), [name, setName] = useState(''), [accepted, setAccepted] = useState(false);
  const [now, setNow] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (identityOpen) dialog.current?.showModal(); else dialog.current?.close(); }, [identityOpen]);
  useEffect(() => { if (!match.opponentDeadline) return; const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, [match.opponentDeadline]);
  const grace = match.opponentDeadline ? Math.max(0, Math.min(30, Math.ceil((match.opponentDeadline - now) / 1000))) : 0;
  const remote = match.socket && match.matchId && match.playerId ? { socket: match.socket, matchId: match.matchId, playerId: match.playerId, seat: match.seat, kind: match.kind, ranked: match.ranked } : undefined;
  async function changeMode(next: 'practice' | 'live') {
    if (next === currentMode) return;
    if (match.socket && !await match.cancel()) return;
    setMode(next);
    if (next === 'live' && !viewer) setIdentityOpen(true);
  }
  function findOpponent() {
    if (viewer?.verified && viewer.termsAccepted) void match.start('ranked');
    else setIdentityOpen(true);
  }
  const status = match.status === 'queue' ? 'Rakip aranıyor…' : match.status === 'reconnecting' ? 'Yeniden bağlanılıyor…' : match.status === 'opponent-wait' ? `Rakip bekleniyor · ${grace}s` : match.status === 'restarted' ? 'Maç kapandı. Yeniden başlayabilirsin.' : '';
  return <main id="main" className="play-page">
    <div className="play-toolbar"><div className="mode-switch" role="group" aria-label="Oyun türü"><button disabled={!!remote && match.ranked?.status !== 'completed'} aria-pressed={currentMode === 'practice'} onClick={() => void changeMode('practice')}>Antrenman</button><button aria-pressed={currentMode === 'live'} onClick={() => void changeMode('live')}><span className="online-dot"/>Canlı Maç</button></div><Link href="/siralama" className="standings-link" aria-label="Liderlik tablosu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M8 3h8v5a4 4 0 0 1-8 0V3Zm0 2H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4m-4 1v6m-4 3h8"/></svg><span>Sıralama</span></Link></div>
    {currentMode === 'live' && status && <div className="connection-strip" role="status"><span className="online-dot"/>{status}</div>}
    {currentMode === 'live' && match.error && <p className="game-notice" role="alert">{match.error}</p>}
    <PracticeGame key={`${currentMode}:${remote?.matchId ?? 'idle'}`} live={currentMode === 'live'} remote={currentMode === 'live' ? remote : undefined} localName={viewer?.name || name || 'Sen'} opponentName={match.opponentName} waiting={currentMode === 'live' && ['queue', 'reconnecting'].includes(match.status)} onStart={findOpponent} onRematch={() => { void match.cancel().then(done => { if (done) void match.start(match.kind, name); }); }} />
    {currentMode === 'live' && match.socket && match.status !== 'forfeit' && <button className="quiet-button leave-match" onClick={() => void match.cancel()}>Maçtan ayrıl</button>}
    <details className="game-rules"><summary>Kurallar</summary><ol><li>3 saniyede kulüp veya ülke seç.</li><li>İki seçimde de oynamış futbolcuyu 15 saniyede bul. Yanlışsa tekrar deneyebilirsin.</li><li>İlk doğru cevap bir puan; 3 puana ulaşan kazanır.</li></ol>{currentMode === 'live' && <p>Rekabetçi maçta ayrılmak veya kopmada 30 saniyede dönememek hükmen mağlubiyettir. İki taraf da yoksa ELO değişmez.</p>}</details>
    <dialog ref={dialog} className="identity-dialog" aria-labelledby="identity-title" onCancel={() => setIdentityOpen(false)} onClose={() => setIdentityOpen(false)}><button className="dialog-close" aria-label="Kapat" onClick={() => setIdentityOpen(false)}>×</button><span className="eyebrow">CANLI MAÇ</span><h2 id="identity-title">{guest ? 'Sahadaki adın?' : 'Nasıl devam edelim?'}</h2>{!guest ? <div className="identity-options"><Link className="button" href="/hesap">Hesapla devam et <span>↗</span></Link>{viewer ? <p>{viewer.verified ? 'Rekabetçi maç için güncel koşulları hesabından onayla.' : 'Rekabetçi maç için e-postanı doğrula.'}</p> : <button className="secondary-button" onClick={() => setGuest(true)}>Misafir olarak oyna</button>}</div> : <form onSubmit={event => { event.preventDefault(); const valid = guestName(name); if (!valid || !accepted) return; setName(valid); setIdentityOpen(false); void match.start('casual', valid); }}><label htmlFor="guest-name">Oyuncu adı<input autoFocus id="guest-name" autoComplete="nickname" minLength={2} maxLength={24} required value={name} onChange={event => setName(event.target.value)}/></label><label className="check-label"><input type="checkbox" checked={accepted} required onChange={event => setAccepted(event.target.checked)}/><span><Link href="/yasal/kosullar" target="_blank">Kullanım Koşulları</Link>’nı kabul ediyorum.</span></label><p className="fine-print"><Link href="/yasal/kvkk" target="_blank">KVKK aydınlatması</Link> · Adın rakibine görünür. Misafir oturumun geçicidir; ELO tutulmaz.</p><button className="button" disabled={!accepted || !guestName(name)}>Rakip bul <span>↗</span></button><input type="hidden" value={TERMS_VERSION} readOnly/></form>}</dialog>
  </main>;
}
