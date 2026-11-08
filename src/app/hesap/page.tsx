import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { accountConfiguration, activeSession } from '@/server/auth';
import { AccountClient } from './account-client';
import { CompetitiveProfile } from '@/features/competitive/competitive-profile';
import { TERMS_VERSION } from '@/lib/legal';

export const metadata: Metadata = { title: 'Hesap', description: 'Golvia hesabını yönet.' };
export const dynamic = 'force-dynamic';
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ token?: string; authError?: string }> }) {
  const query = await searchParams;
  const token = query.token ?? '';
  const config = accountConfiguration();
  let available = config.database && config.secret && config.origin;
  let user: { name: string; username?: string | null; email: string; emailVerified: boolean; termsAccepted: boolean } | null = null;
  if (available) {
    try {
      const session = await activeSession(await headers());
      user = session?.user ? { name: session.user.name, username: 'username' in session.user ? String(session.user.username ?? '') : null, email: session.user.email, emailVerified: session.user.emailVerified, termsAccepted: session.user.termsVersion === TERMS_VERSION } : null;
    } catch { available = false; }
  }
  return <main id="main" className="account-page"><div className="account-heading"><span className="eyebrow">GOLVIA / HESAP</span><h1>{user ? 'Senin oyunun.' : 'Sahadaki yerin.'}</h1></div><AccountClient available={available} mailReady={config.mail} googleReady={config.google} user={user} resetToken={token} authError={!!query.authError} />{user?.emailVerified && <CompetitiveProfile />}</main>;
}
