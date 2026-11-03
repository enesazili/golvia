import type { NextConfig } from "next";

const production = process.env.NODE_ENV === 'production';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() { return [{ source: '/(.*)', headers: [
    // CSP (with a per-request nonce) is issued by src/proxy.ts for document responses.
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ...(production ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []),
  ] }]; },
  allowedDevOrigins: [
    "127.0.0.1",
    ...(process.env.GOLVIA_DEV_ORIGINS?.split(',').map(value => value.trim()).filter(Boolean) ?? []),
  ],
};

export default nextConfig;
