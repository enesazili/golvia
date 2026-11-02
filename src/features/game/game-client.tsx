'use client';
import { useQuickMatch } from '@/hooks/useQuickMatch';
import { PracticeGame } from './practice-game';
export function GameClient() {
  const match = useQuickMatch();
  const remote = match.socket && match.matchId && match.playerId
    ? { socket: match.socket, matchId: match.matchId, playerId: match.playerId, seat: match.seat } : undefined;
  return <>
    <section className="preview-note" aria-label="Hızlı maç">
      <div><strong>3-2-1 · Hızlı maç</strong><p role="status">{match.status === 'queue' ? 'Rakip aranıyor…' : match.status === 'reconnecting' ? 'Bağlantı yenileniyor…' : match.status === 'opponent-wait' ? 'Rakibin yeniden bağlanması bekleniyor…' : match.status === 'error' ? 'Maç bağlantısı kapandı. Yeniden deneyebilirsin.' : remote ? 'Rakibinle eşleştin.' : 'Çevrim içi rakip bul veya aşağıda antrenman yap.'}</p></div>
      {(match.status === 'idle' || match.status === 'error') && <button className="button small" onClick={() => void match.start()}>Hızlı Maç Başlat</button>}
      {(match.status === 'queue' || match.status === 'matched' || match.status === 'opponent-wait' || match.status === 'reconnecting') && <button className="button small" onClick={match.cancel}>İptal Et</button>}
    </section>
    <PracticeGame key={remote?.matchId ?? 'practice'} remote={remote} onRematch={() => { match.cancel(); void match.start(); }} />
  </>;
}
