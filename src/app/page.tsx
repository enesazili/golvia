import Link from 'next/link';

export default function Home() {
  return <main id="main" className="home">
    <section className="home-hero" aria-labelledby="home-title">
      <div className="home-lead"><div className="home-overline"><span className="signal-dot" /> GOLVIA / OYUN ALANI <span>OYUN 01</span></div>
        <h1 id="home-title">Futbolu<br /><em>okuyabilir</em><br />misin?</h1>
        <p>İki kulüp ya da ülke seçilir. Ortak futbolcuyu ilk bulan puanı alır. Üç puan maçı bitirir.</p>
        <div className="home-actions"><Link className="button home-primary" href="/oyun/3-2-1">Oyna <span aria-hidden="true">↗</span></Link><a className="home-secondary" href="#nasil-oynanir">Kuralları gör <span aria-hidden="true">↓</span></a></div>
        <span className="home-access">Misafir maçına hemen katıl. Hesap gerekmez.</span>
      </div>
      <div className="home-field" aria-hidden="true"><div className="field-line" /><div className="field-circle" /><div className="field-box" /><div className="field-score"><span>GOLVIA / OYUN 01</span><strong>3<span>—</span>2<span>—</span>1</strong><small>SEÇ · BUL · KAZAN</small></div></div>
    </section>
    <section id="oyunlar" className="home-fixture" aria-labelledby="fixture-title"><div className="fixture-heading"><span>OYUN 01</span><h2 id="fixture-title">Bugünün maçı</h2></div><Link className="fixture-row" href="/oyun/3-2-1"><span className="fixture-number">3—2—1</span><span className="fixture-description"><strong>Ortak futbolcuyu bul.</strong><small>1v1 çevrim içi maç veya antrenman · Tek cevap hakkı</small></span><span className="fixture-arrow" aria-hidden="true">↗</span></Link></section>
    <section id="nasil-oynanir" className="home-rules" aria-labelledby="rules-title"><div><span className="section-index">OYUN PLANI / 03 ADIM</span><h2 id="rules-title">Saha çizgileri<br />belli.</h2></div><ol><li><span>01 / SEÇ</span><p>Hazırlıktan sonra 3 saniyede kulüp veya ülke seç.</p></li><li><span>02 / BUL</span><p>İki seçimle bağlantılı futbolcuyu 15 saniyede bul.</p></li><li><span>03 / KAZAN</span><p>İlk doğru cevap bir puan. Üç puana ulaşan kazanır.</p></li></ol></section>
  </main>;
}
