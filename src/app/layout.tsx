import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Header } from '@/components/header';
import Link from 'next/link';
import { legalLinks } from '@/lib/legal';
import './globals.css';
export const metadata: Metadata = { title: { default: 'Golvia — 3-2-1 futbol oyunu', template: '%s | Golvia' }, description: 'İki seçim, ortak bir futbolcu. Golvia 3-2-1 ile çevrim içi rakip bul veya antrenman yap.', ...(process.env.GOLVIA_PUBLIC_ORIGIN ? { metadataBase: new URL(process.env.GOLVIA_PUBLIC_ORIGIN) } : {}), openGraph: { title: 'Golvia — 3-2-1', description: 'Futbol bilgini sahaya çıkar. Üç puana ulaş, maçı kazan.', type: 'website' } };
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The CSP nonce is issued by src/proxy.ts for every document request. Reading headers also
  // opts all rendered pages into dynamic rendering, which nonce-based CSP requires.
  await headers();
  return <html lang="tr"><body><a className="skip-link" href="#main">İçeriğe geç</a><div className="site-shell"><Header />{children}<footer><span>© Golvia</span><nav aria-label="Yasal bilgiler">{legalLinks.map(([slug, title]) => <Link key={slug} href={`/yasal/${slug}`}>{title}</Link>)}</nav></footer></div></body></html>;
}

