'use client';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import type { CompetitiveRepository } from '@/server/competitive/repository';
import { RankBadge } from './rank-badge';
type Profile = Awaited<ReturnType<CompetitiveRepository['profile']>>;
const outcome = (value: string) => value === 'win' ? 'Galibiyet' : value === 'loss' ? 'Mağlubiyet' : 'Beraberlik';
export function CompetitiveProfile({ compact = false, revision = '', name = '', settings }: { compact?: boolean; revision?: string; name?: string; settings?: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null), [page, setPage] = useState(1);
  const [tab, setTab] = useState('Genel Bakış'), [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/competitive/me?page=${page}`, { cache: 'no-store', signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'İstatistikler okunamadı.');
      setProfile(data); setMessage(''); setLoading(false);
    }).catch(error => { if (!controller.signal.aborted) { setProfile(null); setMessage(error instanceof Error ? error.message : 'İstatistikler okunamadı.'); setLoading(false); } });
    return () => controller.abort();
  }, [revision, page]);
  const stat = profile?.ratings.find(item => item.mode === '3-2-1');
  const recent = (profile?.stats.recent ?? []) as { id: string; at: string; before: number; elo: number; outcome: string }[];
  const last10 = recent.slice(-10);
  const points = recent.length ? [recent[0].before, ...recent.map(item => item.elo)] : [];
  const low = Math.min(...points), high = Math.max(...points);
  const line = points.map((value, index) => `${index / Math.max(1, points.length - 1) * 600},${120 - (value - low) / Math.max(1, high - low) * 100}`).join(' ');
  const metrics = stat ? [['Maç', stat.played], ['Galibiyet', stat.wins], ['Mağlubiyet', stat.losses], ['Beraberlik', stat.draws], ['Kazanma', `%${stat.winRate}`]] : [];
  return <section className={`career ${compact ? 'career-compact' : ''}`} aria-label="Oyuncu profili">
    <header className="career-hero"><span className="profile-monogram" aria-hidden="true">{name ? name.slice(0, 1).toLocaleUpperCase('tr-TR') : 'G'}</span><div><h2>{name || 'Rekabetçi profil'}</h2><Link className="text-link" href="/siralama">{profile?.standing ? `#${profile.standing.rank} · Sıralama ↗` : 'Sıralama ↗'}</Link></div>{stat && <RankBadge rank={stat.rank} large/>}</header>
    {!compact && <nav className="profile-tabs" aria-label="Profil bölümleri">{['Genel Bakış', 'İstatistikler', 'Maç Geçmişi', ...(settings ? ['Hesap Ayarları'] : [])].map(item => <button key={item} aria-current={tab === item ? 'page' : undefined} onClick={() => { setTab(item); if (item === 'Genel Bakış' && page !== 1) { setLoading(true); setPage(1); } }}>{item}</button>)}</nav>}
    {tab === 'Hesap Ayarları' ? settings : <>
      {message && <p role="status">{message}</p>}{loading && <p role="status">Yükleniyor…</p>}
      {stat && (tab === 'Genel Bakış' || compact) && <><div className="rank-panel" style={{ borderColor: stat.rank.color }}><div><span className="eyebrow">{stat.league}</span><strong>{stat.elo}<small>ELO</small></strong></div><div className="rank-progress"><p>{stat.rank.next ? `${stat.rank.next} için ${stat.rank.remaining} ELO` : 'En yüksek lig'}</p><progress aria-label="Lig ilerlemesi" value={stat.rank.progress} max="100" style={{ color: stat.rank.color }}/></div></div><div className="career-metrics">{metrics.filter(item => item[0] !== 'Beraberlik').map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div></>}
      {stat && tab === 'İstatistikler' && <><div className="career-metrics">{[...metrics, ['En yüksek ELO', profile?.stats.peak ?? '—'], [profile?.stats.streak_outcome ? `${outcome(profile.stats.streak_outcome)} serisi` : 'Seri', profile?.stats.streak || '—'], ['Hükmen galibiyet', profile?.stats.forfeit_wins ?? 0], ['Hükmen mağlubiyet', profile?.stats.forfeit_losses ?? 0]].map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div><div className="elo-chart"><h3>ELO gelişimi</h3>{points.length ? <><svg viewBox="0 0 600 145" role="img" aria-label={`Son ${recent.length} maç ELO gelişimi: ${points[0]} → ${points.at(-1)}`}><path d="M0 125H600" stroke="currentColor" opacity=".15"/><polyline points={line} fill="none" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke"/></svg><div className="chart-range"><span>{new Date(recent[0].at).toLocaleDateString('tr-TR')}</span><span>{points.at(-1)} ELO</span></div></> : <p>Henüz maç yok.</p>}</div></>}
      {!compact && tab !== 'Maç Geçmişi' && <div className="recent-form"><h3>Son {last10.length} maç</h3><div>{last10.map(item => <span key={item.id} className={`form-${item.outcome}`} title={`${outcome(item.outcome)} · ${item.elo} ELO`}>{item.outcome === 'win' ? 'G' : item.outcome === 'loss' ? 'M' : 'B'}</span>)}{!last10.length && <p>Henüz maç yok.</p>}</div></div>}
      {!compact && profile && profile.page === page && tab !== 'İstatistikler' && <div className="career-history"><h3>{tab === 'Maç Geçmişi' ? 'Maç geçmişi' : 'Son maçlar'}</h3>{(tab === 'Maç Geçmişi' ? profile.history : profile.page === 1 ? profile.history.slice(0, 3) : []).map(match => {
        const won = match.winner === match.seat, result = match.winner === null ? 'Beraberlik' : won ? 'Galibiyet' : 'Mağlubiyet';
        const delta = match.elo_after - match.elo_before;
        return <details className={`history-match ${won ? 'match-win' : match.winner === null ? '' : 'match-loss'}`} key={match.id}><summary><span><b>{match.reason === 'forfeit' ? 'Hükmen ' : ''}{result}</b><small>{new Date(match.ended_at).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })}</small></span><span className="history-opponent"><strong>{match.opponent_name}</strong>{match.opponent_rank && <RankBadge rank={match.opponent_rank}/>}</span><strong>{match.seat === 0 ? `${match.score0} – ${match.score1}` : `${match.score1} – ${match.score0}`}</strong><b className="elo-delta">{delta >= 0 ? '+' : ''}{delta} ELO</b></summary><dl><div><dt>Tür</dt><dd>Rekabetçi · {match.mode}</dd></div><div><dt>ELO</dt><dd>{match.elo_before} → {match.elo_after}</dd></div><div><dt>Sonuç</dt><dd>{match.reason === 'forfeit' ? `Hükmen ${result.toLocaleLowerCase('tr-TR')}` : 'Normal bitiş'}</dd></div><div><dt>Tarih</dt><dd>{new Date(match.ended_at).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}</dd></div></dl></details>;
      })}{!profile.history.length && <p>Henüz tamamlanmış maç yok.</p>}{tab === 'Maç Geçmişi' && <div className="history-pagination"><button disabled={page === 1 || loading} onClick={() => { setLoading(true); setPage(value => value - 1); }}>Önceki</button><span>{page}</span><button disabled={!profile.hasNext || loading} onClick={() => { setLoading(true); setPage(value => value + 1); }}>Sonraki</button></div>}</div>}
    </>}
  </section>;
}
