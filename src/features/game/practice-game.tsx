'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePractice, type RemoteMatch } from './use-practice';

export function PracticeGame({ remote, onRematch }: { remote?: RemoteMatch; onRematch?: () => void } = {}) {
  const game = usePractice(remote);
  const { view, teams, pending } = game;
  const input = useRef<HTMLInputElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const phase = view?.phase ?? 'lobby';
  useEffect(() => { if (phase === 'countdown' || phase === 'select' || phase === 'answer') input.current?.focus(); }, [phase, view?.round, view?.attempt]);
  const me = remote?.seat ?? 0, opponent = me === 0 ? 1 : 0;
  const score = view ? [view.score[me], view.score[opponent]] : [0, 0];
  const choices = view ? [view.choices[me], view.choices[opponent]] : [null, null];
  const named = (id: string | null) => id ? teams.find(team => team.id === id)?.name ?? id : null;
  const outcome = view?.outcome;
  const choosing = phase === 'select', answering = phase === 'answer';
  const locked = choosing && !!choices[0];
  const canSearch = (phase === 'ready' && !!view && !view.ready[me]) || phase === 'countdown' || (choosing && !locked) || (answering && !view?.answered[me]);
  const resultText = outcome ? ({
    correct: outcome.winner === me ? 'Doğru cevap. Puan senin!' : 'Rakibin doğru cevabı verdi.',
    'both-wrong': 'İki cevap da yanlış. Puan yok.',
    timeout: 'Süre doldu. Bu tur puansız.',
    'missing-selection': outcome.winner === me ? 'Rakip seçim yapmadı. Bir puan kazandın.' : 'Seçim yapmadın. Puan rakibin.',
    no_selection: 'İki oyuncu da seçim yapmadı. Tur puansız.',
    'same-selection': 'Aynı takım seçildi. Yeniden deneyeceğiz.',
    afk: outcome.winner === me ? 'Rakip hazır olmadı. Maç sona erdi.' : outcome.winner === opponent ? 'Hazır olmadığın için maç sona erdi.' : 'İki oyuncu da hazır olmadı. Maç sona erdi.'
  }[outcome.reason]) : '';
  const title = phase === 'lobby' ? remote ? 'Maç yükleniyor…' : 'Sahaya çıkmaya hazır mısın?'
    : phase === 'ready' ? view?.ready[me] ? 'Rakibin hazırlanıyor.' : 'Yeni tur için hazır mısın?'
    : phase === 'countdown' ? 'Başlıyoruz.' : phase === 'select' ? locked ? 'Seçimin kilitlendi.' : 'Kulübünü veya ülkeni seç.'
    : phase === 'reveal' ? 'Karşılaşma belli oldu.' : phase === 'answer' ? view?.answered[me] ? 'Cevap hakkını kullandın.' : 'Ortak futbolcuyu bul.'
    : phase === 'result' ? 'Tur sonucu' : view?.winner === me ? 'Maçı kazandın!' : view?.winner === opponent ? 'Maçı rakibin kazandı.' : 'Maç sona erdi.';
  const stageLabel = { lobby: 'MAÇ ALANI', ready: 'HAZIRLIK', countdown: 'BAŞLANGIÇ', select: 'KULÜP SEÇİMİ', reveal: 'KARŞILAŞMA', answer: 'ORTAK FUTBOLCU', result: 'TUR SONUCU', finished: 'MAÇ SONUCU' }[phase];
  const pick = (index: number) => {
    const item = game.options[index];
    if (item && !pending && canSearch && (choosing || answering)) game.act(choosing ? 'choose' : 'answer', item.id);
  };
  return <main id="main" className="arena">
    <div className="arena-breadcrumb"><Link href="/">← Oyun alanı</Link><span className="tag">{remote ? 'ÇEVRİM İÇİ · 1V1' : 'SUNUCU MOTORU · ANTRENMAN'}</span></div>
    <div className="arena-heading"><div><div className="eyebrow">BİLGİNİ KONUŞTUR</div><h1>3–2–1<span>.</span></h1></div><p>İki seçim arasındaki futbolcuyu bul.<br />İlk 3 puan, maçın sahibi.</p></div>
    <div className="arena-layout"><section className="match-panel" aria-label={remote ? 'Çevrim içi maç' : 'Antrenman maçı'}>
      <div className="match-meta"><span><span className="live-dot" /> {remote ? 'CANLI MAÇ' : 'ANTRENMAN SAHASI'}</span><span>TUR {String(view?.round ?? 1).padStart(2, '0')}{view && view.attempt > 1 ? ` · TEKRAR ${view.attempt}` : ''}</span></div>
      <div className="scoreboard"><div className="competitor"><span className="avatar">S</span><strong>Sen</strong><small>{remote ? 'Çevrim içi oyuncu' : 'Antrenman oyuncusu'}</small></div><div className="score" key={`${score[0]}:${score[1]}`} aria-label={`Skor ${score[0]} - ${score[1]}`}><span>{score[0]}</span><i>:</i><span>{score[1]}</span><small>HEDEF 3 PUAN</small></div><div className="competitor"><span className="avatar rival">G</span><strong>{remote ? 'Rakibin' : 'Antrenman rakibi'}</strong><small>{remote ? 'Çevrim içi oyuncu' : 'Simülasyon · Cevap vermez'}</small></div></div>
      <div className={`match-stage stage-${phase}`}><div className="stage-heading"><span className="eyebrow">{stageLabel}</span><span className={`timer ${game.remaining <= 3 && (choosing || answering) ? 'urgent' : ''}`} aria-label={`${game.remaining} saniye`}>{phase === 'finished' || phase === 'lobby' ? '—' : `${game.remaining}s`}</span></div>
        <h2 aria-live="polite">{title}</h2>
        {phase === 'lobby' && !remote && <div className="ready-area"><p>Sunucu kuralları yönetir. Simüle rakip seçim yapar, cevap vermez.</p><button className="button" disabled={pending || teams.length === 0} onClick={() => void game.start()}>{pending ? 'Maç hazırlanıyor…' : 'Antrenmanı başlat'} <span>↗</span></button></div>}
        {phase === 'ready' && view && <div className="ready-area ready-panel"><div className="ready-indicators"><span className={view.ready[me] ? 'is-ready' : ''}>SEN {view.ready[me] ? '✓ HAZIR' : '· BEKLİYOR'}</span><span className={view.ready[opponent] ? 'is-ready' : ''}>RAKİP {view.ready[opponent] ? '✓ HAZIR' : '· BEKLİYOR'}</span></div><p>İki oyuncu hazır olduğunda ortak geri sayım başlar. Hazırlık için {game.remaining} saniye kaldı.</p><button className="button ready-button" disabled={pending || view.ready[me]} onClick={() => game.act('ready', 'ready')}>{view.ready[me] ? 'Hazırsın · Rakip bekleniyor' : 'HAZIRIM'} <span>✓</span></button></div>}
        {phase === 'countdown' && <div className="countdown-display" aria-live="off"><strong key={game.remaining}>{game.remaining || 1}</strong><span>Kulüp seçimi birazdan açılıyor</span></div>}
        {(choosing || phase === 'reveal' || answering) && <><div className={`selection-pair ${phase === 'reveal' ? 'versus-reveal' : ''}`}>{([0, 1] as const).map(seat => <div key={seat} className={seat === 0 ? 'selection-with-plus' : undefined}><div className={`selection-card ${choices[seat] ? 'selected' : ''}`}><small>{seat === 0 ? 'SENİN SEÇİMİN' : 'RAKİBİN SEÇİMİ'}</small><span className="selection-mark">{teams.find(team => team.id === choices[seat])?.mark ?? (seat === 0 ? '?' : '• • •')}</span><strong>{named(choices[seat]) ?? (seat === 0 ? 'Seçim bekleniyor' : 'Süre bitince açıklanacak')}</strong></div>{seat === 0 && <span className="pair-plus">VS</span>}</div>)}</div>{phase === 'reveal' && <p className="versus-prompt">İki takımda da oynamış futbolcuyu bul! Cevap süresi karşılaşma ekranından sonra başlayacak.</p>}</>}
        {choosing && locked && <p className="lock-message" role="status">✓ SEÇİMİN KİLİTLENDİ · Rakibin seçimi süre sonunda açılacak.</p>}
        {answering && view?.answered[me] && <p className="lock-message" role="status">{outcome?.reason === 'correct' ? 'Doğru cevap!' : 'Cevabın alındı. Bu turda ikinci cevap hakkın yok.'}</p>}
        {canSearch && <div className="search-area"><label htmlFor="game-search">{answering ? 'Futbolcu ara · Tek cevap hakkı' : 'Kulüp veya ülke ara'}{(phase === 'ready' || phase === 'countdown') && ' · Şimdiden yazabilirsin'}</label><div className="search-field"><span aria-hidden="true">⌕</span><input ref={input} id="game-search" autoComplete="off" maxLength={80} value={game.query} onChange={e => { game.setQuery(e.target.value); setActiveIndex(0); }} onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => Math.max(0, Math.min(i + 1, game.options.length - 1))); } else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, 0)); } else if (e.key === 'Enter' && game.options.length) { e.preventDefault(); pick(activeIndex); } }} role="combobox" aria-autocomplete="list" aria-controls="game-results" aria-expanded={game.options.length > 0} aria-activedescendant={game.options.length ? `game-option-${Math.min(activeIndex, game.options.length - 1)}` : undefined} placeholder={answering ? 'Futbolcu adı veya lakabı…' : 'En az 2 harf yaz…'} /></div><div id="game-results" className="search-results" role="listbox" aria-busy={game.searching}>{game.options.map((item, index) => <button id={`game-option-${index}`} role="option" aria-selected={index === activeIndex} key={item.id} className={index === activeIndex ? 'active-option' : ''} disabled={pending || phase === 'countdown' || phase === 'ready'} onMouseEnter={() => setActiveIndex(index)} onClick={() => pick(index)}><span className="result-mark">{item.mark || item.name.split(' ').map(n => n[0]).join('')}</span><span><strong>{item.name}</strong><small>{item.detail}</small></span><span className="result-arrow">↗</span></button>)}{game.query.trim().length >= 2 && !game.searching && game.options.length === 0 && <p className="empty-result">Bu adla oynanabilir futbolcu veya kulüp bulunamadı.</p>}</div></div>}
        {(phase === 'result' || phase === 'finished') && <div className={`round-result ${outcome?.reason === 'correct' ? outcome.winner === me ? 'won' : 'lost' : 'neutral'}`} role="status"><span className="result-kicker">{outcome?.reason === 'correct' ? '+1 PUAN' : outcome?.reason === 'afk' ? 'MAÇ SONA ERDİ' : 'TUR TAMAMLANDI'}</span><strong>{resultText}</strong>{outcome?.winner !== null && outcome?.reason !== 'afk' && <span className="result-winner">PUANI ALAN · {outcome?.winner === me ? 'SEN' : 'RAKİBİN'}</span>}{outcome?.answerName && <span className="answer-reveal">{outcome.answerName}</span>}{phase === 'result' && <small>Sonraki tur için hazırlık {game.remaining} saniye sonra açılacak.</small>}</div>}
        {game.error && <div className="result-message" role="alert">{game.error}{game.retry && <button className="text-link retry-button" disabled={pending} onClick={game.retry}>Aynı isteği tekrar gönder ↻</button>}</div>}
        {phase === 'finished' && !remote && <button className="button" disabled={pending} onClick={() => void game.start()}>Yeni antrenman <span>↻</span></button>}
        {phase === 'finished' && remote && <button className="button" onClick={onRematch}>Yeni rakip bul <span>↻</span></button>}
      </div><div className="match-bottom"><span>◇ ELO etkisi yok</span><span>Sunucu doğrulaması · {remote ? 'Socket.IO' : 'HTTP'}</span></div>
    </section><aside className="arena-sidebar"><div className="side-card"><div className="eyebrow">TAKTİK TAHTASI</div><h3>Önce bağlantı,<br />sonra cevap.</h3><div className="tactic-pitch"><span>RM</span><i>↔</i><span>POR</span><strong>Cristiano Ronaldo</strong></div><p>Kulüp bağlantısı A takımda fiilen oynamak; ülke bağlantısı A millî takımı temsil etmektir. Vatandaşlık tek başına yeterli değildir.</p><span className="example-label">DOĞRULANMIŞ ÖRNEK BAĞLANTI</span></div><div className="side-rules"><h3>Kısa maç rehberi</h3><p><b>03</b><span>Hazırlıktan sonra 3 saniyede seç.</span></p><p><b>15</b><span>Ortak ismi 15 saniyede bul.</span></p><p><b>01</b><span>Her tur yalnızca bir cevap.</span></p><p><b>03</b><span>3 puana ulaş, maçı kazan.</span></p></div><div className="demo-disclosure" hidden={!!remote}><strong>Gerçek motor. Simüle rakip.</strong><p>Süre, puan ve cevap doğrulaması sunucuda. Antrenman rakibi seçimine uygun doğrulanmış bir kulüp seçer, cevap vermez. PostgreSQL kapalıysa incelemeli dosya kullanılır.</p></div></aside></div>
  </main>;
}
