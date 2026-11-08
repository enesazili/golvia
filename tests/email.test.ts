import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountConfiguration } from '../src/server/auth.ts';
import { emailConfiguration, sendAccountEmail } from '../src/server/email.ts';
test('Render mail requires complete HTTPS credentials; local SMTP remains available', () => {
  assert.equal(emailConfiguration({ RENDER: 'true', SMTP_URL: 'smtp://localhost:25', SMTP_FROM: 'test@example.invalid' }).provider, null);
  assert.equal(emailConfiguration({ RESEND_API_KEY: 're_synthetic' }).provider, null);
  assert.equal(emailConfiguration({ RESEND_API_KEY: 're_synthetic', EMAIL_FROM: 'test@example.invalid' }).provider, 'resend');
  assert.equal(emailConfiguration({ SMTP_URL: 'smtp://localhost:25', SMTP_FROM: 'test@example.invalid' }).provider, 'smtp');
});
test('Resend test or invalid senders cannot enable public account email', () => {
  for (const from of ['onboarding@resend.dev', 'Golvia <onboarding@RESEND.DEV>', 'a@sub.resend.dev', 'invalid', '']) {
    assert.equal(emailConfiguration({ RESEND_API_KEY: 're_synthetic', EMAIL_FROM: from, SMTP_URL: 'smtp://localhost', SMTP_FROM: 'a@example.invalid' }).provider, null);
  }
  assert.equal(emailConfiguration({ RESEND_API_KEY: ' ', EMAIL_FROM: 'a@example.invalid' }).provider, null);
  assert.equal(emailConfiguration({ RENDER: 'true', RESEND_API_KEY: 're_synthetic', EMAIL_FROM: 'Golvia <a@example.invalid>', SMTP_URL: 'stale-unused' }).provider, 'resend');
});
test('HTTPS email only succeeds after an acknowledged provider response and never follows redirects', async () => {
  const saved = { key: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM };
  process.env.RESEND_API_KEY = 're_synthetic'; process.env.EMAIL_FROM = 'Golvia <no-reply@example.invalid>';
  try {
    const delivery: typeof fetch = async (url, options) => {
      assert.equal(url, 'https://api.resend.com/emails'); assert.equal(options?.redirect, 'error');
      const message = JSON.parse(String(options?.body)); assert.deepEqual(message.to, ['player@example.invalid']); assert.ok(message.text.includes('/verify-email'));
      return Response.json({ id: 'synthetic-delivery' });
    };
    assert.equal(accountConfiguration().mail, true);
    process.env.EMAIL_FROM = 'Golvia <onboarding@resend.dev>';
    assert.equal(accountConfiguration().mail, false);
    await assert.rejects(sendAccountEmail('player@example.invalid', 'Doğrulama', 'https://golvia.test/', async () => { throw new Error('must not call provider'); }), /Mail service is unavailable/);
    process.env.EMAIL_FROM = 'Golvia <no-reply@example.invalid>';
    await sendAccountEmail('player@example.invalid', 'Doğrulama', 'https://golvia.test/api/auth/verify-email?token=synthetic', delivery);
    await assert.rejects(sendAccountEmail('player@example.invalid', 'Doğrulama', 'https://golvia.test/', async () => Response.json({ secret: 'must-not-escape' }, { status: 403 })), /^Error: Mail provider rejected delivery$/);
    await assert.rejects(sendAccountEmail('player@example.invalid', 'Doğrulama', 'https://golvia.test/', async () => Response.json({})), /did not acknowledge/);
  } finally {
    if (saved.key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = saved.key;
    if (saved.from === undefined) delete process.env.EMAIL_FROM; else process.env.EMAIL_FROM = saved.from;
  }
});
