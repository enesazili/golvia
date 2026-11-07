'use client';
import { useEffect, useState } from 'react';
import type { Rating } from '@/lib/rating';
type Board = { page: number; hasNext: boolean; items: (Rating & { rank: number; name: string })[] };
export function Leaderboard() {
  const [mode, setMode] = useState('3-2-1'), [page, setPage] = useState(1);
  const [board, setBoard] = useState<Board | null>(null), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/competitive?mode=${encodeURIComponent(mode)}&page=${page}`, { cache: 'no-store', signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Sıralama okunamadı.');
      setBoard(data); setError('');
    }).catch(error => { if (!controller.signal.aborted) { setBoard(null); setError(error instanceof Error ? error.message : 'Sıralama okunamadı.'); } });
    return () => controller.abort();
  }, [mode, page]);
  const current = board?.page === page ? board : null;
  return <section className="competitive-card"><label htmlFor="ranking-mode">Oyun modu</label><select id="ranking-mode" value={mode} onChange={event => { setMode(event.target.value); setPage(1); setBoard(null); }}><option value="3-2-1">3–2–1 ELO</option><option value="overall">Genel futbol puanı</option></select>
    {mode === 'overall' && <p>Genel puan: 1000 + (maç sayısıyla ağırlıklı ortalama ELO − 1000) × maç / (maç + 20). Performans ELO’ya yansır; az maçlı hesapların puanı 1000’e yaklaştırılır. Lig, oyun modunun ELO’suna göre belirlenir; genel puanın ayrı ligi yoktur.</p>}
    {error ? <p role="alert">{error}</p> : !current ? <p role="status">Sıralama yükleniyor…</p> : <div className="leaderboard-scroll" tabIndex={0} role="region" aria-label="Oyuncu sıralaması"><table className="leaderboard"><caption>{mode === 'overall' ? 'Genel futbol puanı' : '3–2–1 ELO'} · Sayfa {page}</caption><thead><tr><th scope="col">Sıra</th><th scope="col">Oyuncu</th><th scope="col">{mode === 'overall' ? 'Puan' : 'ELO'}</th><th scope="col">Galibiyet</th><th scope="col">Mağlubiyet</th><th scope="col">Beraberlik</th><th scope="col">Maç</th><th scope="col">Kazanma</th><th scope="col">Lig</th></tr></thead><tbody>{current.items.map(item => <tr key={item.rank}><td>{item.rank}</td><th scope="row">{item.name}</th><td>{item.elo}</td><td>{item.wins}</td><td>{item.losses}</td><td>{item.draws}</td><td>{item.played}</td><td>%{item.winRate}</td><td>{mode === 'overall' ? '—' : item.league}</td></tr>)}</tbody></table>{current.items.length === 0 && <p>Henüz sıralamaya giren oyuncu yok.</p>}</div>}
    <div className="account-actions"><button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Önceki</button><span aria-live="polite">Sayfa {page}</span><button type="button" disabled={!current?.hasNext || page >= 10000} onClick={() => setPage(value => value + 1)}>Sonraki</button></div>
  </section>;
}
