import { Pool } from 'pg';

/**
 * Administrative account status tool. Suspension revokes every stored session in the same
 * transaction; reactivation does not restore old sessions. Run with the admin database role:
 *   npm run account:status -- suspend user@example.com
 */
const [command, email] = process.argv.slice(2);
if (!['suspend', 'reactivate'].includes(command ?? '') || !email) {
  throw new Error('Usage: npm run account:status -- suspend|reactivate <email>');
}
const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_ADMIN_URL or DATABASE_URL required');
const pool = new Pool({ connectionString: url, max: 1 });
try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const status = command === 'suspend' ? 'suspended' : 'active';
    const updated = await client.query('UPDATE golvia_auth."user" SET status = $1, "updatedAt" = now() WHERE lower(email) = lower($2)', [status, email]);
    if (!updated.rowCount) { await client.query('ROLLBACK'); throw new Error('Account not found'); }
    if (status === 'suspended') await client.query('DELETE FROM golvia_auth.session WHERE "userId" = (SELECT id FROM golvia_auth."user" WHERE lower(email) = lower($1))', [email]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; } finally { client.release(); }
  console.log(`Account ${command}: OK`);
} finally { await pool.end(); }
