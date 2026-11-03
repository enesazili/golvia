import type { Metadata } from 'next';
import { Header } from '@/components/header';
import './globals.css';
import './redesign.css';
export const metadata: Metadata = { title: { default: 'Golvia — 3-2-1 futbol oyunu', template: '%s | Golvia' }, description: 'İki seçim, ortak bir futbolcu. Golvia 3-2-1 ile çevrim içi rakip bul veya antrenman yap.', ...(process.env.GOLVIA_PUBLIC_ORIGIN ? { metadataBase: new URL(process.env.GOLVIA_PUBLIC_ORIGIN) } : {}), openGraph: { title: 'Golvia — 3-2-1', description: 'Futbol bilgini sahaya çıkar. Üç puana ulaş, maçı kazan.', type: 'website' } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="tr" data-theme="dark" suppressHydrationWarning><body><script dangerouslySetInnerHTML={{ __html: `try{document.documentElement.dataset.theme=localStorage.getItem('golvia-theme')||'dark'}catch{}` }} /><a className="skip-link" href="#main">İçeriğe geç</a><div className="site-shell"><Header />{children}<footer><LinkMark /><span>Futbol. Hız. Hafıza.</span><span>© Golvia</span></footer></div></body></html>;
}
function LinkMark() { return <span className="footer-brand">GOLVIA</span>; }

