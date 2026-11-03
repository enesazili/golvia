'use client';
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) { return <main id="main" className="status-page"><span className="eyebrow">GOLVIA / BAĞLANTI</span><h1>Oyun durdu.</h1><p>Sayfa şu anda açılamıyor. Birazdan tekrar dene.</p><button className="button" onClick={reset}>Yeniden dene ↻</button></main>; }
