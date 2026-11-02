import type { Metadata } from 'next';
import { Header } from '@/components/header';
import './globals.css';
export const metadata: Metadata = { title: { default: 'Golvia — Futbol bilgini sahaya çıkar.', template: '%s | Golvia' }, description: 'Futbol bilgisinin oyunla buluştuğu yer. Golvia 3-2-1 oyun alanını keşfet.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="tr" data-theme="dark" suppressHydrationWarning><body><script dangerouslySetInnerHTML={{ __html: `try{document.documentElement.dataset.theme=localStorage.getItem('golvia-theme')||'dark'}catch{}` }} /><a className="skip-link" href="#main">İçeriğe geç</a><div className="site-shell"><Header />{children}<footer><LinkMark /><span>Futbolu bilenlerin oyun alanı.</span><span>3-2-1 · 1v1 futbol oyunu</span></footer></div></body></html>;
}
function LinkMark() { return <span className="footer-brand">golvia<span>®</span></span>; }

