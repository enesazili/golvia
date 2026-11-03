'use client';
import { useQuickMatch } from '@/hooks/useQuickMatch';
import { PracticeGame } from './practice-game';
export function GameClient() {
  const match = useQuickMatch();
  const remote = match.socket && match.matchId && match.playerId
    ? { socket: match.socket, matchId: match.matchId, playerId: match.playerId, seat: match.seat } : undefined;
  return <>
    <section className={`match-entry entry-${match.status}`} aria-label="Hızlı maç">
      <div className="entry-status"><span className="entry-index">01 / 1V1</span><strong>{match.status === 'queue' ? 'Rakip aranıyor' : match.status === 'reconnecting' ? 'Bağlantı yenileniyor' : match.status === 'opponent-wait' ? 'Rakip bekleniyor' : match.status === 'restarted' ? 'Maç iptal edildi' : match.status === 'error' ? 'Bağlantı koptu' : remote ? 'Rakip bulundu' : 'Hızlı maç'}</strong><p role="status">{match.status === 'queue' ? 'Eşleşme için sahadayız…' : match.status === 'reconnecting' ? 'Maça geri dönmeye çalışıyoruz…' : match.status === 'opponent-wait' ? 'Rakibin yeniden bağlanmasını bekliyoruz…' : match.status === 'restarted' ? 'Sunucu yeniden başladı. Eski maç artık geçerli değil.' : match.status === 'error' ? 'Yeniden rakip arayabilirsin.' : remote ? 'Maç alanı hazır. HAZIRIM dediğinde başlar.' : 'Çevrim içi rakip bul veya antrenmana geç.'}</p></div>
      {(match.status === 'idle' || match.status === 'error' || match.status === 'restarted') && <button className="button small" onClick={() => void match.start()}>Rakip bul <span aria-hidden="true">↗</span></button>}
      {(match.status === 'queue' || match.status === 'matched' || match.status === 'opponent-wait' || match.status === 'reconnecting') && <button className="button small" onClick={match.cancel}>İptal Et</button>}
    </section>
    <PracticeGame key={remote?.matchId ?? 'practice'} remote={remote} onRematch={() => { match.cancel(); void match.start(); }} />
  </>;
}
