'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authClient } from '@/lib/auth-client';

type User = { name: string; username?: string | null; email: string; emailVerified: boolean };
export function AccountClient({ available, mailReady, user, resetToken }: { available: boolean; mailReady: boolean; user: User | null; resetToken: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register' | 'forgot' | 'reset'>(resetToken ? 'reset' : 'login');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [token, setToken] = useState(resetToken);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  useEffect(() => {
    if (!resetToken) return;
    // Keep the one-time token out of the address bar and same-origin referrers after it has been read.
    const url = new URL(window.location.href);
    url.searchParams.delete('token');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, [resetToken]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !available) return;
    setBusy(true); setMessage('');
    try {
      if (mode === 'login') {
        const result = await authClient.signIn.email({ email, password });
        if (result.error) throw new Error('E-posta, parola veya doğrulama durumunu kontrol et.');
        router.refresh();
      } else if (mode === 'register') {
        if (!mailReady) throw new Error('Hesap açma henüz kullanılamıyor.');
        const result = await authClient.signUp.email({ name: username, username, email, password });
        if (result.error) throw new Error('Kayıt tamamlanamadı. Bilgileri kontrol et.');
        setMessage('Uygunsa doğrulama bağlantısı e-posta adresine gönderilir.');
      } else if (mode === 'forgot') {
        if (!mailReady) throw new Error('Parola sıfırlama henüz kullanılamıyor.');
        await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/hesap` });
        setMessage('Bu adrese kayıtlı hesap varsa sıfırlama bağlantısı gönderilir.');
      } else {
        if (!token) throw new Error('Sıfırlama bağlantısı geçersiz.');
        const result = await authClient.resetPassword({ token, newPassword: password });
        if (result.error) throw new Error('Bağlantı geçersiz veya süresi dolmuş.');
        setToken(''); setMode('login'); setMessage('Parolan güncellendi. Yeniden giriş yap.');
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'İşlem tamamlanamadı.'); }
    finally { setBusy(false); }
  }
  async function signOut() { setBusy(true); try { await authClient.signOut(); router.refresh(); } finally { setBusy(false); } }
  async function revokeOthers() { setBusy(true); try { const result = await authClient.revokeOtherSessions(); setMessage(result.error ? 'Diğer oturumlar sonlandırılamadı.' : 'Diğer oturumlar sonlandırıldı.'); } finally { setBusy(false); } }
  async function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !deleteConfirmed || !deletePassword) return;
    setBusy(true); setMessage('');
    try {
      const result = await authClient.deleteUser({ password: deletePassword });
      if (result.error) throw new Error('Hesap silinemedi. Parolanı kontrol et.');
      setDeletePassword(''); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Hesap silinemedi.'); }
    finally { setBusy(false); }
  }
  if (user) return <section className="account-card"><span className="eyebrow">OYUNCU PROFİLİ</span><h2>{user.username || user.name}</h2><p>E-posta: {user.email}</p><p>Durum: {user.emailVerified ? 'Doğrulanmış' : 'E-posta doğrulaması bekleniyor'}</p><div className="account-actions"><Link className="button" href="/oyun/3-2-1">Maça dön</Link><button className="text-link" disabled={busy} onClick={() => void revokeOthers()}>Diğer oturumları kapat</button><button className="text-link" disabled={busy} onClick={() => void signOut()}>Çıkış yap</button></div><p role="status" aria-live="polite">{message}</p><small>Doğrulanmış hesabınla rekabetçi maç oynayabilir, ELO ve lig ilerlemeni izleyebilirsin.</small><button type="button" className="text-link account-delete-trigger" onClick={() => setDeleteOpen(value => !value)}>{deleteOpen ? 'Hesap silmeyi kapat' : 'Hesabımı sil'}</button>{deleteOpen && <form className="account-delete" onSubmit={event => void deleteAccount(event)}><p>Bu işlem hesabını ve oturumlarını kalıcı olarak siler. Açık maç bağlantın sona erebilir.</p><label>Parolan<input required type="password" autoComplete="current-password" value={deletePassword} onChange={event => setDeletePassword(event.target.value)} /></label><label className="account-confirm"><input type="checkbox" checked={deleteConfirmed} onChange={event => setDeleteConfirmed(event.target.checked)} /> Hesabımın kalıcı olarak silinmesini istiyorum.</label><button type="submit" disabled={busy || !deleteConfirmed || !deletePassword}>Hesabı kalıcı olarak sil</button></form>}</section>;
  return <section className="account-card"><div className="account-tabs" aria-label="Hesap işlemleri"><button type="button" aria-pressed={mode === 'login'} onClick={() => { setMode('login'); setMessage(''); }}>Giriş</button><button type="button" aria-pressed={mode === 'register'} onClick={() => { setMode('register'); setMessage(''); }}>Kayıt</button></div>
    {!available && <p role="status">Hesap hizmeti şu anda kullanılamıyor. Misafir maçına devam edebilirsin.</p>}
    {available && !mailReady && mode !== 'login' && <p role="status">E-posta hizmeti kurulana kadar kayıt ve parola sıfırlama kapalı.</p>}
    <h2>{mode === 'login' ? 'Tekrar hoş geldin.' : mode === 'register' ? 'Sahaya adını yaz.' : mode === 'forgot' ? 'Parolanı yenile.' : 'Yeni parola.'}</h2>
    <form onSubmit={event => void submit(event)}>
      {mode === 'register' && <label>Kullanıcı adı<input required minLength={3} maxLength={24} autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} /></label>}
      {mode !== 'reset' && <label>E-posta<input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label>}
      {mode !== 'forgot' && <label>Parola<input required type="password" minLength={12} maxLength={128} autoComplete={mode === 'register' ? 'new-password' : mode === 'reset' ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} /></label>}
      <button className="button" type="submit" disabled={busy || !available || (!mailReady && mode !== 'login')}>{busy ? 'İşleniyor…' : mode === 'login' ? 'Giriş yap' : mode === 'register' ? 'Hesap oluştur' : mode === 'forgot' ? 'Bağlantı gönder' : 'Parolayı kaydet'}</button>
    </form>
    <p role="status" aria-live="polite">{message}</p>
    {mode === 'login' && <button className="text-link" onClick={() => setMode('forgot')}>Parolamı unuttum</button>}
    {(mode === 'forgot' || mode === 'reset') && <button className="text-link" onClick={() => setMode('login')}>Girişe dön</button>}
    <Link className="text-link" href="/oyun/3-2-1">Misafir oyna ↗</Link>
  </section>;
}
