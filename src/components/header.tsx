'use client';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';
const subscribe = (callback: () => void) => { window.addEventListener('golvia-theme', callback); return () => window.removeEventListener('golvia-theme', callback); };
export function Header() {
  const theme = useSyncExternalStore(subscribe, () => document.documentElement.dataset.theme ?? 'dark', () => 'dark');
  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('golvia-theme', next); } catch {}
    window.dispatchEvent(new Event('golvia-theme'));
  }
  return <header className="header"><Link className="brand" href="/" aria-label="Golvia ana sayfa"><span className="brand-icon" aria-hidden="true">G<span>·</span></span>GOLVIA</Link><nav aria-label="Ana gezinme"><Link href="/#oyunlar">Oyun</Link><Link href="/#nasil-oynanir">Kurallar</Link><Link href="/hesap">Hesap</Link></nav><div className="header-actions"><button className="theme-toggle" onClick={toggle} aria-label={theme === 'dark' ? 'Açık temaya geç' : 'Koyu temaya geç'}>{theme === 'dark' ? '☼' : '☾'}</button><Link href="/oyun/3-2-1" className="button small">Oyna <span aria-hidden="true">↗</span></Link></div></header>;
}

