import { Pool } from 'pg';
import { betterAuth } from 'better-auth';
import { username } from 'better-auth/plugins';
import nodemailer from 'nodemailer';

export function accountConfiguration() {
  const mail = !!process.env.SMTP_URL && !!process.env.SMTP_FROM;
  const database = !!process.env.DATABASE_URL;
  const secret = !!process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_SECRET.length >= 32 && !/replace-with|example/i.test(process.env.BETTER_AUTH_SECRET);
  const url = process.env.BETTER_AUTH_URL;
  const origin = !!url && (() => { try { const parsed = new URL(url); return parsed.origin === url && (process.env.NODE_ENV !== 'production' || (parsed.protocol === 'https:' && url === process.env.GOLVIA_PUBLIC_ORIGIN)); } catch { return false; } })();
  return { mail, database, secret, origin, ready: mail && database && secret && origin };
}

let authPool: Pool | undefined;
function createAuth() {
  const config = accountConfiguration();
  if (!config.database || !config.secret || !config.origin) throw new Error('Account service is not configured');
  const transporter = config.mail ? nodemailer.createTransport(process.env.SMTP_URL!, { disableFileAccess: true, disableUrlAccess: true }) : undefined;
  const send = async (to: string, subject: string, url: string) => {
    if (!transporter) throw new Error('Mail service is unavailable');
    try { await transporter.sendMail({ from: process.env.SMTP_FROM, to, subject, text: `${subject}\n\n${url}\n` }); }
    catch { console.error('Account email delivery failed'); throw new Error('Mail delivery failed'); }
  };
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=golvia_auth', max: 5, connectionTimeoutMillis: 3000 });
  authPool = pool;
  return betterAuth({
    appName: 'Golvia',
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: pool,
    databaseHooks: { session: { create: { before: async session => {
      const result = await pool.query('SELECT status FROM golvia_auth."user" WHERE id=$1', [session.userId]);
      return result.rows[0]?.status === 'active';
    } } } },
    user: { additionalFields: { status: { type: 'string', defaultValue: 'active', input: false } }, deleteUser: { enabled: true } },
    plugins: [username({ minUsernameLength: 3, maxUsernameLength: 24 })],
    emailAndPassword: {
      enabled: true,
      disableSignUp: !config.mail,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: config.mail ? async ({ user, url }) => send(user.email, 'Golvia parola sıfırlama', url) : undefined,
    },
    emailVerification: config.mail ? { sendOnSignUp: true, sendVerificationEmail: async ({ user, url }) => send(user.email, 'Golvia e-posta doğrulama', url) } : undefined,
    session: { expiresIn: 60 * 60 * 24, updateAge: 60 * 15 },
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
