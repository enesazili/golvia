import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { accountConfiguration, getAuth } from '@/server/auth';
import { AccountClient } from './account-client';

export const metadata: Metadata = { title: 'Hesap', description: 'Golvia hesabını yönet.' };
export const dynamic = 'force-dynamic';
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token ?? '';
  const config = accountConfiguration();
  let available = config.database && config.secret && config.origin;
  let user: { name: string; username?: string | null; email: string; emailVerified: boolean } | null = null;
  if (available) {
    try {
      const session = await getAuth().api.getSession({ headers: await headers() });
      const status = session?.user && 'status' in session.user ? String(session.user.status) : 'active';
      user = session?.user && status === 'active' ? { name: session.user.name, username: 'username' in session.user ? String(session.user.username ?? '') : null, email: session.user.email, emailVerified: session.user.emailVerified } : null;
    } catch { available = false; }
  }
  return <main id="main" className="account-page"><div className="account-heading"><span className="eyebrow">GOLVIA / HESAP</span><h1>Oyuncu alanı.</h1><p>Misafir maçları hesap olmadan oynayabilirsin.</p></div><AccountClient available={available} mailReady={config.mail} user={user} resetToken={token} /></main>;
}
