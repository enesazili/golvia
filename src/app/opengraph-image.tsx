import { ImageResponse } from 'next/og';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export default function OpenGraphImage() {
  return new ImageResponse(<div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 72, background: '#0b2d21', color: '#f2f0df', fontFamily: 'Arial, sans-serif' }}><div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 36, fontWeight: 900, letterSpacing: -2 }}><span style={{ display: 'flex', width: 42, height: 42, alignItems: 'center', justifyContent: 'center', background: '#d4ef55', color: '#0b2d21' }}>G</span>GOLVIA</div><div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}><span style={{ color: '#d4ef55', fontSize: 22, letterSpacing: 5 }}>FUTBOL OYUN ALANI</span><strong style={{ fontSize: 150, lineHeight: 1, letterSpacing: -12 }}>3 — 2 — 1</strong><span style={{ fontSize: 32 }}>İki seçim. Ortak futbolcu. İlk üç puan.</span></div><div style={{ display: 'flex', height: 4, width: '100%', background: '#d4ef55' }} /></div>, size);
}
