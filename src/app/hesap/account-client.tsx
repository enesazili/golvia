'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authClient } from '@/lib/auth-client';
import { CompetitiveProfile } from '@/features/competitive/competitive-profile';
import { TERMS_VERSION } from '@/lib/legal';
type User = { name: string; username?: string | null; email: string; emailVerified: boolean; termsAccepted: boolean; googleLinked: boolean };
export function AccountClient({ available, mailReady, googleReady, user, resetToken, authError = false }: { available: boolean; mailReady: boolean; googleReady: boolean; user: User | null; resetToken: string; authError?: boolean }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(user?.name ?? '');
  const [mode, setMode] = useState<'continue' | 'forgot' | 'reset'>(resetToken ? 'reset' : 'continue');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(authError ? 'Google girişi tamamlanamadı. Yeniden dene veya e-posta kullan.' : '');
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [token, setToken] = useState(resetToken), [accepted, setAccepted] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false), [deletePassword, setDeletePassword] = useState(''), [deleteConfirmed, setDeleteConfirmed] = useState(false);
  useEffect(() => {
    if (!resetToken) return;
    const url = new URL(window.location.href); url.searchParams.delete('token');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, [resetToken]);
  async function recordTerms() {
    const response = await fetch('/api/account/terms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ termsAccepted: true, termsVersion: TERMS_VERSION }) });
    if (!response.ok) throw new Error('Koşul kabulü kaydedilemedi. Tekrar dene.');
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !available) return;
    setBusy(true); setMessage('');
    try {
      if (mode === 'continue') {
        if (!accepted) throw new Error('Kullanım koşullarını onayla.');
        const response = await fetch('/api/auth/continue/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, acceptance: { termsAccepted: true, termsVersion: TERMS_VERSION } }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? 'Giriş tamamlanamadı. Bilgilerini kontrol et.');
        if (response.status === 200) router.refresh();
        else setMessage(result.message);
      } else if (mode === 'forgot') {
        const result = await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/hesap` });
        if (result.error) throw new Error('Bağlantı gönderilemedi. Birazdan tekrar dene.');
        setMessage('Hesap varsa sıfırlama bağlantısı gönderildi.');
      } else {
        const result = await authClient.resetPassword({ token, newPassword: password });
        if (result.error) throw new Error('Bağlantı geçersiz veya süresi dolmuş.');
        setToken(''); setMode('continue'); setMessage('Parolan güncellendi. Giriş yapabilirsin.');
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'İşlem tamamlanamadı.'); }
    finally { setBusy(false); }
  }
  async function google() {
    if (!accepted || !googleReady || busy) return;
    setBusy(true); setMessage('');
    try { const result = await authClient.signIn.social({ provider: 'google', callbackURL: '/hesap', errorCallbackURL: '/hesap?authError=1', additionalData: { termsAccepted: true, termsVersion: TERMS_VERSION } }); if (result.error) throw new Error('Google bağlantısı kurulamadı.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Google bağlantısı kurulamadı.'); setBusy(false); }
  }
  async function accountAction(action: 'out' | 'revoke' | 'terms') {
    setBusy(true); setMessage('');
    try {
      if (action === 'terms') { await recordTerms(); router.refresh(); }
      else if (action === 'out') { const result = await authClient.signOut(); if (result.error) throw new Error('Çıkış yapılamadı.'); router.refresh(); }
      else { const result = await authClient.revokeOtherSessions(); if (result.error) throw new Error('Oturumlar kapatılamadı.'); setMessage('Diğer oturumlar kapatıldı.'); }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'İşlem tamamlanamadı.'); }
    finally { setBusy(false); }
  }
  async function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !deleteConfirmed) return;
    setBusy(true); setMessage('');
    try { const result = await authClient.deleteUser(deletePassword ? { password: deletePassword } : {}); if (result.error) throw new Error('Silme doğrulanamadı. Yeniden giriş yap veya parolanı kontrol et.'); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Hesap silinemedi.'); }
    finally { setBusy(false); }
  }
  const acceptance = <><label className="check-label"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)}/><span><Link href="/yasal/kosullar" target="_blank">Kullanım Koşulları</Link>’nı kabul ediyorum.</span></label><p className="fine-print"><Link href="/yasal/kvkk" target="_blank">KVKK Aydınlatma Metni</Link> · <Link href="/yasal/gizlilik" target="_blank">Gizlilik</Link></p></>;
  if (user) return <CompetitiveProfile name={user.name} revision={user.name} settings={<section className="account-card profile-settings"><h3>Hesap ayarları</h3><form onSubmit={event => { event.preventDefault(); if (busy) return; setBusy(true); setMessage(''); void authClient.updateUser({ name: displayName }).then(result => { if (result.error) setMessage('Oyuncu adı kaydedilemedi. 2–24 karakter kullan.'); else { setMessage('Oyuncu adı güncellendi.'); router.refresh(); } }).catch(() => setMessage('Kaydedilemedi.')).finally(() => setBusy(false)); }}><label>Oyuncu adı<input required minLength={2} maxLength={24} value={displayName} autoComplete="nickname" onChange={event => setDisplayName(event.target.value)}/></label><button className="button" disabled={busy}>Kaydet</button></form><label>E-posta<input type="email" value={user.email} readOnly/></label><p className="fine-print">{user.googleLinked ? 'Google kimliğine bağlı. E-posta burada değiştirilemez.' : 'E-posta değişikliği doğrulama hizmeti açılana kadar kullanılamıyor.'}</p>{!user.termsAccepted && <form onSubmit={event => { event.preventDefault(); if (accepted) void accountAction('terms'); }}>{acceptance}<button className="button" disabled={!accepted || busy}>Koşulları onayla</button></form>}<Link className="button" href="/">Oyuna dön <span>↗</span></Link>{!user.emailVerified && mailReady && <button className="quiet-button" disabled={busy} onClick={() => { setBusy(true); void authClient.sendVerificationEmail({ email: user.email, callbackURL: '/' }).then(result => setMessage(result.error ? 'Gönderilemedi. Tekrar dene.' : 'E-posta sağlayıcısı isteği kabul etti. Gelen kutunu kontrol et.')).finally(() => setBusy(false)); }}>Doğrulama bağlantısı iste</button>}<button className="quiet-button" disabled={busy} onClick={() => void accountAction('out')}>Çıkış</button><button className="quiet-button" disabled={busy} onClick={() => void accountAction('revoke')}>Diğer oturumları kapat</button><Link className="text-link" href="/api/account/export" prefetch={false}>Verilerimi indir ↗</Link><button className="quiet-button account-delete-trigger" onClick={() => setDeleteOpen(value => !value)}>{deleteOpen ? 'Vazgeç' : 'Hesabımı sil'}</button>{deleteOpen && <form className="account-delete" onSubmit={event => void deleteAccount(event)}><p>Hesabın ve oturumların silinir. <Link className="text-link" href="/yasal/basvuru">Silme kapsamı</Link></p><label>Şifre (e-posta hesabı için)<input type="password" autoComplete="current-password" value={deletePassword} onChange={event => setDeletePassword(event.target.value)}/></label><label className="check-label"><input type="checkbox" checked={deleteConfirmed} onChange={event => setDeleteConfirmed(event.target.checked)}/><span>Hesabımı kalıcı olarak silmek istiyorum.</span></label><button className="danger-button" disabled={busy || !deleteConfirmed}>Hesabı kalıcı olarak sil</button></form>}
<p role="status">{message}</p></section>} />;
  return <section className="account-card" aria-label="Hesap girişi">{mode !== 'continue' && <h2>{mode === 'forgot' ? 'Şifreni yenile' : 'Yeni şifre'}</h2>}<form onSubmit={event => void submit(event)}>{mode !== 'reset' && <label>E-posta<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)}/></label>}{mode !== 'forgot' && <label>Şifre<input type="password" autoComplete={mode === 'reset' ? 'new-password' : 'current-password'} required minLength={12} maxLength={128} value={password} onChange={event => setPassword(event.target.value)}/></label>}{mode === 'continue' && acceptance}<button className="button" disabled={busy || !available || mode === 'continue' && !accepted || mode === 'forgot' && !mailReady}>{busy ? 'İşleniyor…' : mode === 'continue' ? 'Devam et' : mode === 'forgot' ? 'Bağlantı gönder' : 'Şifreyi kaydet'}<span>↗</span></button></form>{mode === 'continue' && <><button className="secondary-button oauth-button" disabled={!available || !googleReady || !accepted || busy} onClick={() => void google()}><span className="google-mark" aria-hidden="true">G</span>Google ile devam et</button>{!googleReady && <p className="fine-print">Google şu anda kullanılamıyor.</p>}<button className="quiet-button" disabled={!mailReady || busy} onClick={() => setMode('forgot')}>Şifremi unuttum</button></>}{!available && <p className="fine-print">Hesap hizmeti şu anda kullanılamıyor.</p>}<p role="status" aria-live="polite">{message}</p>{mode !== 'continue' && <button className="quiet-button" onClick={() => setMode('continue')}>Geri dön</button>}<Link className="text-link" href="/">Oyuna dön ↗</Link></section>;
}
