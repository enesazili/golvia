import nodemailer from 'nodemailer';
export function emailConfiguration(env: Readonly<Record<string, string | undefined>> = process.env) {
  if (env.RESEND_API_KEY || env.EMAIL_FROM) {
    const from = env.EMAIL_FROM?.trim() ?? '';
    const address = from.includes('<') ? /^[^<>\r\n]*<([^<>\r\n]+)>$/.exec(from)?.[1] : from;
    const domain = address && /^[^\s@<>]+@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(address)?.[1].toLowerCase();
    const testDomain = !!domain && (domain === 'resend.dev' || domain.endsWith('.resend.dev'));
    return { provider: env.RESEND_API_KEY?.trim() && domain && !testDomain ? 'resend' as const : null, from, testDomain };
  }
  return { provider: !env.RENDER && env.SMTP_URL && env.SMTP_FROM ? 'smtp' as const : null, from: env.SMTP_FROM ?? '' };
}
/** No provider response or message body is logged: verification/reset URLs are secrets. */
export async function sendAccountEmail(to: string, subject: string, url: string, fetcher: typeof fetch = fetch) {
  const config = emailConfiguration();
  if (!config.provider) throw new Error('Mail service is unavailable');
  if (config.provider === 'resend') {
    const response = await fetcher('https://api.resend.com/emails', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.from, to: [to], subject, text: `${subject}\n\n${url}\n` }),
    });
    if (!response.ok) throw new Error('Mail provider rejected delivery');
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || !('id' in result) || typeof result.id !== 'string' || !result.id) throw new Error('Mail provider did not acknowledge delivery');
  } else {
    const transport = nodemailer.createTransport({ url: process.env.SMTP_URL!, disableFileAccess: true, disableUrlAccess: true, connectionTimeout: 8000, socketTimeout: 8000 });
    const result = await transport.sendMail({ from: config.from, to, subject, text: `${subject}\n\n${url}\n` });
    if (!result.accepted?.length || result.rejected?.length) throw new Error('Mail provider rejected delivery');
  }
}
