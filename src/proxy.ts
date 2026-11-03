import { NextResponse, type NextRequest } from 'next/server';

/**
 * Issues a per-request CSP nonce. Next.js automatically applies it to its own scripts and
 * inline styles; the root layout reads `x-nonce` for the small theme bootstrap script.
 * Nonce-based CSP requires dynamic rendering, which the root layout opts into.
 */
function contentSecurityPolicy(nonce: string) {
  const development = process.env.NODE_ENV !== 'production';
  const socketOrigin = process.env.GOLVIA_PUBLIC_ORIGIN?.replace(/^https:\/\//, 'wss://');
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}'${development ? " 'unsafe-inline'" : ''}`,
    "img-src 'self' data:",
    "font-src 'self' data:",
    // Development needs the separate Socket.IO / HMR ports and LAN HTTP origins.
    `connect-src 'self'${socketOrigin ? ` ${socketOrigin}` : ''}${development ? ' ws: http: https:' : ''}`,
    ...(development ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const policy = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  matcher: [
    // Documents only: API responses, static assets, icons and metadata images carry no HTML.
    '/((?!api|_next/static|_next/image|icon.svg|opengraph-image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
};
