import { publicOrigin, socketOrigins } from '../src/server/config.ts';

if (process.env.NODE_ENV !== 'production') throw new Error('Set NODE_ENV=production for the production processes');
const origin = publicOrigin();
socketOrigins();
if (!process.env.DATABASE_URL?.startsWith('postgresql://') && !process.env.DATABASE_URL?.startsWith('postgres://')) throw new Error('DATABASE_URL must be a PostgreSQL URL');
const authConfigured = !!process.env.BETTER_AUTH_URL || !!process.env.BETTER_AUTH_SECRET;
if (authConfigured && (process.env.BETTER_AUTH_URL !== origin || !process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32 || /replace-with|example/i.test(process.env.BETTER_AUTH_SECRET))) throw new Error('Account origin and secret are incomplete');
if (!!process.env.SMTP_URL !== !!process.env.SMTP_FROM) throw new Error('SMTP_URL and SMTP_FROM must be set together');
console.log('Golvia production configuration: OK');
