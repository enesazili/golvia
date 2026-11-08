import { Pool } from 'pg';
import { betterAuth } from 'better-auth';
import { username } from 'better-auth/plugins';
import { verifyGoogleIdToken } from 'better-auth/social-providers';
import { APIError, createAuthMiddleware, createEmailVerificationToken, getOAuthState, getSessionFromCtx } from 'better-auth/api';
import { acceptsTerms, TERMS_VERSION } from '../lib/legal.ts';
import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { body, failure, json } from './http.ts';
import { emailConfiguration, sendAccountEmail } from './email.ts';

export function accountConfiguration() {
  const mail = !!emailConfiguration().provider;
  const database = !!process.env.DATABASE_URL;
  const secret = !!process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_SECRET.length >= 32 && !/replace-with|example/i.test(process.env.BETTER_AUTH_SECRET);
  const url = process.env.BETTER_AUTH_URL;
  const origin = !!url && (() => { try { const parsed = new URL(url); return parsed.origin === url && (process.env.NODE_ENV !== 'production' || (parsed.protocol === 'https:' && url === process.env.GOLVIA_PUBLIC_ORIGIN)); } catch { return false; } })();
  const google = !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
  return { mail, database, secret, origin, google, ready: mail && database && secret && origin };
}

let authPool: Pool | undefined;
const delivery = new AsyncLocalStorage<{ failed: boolean }>();
function createAuth() {
  const config = accountConfiguration();
  if (!config.database || !config.secret || !config.origin) throw new Error('Account service is not configured');
  const send = async (to: string, subject: string, url: string) => {
    try { await sendAccountEmail(to, subject, url); }
    catch { const state = delivery.getStore(); if (state) state.failed = true; console.error('Account email delivery failed'); throw new Error('Mail delivery failed'); }
  };
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=golvia_auth', max: 5, connectionTimeoutMillis: 3000 });
  authPool = pool;
  return betterAuth({
    appName: 'Golvia',
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    logger: { level: 'error', log: () => console.error('Golvia authentication operation failed') },
    database: pool,
    hooks: { before: createAuthMiddleware(async ctx => {
      if (ctx.body && typeof ctx.body.email === 'string') ctx.body.email = normalizeEmail(ctx.body.email);
      if (ctx.path === '/sign-in/social' && ctx.body?.idToken) throw new APIError('BAD_REQUEST', { message: 'Sağlayıcı yönlendirmesiyle devam et.' });
      if (ctx.path === '/verify-email') {
        const token = ctx.query?.token;
        if (typeof token !== 'string' || token.length > 4096) throw new APIError('BAD_REQUEST', { message: 'Bağlantı geçersiz veya süresi dolmuş.' });
        const used = await pool.query('DELETE FROM email_verification WHERE digest=$1 AND expires_at>now() RETURNING digest', [createHash('sha256').update(token).digest('hex')]);
        if (!used.rowCount) throw new APIError('BAD_REQUEST', { message: 'Bağlantı geçersiz, kullanılmış veya süresi dolmuş.' });
      }
      if (ctx.path !== '/delete-user') return;
      const session = await getSessionFromCtx(ctx);
      if (!session) return;
      const credential = await pool.query('SELECT 1 FROM account WHERE "userId"=$1 AND "providerId"=\'credential\' LIMIT 1', [session.user.id]);
      if (credential.rowCount && !ctx.body?.password) throw new APIError('BAD_REQUEST', { message: 'Hesabını silmek için parolan gerekli.' });
    }) },
    socialProviders: config.google ? { google: { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET!, prompt: 'select_account', mapProfileToUser: profile => ({ image: '', emailVerified: profile.email_verified === true }) } } : {},
    account: { accountLinking: { enabled: false }, encryptOAuthTokens: true },
    databaseHooks: { user: { delete: { before: async user => { await pool.query('DELETE FROM email_verification WHERE user_id=$1', [user.id]); } }, create: { before: async (user, ctx) => {
      const acceptance = ctx?.path.startsWith('/callback') ? await getOAuthState() : ctx?.path === '/sign-in/social' ? ctx.body?.additionalData : ctx?.body?.acceptance;
      if (!acceptsTerms(acceptance)) throw new APIError('BAD_REQUEST', { message: 'Güncel kullanım koşullarını kabul etmelisin.' });
      return { data: { ...user, email: normalizeEmail(user.email), termsVersion: TERMS_VERSION, termsAcceptedAt: new Date() } };
    } } }, session: { create: { before: async session => {
      const result = await pool.query('SELECT status FROM golvia_auth."user" WHERE id=$1', [session.userId]);
      return result.rows[0]?.status === 'active';
    } } } },
    user: { additionalFields: { status: { type: 'string', defaultValue: 'active', input: false }, termsVersion: { type: 'string', required: false, input: false }, termsAcceptedAt: { type: 'date', required: false, input: false } }, deleteUser: { enabled: true } },
    plugins: [username({ minUsernameLength: 3, maxUsernameLength: 24 }), {
      id: 'google-redirect-nonce',
      init(ctx) {
        const provider = ctx.socialProviders.find(item => item.id === 'google');
        if (!provider) return;
        // Bind Google's signed ID token to the nonce carried by Better Auth's OAuth state.
        provider.requiresIdTokenNonce = true;
        const authorize = provider.createAuthorizationURL.bind(provider), userInfo = provider.getUserInfo.bind(provider);
        provider.createAuthorizationURL = async params => {
          if (!params.idTokenNonce) throw new Error('OAuth nonce missing');
          const url = await authorize(params); url.searchParams.set('nonce', params.idTokenNonce); return url;
        };
        provider.getUserInfo = async tokens => {
          if (!tokens.idToken || !tokens.expectedIdTokenNonce || !await verifyGoogleIdToken({ token: tokens.idToken, audience: process.env.GOOGLE_CLIENT_ID!, nonce: tokens.expectedIdTokenNonce })) return null;
          return userInfo(tokens);
        };
      },
    }],
    emailAndPassword: {
      enabled: true,
      disableSignUp: !config.mail,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: config.mail ? async ({ user, url }) => send(user.email, 'Golvia parola sıfırlama', url) : undefined,
    },
    emailVerification: config.mail ? { expiresIn: 3600, sendOnSignUp: true, sendOnSignIn: true, sendVerificationEmail: async ({ user, url }) => {
      const token = await createEmailVerificationToken(process.env.BETTER_AUTH_SECRET!, user.email, undefined, 3600, { jti: randomUUID() });
      const link = new URL(url); link.searchParams.set('token', token);
      const digest = createHash('sha256').update(token).digest('hex');
      try {
        await pool.query('DELETE FROM email_verification WHERE expires_at<=now()');
        await pool.query('INSERT INTO email_verification(digest,user_id,expires_at) VALUES($1,$2,now()+interval \'1 hour\') ON CONFLICT(digest) DO UPDATE SET expires_at=EXCLUDED.expires_at', [digest, user.id]);
        await send(user.email, 'Golvia e-posta doğrulama', link.toString());
      } catch (error) {
        const state = delivery.getStore(); if (state) state.failed = true;
        await pool.query('DELETE FROM email_verification WHERE digest=$1', [digest]); throw error;
      }
    } } : undefined,
    verification: { storeIdentifier: 'hashed' },
    session: { expiresIn: 60 * 60 * 24, updateAge: 60 * 15, freshAge: 60 * 5 },
    rateLimit: { enabled: true, window: 60, max: 60, customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/sign-up/email': { window: 600, max: 5 },
      '/request-password-reset': { window: 600, max: 3 },
    } },
    // Only trust a forwarding header when the deployment explicitly states that a reverse proxy
    // overwrites it. Otherwise an attacker could rotate spoofed x-real-ip values to evade limits.
    advanced: process.env.TRUST_PROXY === 'true' ? { ipAddress: { ipAddressHeaders: ['x-real-ip'] } } : {},
  });
}
export function normalizeEmail(email: string) { return email.trim().toLowerCase(); }
export async function handleAuth(request: Request): Promise<Response> {
  const state = { failed: false };
  const response = await delivery.run(state, () => getAuth().handler(request));
  return state.failed ? json({ error: 'E-posta işlemi tamamlanamadı. Yeniden dene.' }, 503) : response;
}

/** Reuses Better Auth's password verification, rate limits, CSRF checks and cookie responses. */
export async function continueEmail(request: Request): Promise<Response> {
  try {
    const data = await body(request);
    if (Object.keys(data).some(key => !['email', 'password', 'acceptance'].includes(key)) || typeof data.email !== 'string' || data.email.length > 254 || typeof data.password !== 'string' || data.password.length < 12 || data.password.length > 128 || !acceptsTerms(data.acceptance)) return json({ error: 'Bilgilerini ve koşul kabulünü kontrol et.' }, 400);
    const email = normalizeEmail(data.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Bilgilerini kontrol et.' }, 400);
    getAuth();
    const headers = new Headers(request.headers); headers.delete('content-length');
    const call = (path: string, payload: object) => handleAuth(new Request(new URL(`/api/auth${path}`, process.env.BETTER_AUTH_URL), { method: 'POST', headers, body: JSON.stringify(payload) }));
    const signedIn = await call('/sign-in/email', { email, password: data.password });
    if (signedIn.status === 429) return json({ error: 'Çok fazla deneme. Biraz sonra tekrar dene.' }, 429);
    if (signedIn.ok) {
      const { user } = await signedIn.clone().json();
      await authPool!.query('UPDATE "user" SET "termsVersion"=$2,"termsAcceptedAt"=now() WHERE id=$1 AND "termsVersion" IS DISTINCT FROM $2', [user.id, TERMS_VERSION]);
      return signedIn;
    }
    if (signedIn.status >= 500) return json({ error: 'Hesap işlemi tamamlanamadı. Yeniden dene.' }, 503);
    const existing = await authPool!.query('SELECT id FROM "user" WHERE email=$1', [email]);
    if (!existing.rowCount) {
      if (!accountConfiguration().mail) return json({ error: 'Hesap oluşturma şu anda kullanılamıyor.' }, 503);
      const created = await call('/sign-up/email', { email, password: data.password, name: `Oyuncu ${randomUUID().slice(0, 6)}`, acceptance: data.acceptance });
      if (created.status >= 500) return json({ error: 'Hesap işlemi tamamlanamadı. Yeniden dene.' }, 503);
      if (created.status === 429) return json({ error: 'Çok fazla deneme. Biraz sonra tekrar dene.' }, 429);
    }
    // New, unverified and wrong-password cases share one response; no account-existence probe.
    return json({ message: 'Bilgilerini kontrol et. Doğrulama bekliyorsa e-postandaki bağlantıyı kullan.' }, 202);
  } catch (error) { return failure(error); }
}
let instance: ReturnType<typeof createAuth> | undefined;
export function getAuth() { return instance ??= createAuth(); }

/**
 * Returns the session only for an active account. Suspended/inactive accounts have every stored
 * session revoked on first use, so HTTP and Socket.IO stop honoring credentials immediately.
 */
export async function activeSession(headers: Headers) {
  const config = accountConfiguration();
  if (!config.database || !config.secret || !config.origin) return null;
  const session = await getAuth().api.getSession({ headers });
  if (!session?.user) return null;
  const status = 'status' in session.user ? String(session.user.status) : 'active';
  if (status === 'active') return session;
  await authPool?.query('DELETE FROM golvia_auth.session WHERE "userId" = $1', [session.user.id]).catch(() => undefined);
  return null;
}
export async function closeAuth() { await authPool?.end(); authPool = undefined; instance = undefined; }
