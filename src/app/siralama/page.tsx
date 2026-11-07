import type { Metadata } from 'next';
import { Leaderboard } from './leaderboard';
export const metadata: Metadata = { title: 'Liderlik tablosu', description: 'Golvia rekabetçi ELO ve lig sıralaması.' };
export default function LeaderboardPage() {
  return <main id="main" className="account-page"><div className="account-heading"><span className="eyebrow">GOLVIA / REKABET</span><h1>Liderlik tablosu.</h1><p>Lig, güncel ELO değerinden hesaplanır. Yalnız tamamlanan rekabetçi maçlar sayılır.</p></div><Leaderboard /></main>;
}
