import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeAuth, getAuth } from '../src/server/auth.ts';

test('Google web authorization encodes parameters once and preserves nonce and S256 PKCE', async () => {
  const values = {
    NODE_ENV: 'production', DATABASE_URL: 'postgresql://synthetic@127.0.0.1:1/unused',
    BETTER_AUTH_URL: 'https://golvia.onrender.com', GOLVIA_PUBLIC_ORIGIN: 'https://golvia.onrender.com',
    BETTER_AUTH_SECRET: 'synthetic-oauth-unit-test-secret-at-least-32',
    GOOGLE_CLIENT_ID: 'synthetic.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'synthetic-client-secret',
  };
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    const provider = (await getAuth().$context).socialProviders.find(item => item.id === 'google')!;
    const state = 'synthetic +/&=?', nonce = 'synthetic-nonce+/=';
    const codeVerifier = 'v'.repeat(64);
    const redirectURI = 'https://golvia.onrender.com/api/auth/callback/google';
    const url = await provider.createAuthorizationURL({ state, idTokenNonce: nonce, codeVerifier, redirectURI });
    const query = new URL(url.toString()).searchParams;
    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(query.get('client_id'), values.GOOGLE_CLIENT_ID);
    assert.equal(query.get('redirect_uri'), redirectURI);
    assert.equal(query.get('response_type'), 'code');
    assert.deepEqual(query.get('scope')?.split(' ').sort(), ['email', 'openid', 'profile']);
    assert.equal(query.get('state'), state);
    assert.equal(query.get('nonce'), nonce);
    assert.equal(query.get('code_challenge_method'), 'S256');
    assert.equal(query.get('code_challenge'), createHash('sha256').update(codeVerifier).digest('base64url'));
    assert.equal(query.get('prompt'), 'select_account');
    assert.equal(query.has('client_secret'), false);
    assert.equal(query.has('code_verifier'), false);
    for (const key of query.keys()) assert.equal(query.getAll(key).length, 1);
    assert.equal(provider.requiresIdTokenNonce, true);
    await assert.rejects(async () => provider.createAuthorizationURL({ state, codeVerifier, redirectURI }), /OAuth nonce missing/);
    assert.equal(await provider.getUserInfo({ idToken: 'invalid' }), null);
  } finally {
    await closeAuth();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
