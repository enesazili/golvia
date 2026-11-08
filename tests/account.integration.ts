import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { Pool } from 'pg';
import { TERMS_VERSION } from '../src/lib/legal.ts';

function mailSink() {
  const messages: string[] = [];
  const server = createServer(socket => {
    socket.write('220 golvia-test ESMTP\r\n');
    let pending = '', data = false, message = '';
    socket.on('data', chunk => {
      pending += chunk.toString();
      let end: number;
      while ((end = pending.indexOf('\r\n')) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 2);
        if (data) {
          if (line === '.') { messages.push(message); message = ''; data = false; socket.write('250 queued\r\n'); }
          else message += `${line}\r\n`;
        } else if (/^EHLO|^HELO/i.test(line)) socket.write('250-golvia-test\r\n250 SIZE 1048576\r\n');
        else if (/^DATA$/i.test(line)) { data = true; socket.write('354 send data\r\n'); }
        else if (/^QUIT$/i.test(line)) socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  return { server, messages };
}

function emailLink(raw: string): URL {
  const [header, ...parts] = raw.split('\r\n\r\n');
  let body = parts.join('\r\n\r\n');
  if (/Content-Transfer-Encoding: base64/i.test(header)) body = Buffer.from(body.replace(/\s/g, ''), 'base64').toString();
  else body = body.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  const link = body.match(/https:\/\/golvia\.test[^\s<>"']+/)?.[0];
  assert.ok(link, 'verification or reset link was not delivered to the local SMTP sink');
  return new URL(link);
}

async function rankedRoundTrip(connection: string, cookies: [string, string], users: [string, string]) {
  const { io: connect } = await import('socket.io-client');
  const { createSocketServer } = await import('../src/server/socketServer.ts');
  const { MatchService } = await import('../src/server/game/service.ts');
  const { CompetitiveRepository } = await import('../src/server/competitive/repository.ts');
  const schema = `golvia_ranked_account_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: connection });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: connection, options: `-c search_path=${schema},public` });
  let now = Date.now();
  const service = new MatchService(async () => ({ version: 'synthetic', selectionIds: new Set(['a', 'b']), playerIds: new Set(['p']), links: new Map([['p', new Set(['a', 'b'])]]) }), () => now);
  const store = new CompetitiveRepository(pool);
  const server = createSocketServer(service, undefined, undefined, {}, undefined, store);
  server.httpServer.listen(0, '127.0.0.1'); await once(server.httpServer, 'listening');
  const address = server.httpServer.address(); assert.ok(address && typeof address !== 'string');
  const sockets = cookies.map(cookie => connect(`http://127.0.0.1:${address.port}`, { autoConnect: false, reconnection: false, extraHeaders: { cookie } }));
  try {
    await pool.query(await readFile(new URL('../src/server/competitive/schema.sql', import.meta.url), 'utf8'));
    const connected = sockets.map(socket => new Promise<void>(resolve => socket.once('playerId', () => resolve()))); sockets.forEach(socket => socket.connect()); await Promise.all(connected);
    const found = sockets.map(socket => new Promise<{ matchId: string; seat: 0 | 1 }>(resolve => socket.once('matchFound', resolve)));
    for (const socket of sockets) assert.equal((await socket.timeout(2000).emitWithAck('quickMatch', { kind: 'ranked' })).status, 200);
    const matches = await Promise.all(found);
    assert.equal(matches[0].matchId, matches[1].matchId);
    assert.deepEqual((await pool.query('SELECT user_id FROM competitive_participant ORDER BY seat')).rows.map(row => row.user_id), users);
    const send = (index: number, round: number, type: string, id: string) => sockets[index].timeout(2000).emitWithAck('playerAction', { matchId: matches[index].matchId, action: { round, attempt: 1, type, id, requestId: `${round}:${type}` } });
    for (let round = 1; round <= 3; round++) {
      await send(0, round, 'ready', 'ready'); await send(1, round, 'ready', 'ready'); now += 3000;
      await send(0, round, 'choose', 'a'); await send(1, round, 'choose', 'b'); now += 4800;
      assert.equal((await send(0, round, 'answer', 'p')).status, 200);
      if (round < 3) now += 5000;
    }
    const final = await sockets[1].timeout(2000).emitWithAck('getState', { matchId: matches[1].matchId });
    assert.deepEqual(final.ranked.after, [1016, 984]);
    assert.equal((await store.profile(users[0])).ratings[0].wins, 1);
    await sockets[0].timeout(2000).emitWithAck('playerAction', { matchId: matches[0].matchId, action: { round: 3, attempt: 1, type: 'answer', id: 'p', requestId: '3:answer' } });
    assert.equal((await store.profile(users[0])).ratings[0].played, 1);
  } finally {
    sockets.forEach(socket => socket.disconnect()); await new Promise<void>(resolve => server.io.close(() => resolve()));
    await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
}

test('real PostgreSQL account lifecycle, verification, reset, session and isolation', { timeout: 30000 }, async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url, 'TEST_DATABASE_URL required');
  const target = new URL(url);
  assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.pathname === '/golvia_account_test', 'Only the isolated local account test database is allowed');
  const sink = mailSink(); sink.server.listen(0, '127.0.0.1'); await once(sink.server, 'listening');
  const address = sink.server.address(); assert.ok(address && typeof address !== 'string');
  process.env.DATABASE_URL = url;
  process.env.BETTER_AUTH_URL = 'https://golvia.test';
  process.env.BETTER_AUTH_SECRET = randomBytes(32).toString('hex');
  process.env.SMTP_URL = `smtp://127.0.0.1:${address.port}`;
  process.env.SMTP_FROM = 'Golvia <no-reply@golvia.test>';
  // Simulate a reverse proxy that overwrites x-real-ip; production must opt in the same way.
  process.env.TRUST_PROXY = 'true';
  const { getAuth, closeAuth } = await import('../src/server/auth.ts');
  const { socketAccount } = await import('../src/server/socketAuth.ts');
  const db = new Pool({ connectionString: url });
  await db.query(await readFile(new URL('../src/server/auth/schema.sql', import.meta.url), 'utf8'));
  const auth = getAuth();
  const base = 'https://golvia.test';
  const post = (path: string, body: object, cookie?: string, ip = '127.0.0.1') => auth.handler(new Request(`${base}/api/auth${path}`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json', 'x-real-ip': ip, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
  const get = (path: string, cookie?: string) => auth.handler(new Request(`${base}/api/auth${path}`, { headers: cookie ? { cookie } : {} }));
  const unique = randomUUID().slice(0, 8);
  const email = `player-${unique}@golvia.test`, otherEmail = `other-${unique}@golvia.test`, username = `player${unique}`, password = `Safe-${randomBytes(18).toString('hex')}`;
  const nextPassword = `New-${randomBytes(18).toString('hex')}`;
  try {
    assert.notEqual((await post('/sign-up/email', { name: username, username, email, password })).status, 200, 'server rejects missing terms acceptance');
    const signup = await post('/sign-up/email', { name: username, username, email, password, acceptance: { termsAccepted: true, termsVersion: TERMS_VERSION } });
    assert.equal(signup.status, 200, await signup.text());
    const acceptance = (await db.query('SELECT "termsVersion","termsAcceptedAt" FROM golvia_auth."user" WHERE email=$1', [email])).rows[0];
    assert.equal(acceptance.termsVersion, TERMS_VERSION); assert.ok(acceptance.termsAcceptedAt instanceof Date);
    assert.equal(sink.messages.length, 1);
    assert.notEqual((await post('/sign-in/email', { email, password })).status, 200, 'unverified email must not sign in');
    const verification = await auth.handler(new Request(emailLink(sink.messages[0])));
    assert.ok(verification.status === 200 || (verification.status >= 300 && verification.status < 400), `verification status ${verification.status}`);
    assert.equal((await db.query('SELECT "emailVerified" FROM golvia_auth."user" WHERE email=$1', [email])).rows[0]?.emailVerified, true);
    const replay = await auth.handler(new Request(emailLink(sink.messages[0]))); assert.ok(replay.status >= 400, 'verification links must be single use');
    const login = await post('/sign-in/email', { email, password });
    assert.equal(login.status, 200);
    const cookieHeader = login.headers.get('set-cookie') ?? '';
    assert.match(cookieHeader, /HttpOnly/i); assert.match(cookieHeader, /Secure/i);
    const cookie = cookieHeader.split(';')[0];
    const session = await get('/get-session', cookie);
    const signedIn = (await session.json()).user;
    assert.equal(signedIn.email, email);
    assert.equal(await socketAccount(cookie), signedIn.id);
    const duplicate = await post('/sign-up/email', { name: username, username, email: `other-${unique}@golvia.test`, password, acceptance: { termsAccepted: true, termsVersion: TERMS_VERSION } });
    assert.notEqual(duplicate.status, 200, 'username must remain unique');
    assert.equal((await db.query('SELECT count(*) FROM golvia_auth."user" WHERE username=$1', [username])).rows[0].count, '1');
    const messagesBeforeReset = sink.messages.length;
    const reset = await post('/request-password-reset', { email, redirectTo: `${base}/hesap` });
    assert.equal(reset.status, 200); assert.equal(sink.messages.length, messagesBeforeReset + 1);
    const resetLink = emailLink(sink.messages.at(-1)!);
    const resetRedirect = await auth.handler(new Request(resetLink));
    assert.ok(resetRedirect.status >= 300 && resetRedirect.status < 400);
    const token = new URL(resetRedirect.headers.get('location')!, base).searchParams.get('token'); assert.ok(token);
    assert.equal((await post('/reset-password', { token, newPassword: nextPassword })).status, 200);
    assert.notEqual((await post('/reset-password', { token, newPassword: `Again-${randomBytes(12).toString('hex')}` })).status, 200, 'password reset tokens must be single use');
    assert.equal((await (await get('/get-session', cookie)).json())?.user ?? null, null, 'password reset must revoke old session');
    assert.notEqual((await post('/sign-in/email', { email, password })).status, 200);
    const relogin = await post('/sign-in/email', { email, password: nextPassword }); assert.equal(relogin.status, 200);
    const newCookie = (relogin.headers.get('set-cookie') ?? '').split(';')[0];
    assert.equal((await post('/sign-out', {}, newCookie)).status, 200);
    assert.equal((await (await get('/get-session', newCookie)).json())?.user ?? null, null);
    assert.equal(await socketAccount(newCookie), null);
    const finalLogin = await post('/sign-in/email', { email, password: nextPassword }); assert.equal(finalLogin.status, 200);
    const finalCookie = (finalLogin.headers.get('set-cookie') ?? '').split(';')[0];
    const secondSignup = await post('/sign-up/email', { name: `guest${unique}`, username: `guest${unique}`, email: otherEmail, password, acceptance: { termsAccepted: true, termsVersion: TERMS_VERSION } });
    assert.equal(secondSignup.status, 200);
    await auth.handler(new Request(emailLink(sink.messages.at(-1)!)));
    const secondLogin = await post('/sign-in/email', { email: otherEmail, password, acceptance: { termsAccepted: true, termsVersion: TERMS_VERSION } }, undefined, '127.0.0.2'); assert.equal(secondLogin.status, 200);
    const secondCookie = (secondLogin.headers.get('set-cookie') ?? '').split(';')[0];
    const firstUser = (await (await get('/get-session', finalCookie)).json()).user;
    const secondUser = (await (await get('/get-session', secondCookie)).json()).user;
    assert.notEqual(firstUser.id, secondUser.id);
    assert.equal(secondUser.email, otherEmail);
    await rankedRoundTrip(url, [finalCookie, secondCookie], [firstUser.id, secondUser.id]);
    assert.notEqual((await post('/delete-user', {}, finalCookie)).status, 200, 'credential accounts require a password for deletion');
    assert.equal((await post('/delete-user', { password: nextPassword, userId: secondUser.id }, finalCookie)).status, 200);
    assert.equal((await db.query('SELECT count(*) FROM golvia_auth."user" WHERE email=$1', [email])).rows[0].count, '0');
    assert.equal((await (await get('/get-session', finalCookie)).json())?.user ?? null, null);
    assert.equal((await (await get('/get-session', secondCookie)).json()).user.email, otherEmail, 'another account remains accessible only by its own session');
    const { activeSession } = await import('../src/server/auth.ts');
    await db.query("UPDATE golvia_auth.\"user\" SET status='suspended' WHERE email=$1", [otherEmail]);
    assert.equal(await activeSession(new Headers({ cookie: secondCookie })), null, 'suspended accounts lose session access');
    assert.equal(await socketAccount(secondCookie), null);
    assert.equal((await db.query('SELECT count(*) FROM golvia_auth.session WHERE "userId"=(SELECT id FROM golvia_auth."user" WHERE email=$1)', [otherEmail])).rows[0].count, '0', 'suspension revokes stored sessions on first use');
    await db.query("UPDATE golvia_auth.\"user\" SET status='active' WHERE email=$1", [otherEmail]);
    assert.equal(await activeSession(new Headers({ cookie: secondCookie })), null, 'reactivation does not restore revoked sessions');
    const attempts: number[] = [];
    for (let i = 0; i < 6; i++) attempts.push((await post('/sign-in/email', { email: 'nobody@golvia.test', password }, undefined, '127.0.0.4')).status);
    assert.equal(attempts.at(-1), 429, 'the sixth sign-in attempt from one IP is rate limited');
  } finally {
    await db.query('DELETE FROM golvia_auth."user" WHERE email=$1 OR email=$2', [email, otherEmail]);
    await db.end(); await closeAuth(); sink.server.close(); delete process.env.TRUST_PROXY;
  }
});

test('unified email accounts preserve identities, normalize races and protect verification', { timeout: 30000 }, async t => {
  const connection = process.env.TEST_DATABASE_URL;
  assert.ok(connection);
  const target = new URL(connection);
  assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.pathname === '/golvia_account_test');
  const sink = mailSink(); sink.server.listen(0, '127.0.0.1'); await once(sink.server, 'listening');
  const address = sink.server.address(); assert.ok(address && typeof address !== 'string');
  const saved = { ...process.env };
  delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM; delete process.env.RENDER;
  delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET;
  Object.assign(process.env, { DATABASE_URL: connection, BETTER_AUTH_URL: 'https://golvia.test', BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), SMTP_URL: `smtp://127.0.0.1:${address.port}`, SMTP_FROM: 'Golvia <no-reply@golvia.test>', TRUST_PROXY: 'true' });
  const { getAuth, closeAuth, continueEmail, accountConfiguration } = await import('../src/server/auth.ts');
  const db = new Pool({ connectionString: connection });
  await db.query(await readFile(new URL('../src/server/auth/schema.sql', import.meta.url), 'utf8'));
  const suffix = randomUUID().replaceAll('-', '');
  const email = `unified-${suffix}@golvia.test`, race = `race-${suffix}@golvia.test`, oauth = `oauth-${suffix}@golvia.test`, failed = `failed-${suffix}@golvia.test`;
  const password = `Synthetic-${randomBytes(18).toString('hex')}`;
  const acceptance = { termsAccepted: true, termsVersion: TERMS_VERSION };
  const request = (path: string, data: unknown, ip = '127.0.2.1') => new Request(`https://golvia.test/api/auth${path}`, { method: 'POST', headers: { origin: 'https://golvia.test', 'content-type': 'application/json', 'x-real-ip': ip }, body: JSON.stringify(data) });
  const post = (mail: string, pass = password, ip = '127.0.2.1') => continueEmail(request('/continue/email', { email: mail, password: pass, acceptance }, ip));
  try {
    await t.test('new email creates one normalized, unverified account and preserves terms', async () => {
      const response = await post(`  ${email.toUpperCase()}  `); assert.equal(response.status, 202);
      const rows = (await db.query('SELECT id,email,"emailVerified","termsVersion","termsAcceptedAt" FROM golvia_auth."user" WHERE email=$1', [email])).rows;
      assert.equal(rows.length, 1); assert.equal(rows[0].emailVerified, false); assert.equal(rows[0].termsVersion, TERMS_VERSION); assert.ok(rows[0].termsAcceptedAt instanceof Date);
      assert.equal((await db.query('SELECT count(*)::int n FROM golvia_auth.session WHERE "userId"=$1', [rows[0].id])).rows[0].n, 0);
      assert.equal(sink.messages.length, 1);
      const token = emailLink(sink.messages[0]).searchParams.get('token')!;
      assert.equal((await db.query('SELECT digest FROM golvia_auth.email_verification WHERE user_id=$1', [rows[0].id])).rows[0].digest, createHash('sha256').update(token).digest('hex'));
    });
    await t.test('wrong password and repeated email cannot create or replace credentials', async () => {
      const before = (await db.query('SELECT a.password FROM golvia_auth.account a JOIN golvia_auth."user" u ON u.id=a."userId" WHERE u.email=$1', [email])).rows;
      assert.equal((await post(email.toUpperCase(), `${password}wrong`)).status, 202);
      assert.deepEqual((await db.query('SELECT a.password FROM golvia_auth.account a JOIN golvia_auth."user" u ON u.id=a."userId" WHERE u.email=$1', [email])).rows, before);
      assert.equal(sink.messages.length, 1, 'wrong passwords must not trigger verification delivery');
    });
    await t.test('concurrent case variants and direct SQL are constrained to one email', async () => {
      const results = await Promise.all([post(race, password, '127.0.2.2'), post(race.toUpperCase(), `${password}other`, '127.0.2.3')]);
      for (const result of results) assert.equal(result.status, 202);
      assert.equal((await db.query('SELECT count(*)::int n FROM golvia_auth."user" WHERE email=$1', [race])).rows[0].n, 1);
      await assert.rejects(db.query('INSERT INTO golvia_auth."user"(id,name,email,"createdAt","updatedAt") VALUES($1,\'Synthetic\',$2,now(),now())', [randomUUID(), race.toUpperCase()]), error => !!error && typeof error === 'object' && 'code' in error && error.code === '23505');
    });
    await t.test('expired and consumed verification links fail; correct password signs in afterwards', async () => {
      const old = emailLink(sink.messages[0]);
      await db.query('UPDATE golvia_auth.email_verification SET expires_at=now()-interval \'1 second\' WHERE digest=$1', [createHash('sha256').update(old.searchParams.get('token')!).digest('hex')]);
      assert.ok((await getAuth().handler(new Request(old))).status >= 400);
      const resend = await getAuth().handler(request('/send-verification-email', { email, callbackURL: '/' }, '127.0.2.4')); assert.equal(resend.status, 200);
      const link = emailLink(sink.messages.at(-1)!); assert.notEqual(link.searchParams.get('token'), old.searchParams.get('token'));
      const verified = await getAuth().handler(new Request(link)); assert.ok(verified.status >= 200 && verified.status < 400);
      assert.ok((await getAuth().handler(new Request(link))).status >= 400);
      const login = await post(email.toUpperCase(), password, '127.0.2.5'); assert.equal(login.status, 200); assert.match(login.headers.get('set-cookie')!, /HttpOnly/);
      assert.notEqual((await post(email, `${password}wrong`, '127.0.2.6')).status, 200);
      await db.query('UPDATE golvia_auth."user" SET status=\'suspended\' WHERE email=$1', [email]);
      assert.notEqual((await post(email, password, '127.0.2.7')).status, 200);
    });
    await t.test('OAuth-only accounts never gain an independent password identity', async () => {
      const id = randomUUID();
      await db.query('INSERT INTO golvia_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,\'Synthetic OAuth\',$2,true,now(),now())', [id, oauth]);
      await db.query('INSERT INTO golvia_auth.account(id,"accountId","providerId","userId","createdAt","updatedAt") VALUES($1,$2,\'google\',$3,now(),now())', [randomUUID(), randomUUID(), id]);
      assert.equal((await post(oauth, password, '127.0.2.8')).status, 202);
      assert.equal((await db.query('SELECT count(*)::int n FROM golvia_auth.account WHERE "userId"=$1', [id])).rows[0].n, 1);
      assert.equal(accountConfiguration().google, false);
    });
    await t.test('Google authorization uses state, nonce and PKCE; forged callbacks and foreign redirects fail', async () => {
      await closeAuth(); process.env.GOOGLE_CLIENT_ID = 'synthetic.apps.googleusercontent.com'; process.env.GOOGLE_CLIENT_SECRET = 'synthetic-secret';
      const auth = getAuth();
      const provider = (await auth.$context).socialProviders.find(item => item.id === 'google')!;
      assert.equal(await provider.getUserInfo({ idToken: 'invalid', expectedIdTokenNonce: 'synthetic' }), null);
      assert.equal(await provider.getUserInfo({ idToken: 'invalid' }), null);
      const foreign = await auth.handler(request('/sign-in/social', { provider: 'google', callbackURL: 'https://invalid.example', additionalData: acceptance }, '127.0.2.9')); assert.ok(foreign.status >= 400);
      const response = await auth.handler(request('/sign-in/social', { provider: 'google', callbackURL: '/hesap', disableRedirect: true, additionalData: acceptance }, '127.0.2.9')); assert.equal(response.status, 200);
      const location = new URL((await response.json()).url); assert.equal(location.origin, 'https://accounts.google.com'); assert.equal(location.searchParams.get('response_type'), 'code'); assert.ok(location.searchParams.get('state')); assert.ok(location.searchParams.get('code_challenge')); assert.ok(location.searchParams.get('nonce'));
      const forged = await auth.handler(new Request('https://golvia.test/api/auth/callback/google?code=synthetic&state=forged')); assert.notEqual(forged.status, 200);
    });
    await t.test('the combined endpoint inherits brute force limits', async () => {
      const results = [];
      for (let i = 0; i < 6; i++) results.push((await post(oauth, password, '127.0.2.10')).status);
      assert.equal(results.at(-1), 429);
    });
    await t.test('failed delivery never verifies the new account or leaves a usable email token', async () => {
      await new Promise<void>(resolve => sink.server.close(() => resolve()));
      const response = await post(failed, password, '127.0.2.11'); assert.equal(response.status, 503);
      const row = (await db.query('SELECT id,"emailVerified" FROM golvia_auth."user" WHERE email=$1', [failed])).rows[0];
      assert.equal(row.emailVerified, false);
      assert.equal((await db.query('SELECT count(*)::int n FROM golvia_auth.email_verification WHERE user_id=$1', [row.id])).rows[0].n, 0);
    });
  } finally {
    await db.query('DELETE FROM golvia_auth."user" WHERE lower(email COLLATE "C")=ANY($1::text[])', [[email, race, oauth, failed]]);
    await db.end(); await closeAuth(); if (sink.server.listening) sink.server.close();
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
