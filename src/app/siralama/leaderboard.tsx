'use client';
import { useEffect, useState } from 'react';
import type { Rating } from '@/lib/rating';
import { RankBadge } from '@/features/competitive/rank-badge';
type Entry = Omit<Rating, 'rank'> & { rank: number; name: string; badge: Rating['rank'] };
type Board = { page: number; hasNext: boolean; items: Entry[]; self: Entry | null };
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
  return <section className="competitive-card"><label htmlFor="ranking-mode">Sıralama</label><select id="ranking-mode" value={mode} onChange={event => { setMode(event.target.value); setPage(1); setBoard(null); }}><option value="3-2-1">3–2–1 ELO</option><option value="overall">Genel puan</option></select>
    {mode === 'overall' && <p className="fine-print">Maç sayısıyla ağırlıklandırılmış genel puan.</p>}
    {current?.self && <button className="self-standing" onClick={() => { const target = Math.ceil(current.self!.rank / 20); if (target !== page) { setPage(target); setBoard(null); } }}><strong>#{current.self.rank}</strong><span>{current.self.name}</span><b>{current.self.elo} {mode === 'overall' ? 'puan' : 'ELO'}</b><span>Sırama git ↗</span></button>}
    {error ? <p role="alert">{error}</p> : !current ? <p role="status">Sıralama yükleniyor…</p> : <div className="leaderboard-scroll" tabIndex={0} role="region" aria-label="Oyuncu sıralaması"><table className="leaderboard"><caption>{mode === 'overall' ? 'Genel puan' : '3–2–1 ELO'} · Sayfa {page}</caption><thead><tr><th scope="col">Sıra</th><th scope="col">Oyuncu</th><th scope="col">Rank</th><th scope="col">{mode === 'overall' ? 'Puan' : 'ELO'}</th><th scope="col">Maç</th><th scope="col">Kazanma</th></tr></thead><tbody>{current.items.map(item => <tr key={item.rank} className={item.rank === current.self?.rank ? 'is-self' : ''}><td>{item.rank}</td><th scope="row">{item.name}</th><td>{mode === 'overall' ? '—' : <RankBadge rank={item.badge}/>}</td><td><b>{item.elo}</b></td><td>{item.played}</td><td>%{item.winRate}</td></tr>)}</tbody></table>{current.items.length === 0 && <p>Henüz sıralamaya giren oyuncu yok.</p>}</div>}
    <div className="history-pagination"><button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Önceki</button><span aria-live="polite">{page}</span><button type="button" disabled={!current?.hasNext || page >= 10000} onClick={() => setPage(value => value + 1)}>Sonraki</button></div>
  </section>;
}
