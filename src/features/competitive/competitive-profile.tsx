'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Rating } from '@/lib/rating';
type Profile = { ratings: Rating[]; history: { id: string; mode: string; ended_at: string; score0: number; score1: number; winner: number | null; reason: string; seat: number; elo_before: number; elo_after: number }[] };
export function CompetitiveProfile({ compact = false, revision = '' }: { compact?: boolean; revision?: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [message, setMessage] = useState('İstatistikler yükleniyor…');
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/competitive/me', { cache: 'no-store', signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'İstatistikler okunamadı.');
      setProfile(data); setMessage('');
    }).catch(error => { if (!controller.signal.aborted) { setProfile(null); setMessage(error instanceof Error ? error.message : 'İstatistikler okunamadı.'); } });
    return () => controller.abort();
  }, [revision]);
  return <section className="competitive-card" aria-label="Rekabetçi istatistikler"><div className="competitive-heading"><h2>{compact ? 'Rekabetçi profilin' : 'Maç istatistiklerin'}</h2><Link className="text-link" href="/siralama">Liderlik tablosu ↗</Link></div>
    {message && <p role="status">{message} <Link href="/hesap">Hesap</Link></p>}
    {profile?.ratings.map(stat => <div className="competitive-stats" key={stat.mode}><strong>{stat.mode} · {stat.elo} ELO · {stat.league}</strong><span>{stat.played} maç · {stat.wins} galibiyet · {stat.losses} mağlubiyet · {stat.draws} beraberlik · %{stat.winRate} kazanma</span></div>)}
    {!compact && profile && <><h3>Son maçlar</h3>{profile.history.length === 0 ? <p>Henüz tamamlanmış rekabetçi maçın yok.</p> : <ul className="match-history">{profile.history.map(match => <li key={match.id}><time dateTime={match.ended_at}>{new Date(match.ended_at).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })}</time><span>{match.mode} · {match.seat === 0 ? `${match.score0}–${match.score1}` : `${match.score1}–${match.score0}`} · {match.winner === null ? 'Beraberlik' : `${match.reason === 'forfeit' ? 'Hükmen ' : ''}${match.winner === match.seat ? 'galibiyet' : 'mağlubiyet'}`}</span><strong>{match.elo_after} ELO ({match.elo_after - match.elo_before >= 0 ? '+' : ''}{match.elo_after - match.elo_before})</strong></li>)}</ul>}</>}
  </section>;
}
