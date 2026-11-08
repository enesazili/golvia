import Link from 'next/link';
import { headers } from 'next/headers';
import { activeSession } from '@/server/auth';
import { version } from '../../package.json';
export async function Header() {
  let name = '';
  try { name = (await activeSession(await headers()))?.user.name ?? ''; } catch { /* Practice remains available when account services are offline. */ }
  return <header className="header"><div className="brand-lockup"><Link className="brand" href="/" aria-label="Golvia oyun alanı"><span className="brand-icon" aria-hidden="true">G<span /></span>GOLVIA</Link><span className="app-version">v{version}</span></div><Link className="account-icon" href="/hesap" aria-label={name ? `${name}, hesabım` : 'Hesabım'}>{name ? <span>{name.slice(0, 2).toLocaleUpperCase('tr-TR')}</span> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg>}</Link></header>;
}
