'use client';
import { useEffect, useState } from 'react';
import { useQuickMatch } from '@/hooks/useQuickMatch';
import { PracticeGame } from './practice-game';
import { CompetitiveProfile } from '@/features/competitive/competitive-profile';
export function GameClient() {
  const match = useQuickMatch();
  const [now, setNow] = useState(0);
  useEffect(() => { if (!match.opponentDeadline) return; const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, [match.opponentDeadline]);
  const grace = match.opponentDeadline ? Math.max(0, Math.min(30, Math.ceil((match.opponentDeadline - now) / 1000))) : 0;
  const remote = match.socket && match.matchId && match.playerId
    ? { socket: match.socket, matchId: match.matchId, playerId: match.playerId, seat: match.seat, kind: match.kind, ranked: match.ranked } : undefined;
  return <>
    <section className={`match-entry entry-${match.status}`} aria-label="Hızlı maç">
      <div className="entry-status"><span className="entry-index">01 / 1V1</span><strong>{match.status === 'queue' ? 'Rakip aranıyor' : match.status === 'reconnecting' ? 'Bağlantı yenileniyor' : match.status === 'opponent-wait' ? 'Rakip bekleniyor' : match.status === 'forfeit' ? 'Hükmen sonuç' : match.status === 'restarted' ? 'Maç iptal edildi' : match.status === 'error' ? 'Bağlantı koptu' : remote ? 'Rakip bulundu' : 'Hızlı maç'}</strong><p role="status">{match.status === 'queue' ? 'Eşleşme için sahadayız…' : match.status === 'reconnecting' ? 'Maça geri dönmeye çalışıyoruz…' : match.status === 'opponent-wait' ? `Rakibin yeniden bağlanması için ${grace} saniye kaldı.` : match.status === 'forfeit' ? match.ranked?.winner === match.seat ? 'Hükmen galip geldin.' : 'Hükmen mağlup oldun.' : match.status === 'restarted' ? 'Sunucu yeniden başladı. Eski maç artık geçerli değil.' : match.status === 'error' ? 'Yeniden rakip arayabilirsin.' : remote ? 'Maç alanı hazır. HAZIRIM dediğinde başlar.' : 'Çevrim içi rakip bul veya antrenmana geç.'}</p></div>
      {(match.status === 'idle' || match.status === 'error' || match.status === 'restarted') && <div className="account-actions"><button className="button small" onClick={() => void match.start('ranked')}>Rekabetçi oyna ↗</button><button className="button small" onClick={() => void match.start('casual')}>Puansız rakip bul ↗</button></div>}
      {(match.status === 'queue' || match.status === 'matched' || match.status === 'opponent-wait' || match.status === 'reconnecting' || match.status === 'forfeit') && <button className="button small" onClick={() => void match.cancel()}>{match.ranked?.status === 'completed' ? 'Maçtan çık' : 'İptal Et'}</button>}
    </section>
    {match.error && <p className="competitive-notice" role="alert">{match.error}</p>}
    <div className="competitive-summary"><CompetitiveProfile compact revision={match.ranked?.matchId} /><p>Rekabetçi maç doğrulanmış hesap ister. Kopmada 30 saniye dönüş hakkı vardır; oyun saati durmaz. Aktif maçtan ayrılmak veya süresinde dönememek hükmen mağlubiyettir. İki oyuncu da kaybolursa ELO değişmez.</p></div>
    <PracticeGame key={remote?.matchId ?? 'practice'} remote={remote} onRematch={() => { void match.cancel().then(cancelled => { if (cancelled) void match.start(match.kind); }); }} />
  </>;
}
