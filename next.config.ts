import type { NextConfig } from "next";

const production = process.env.NODE_ENV === 'production';
const socketSource = process.env.GOLVIA_PUBLIC_ORIGIN?.replace(/^https:\/\//, 'wss://') ?? '';
const policy = ["default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'", `script-src 'self' 'unsafe-inline'${production ? '' : " 'unsafe-eval'"}`, "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self' data:", `connect-src 'self' ${socketSource}`.trim(), ...(production ? ['upgrade-insecure-requests'] : [])].join('; ');

const nextConfig: NextConfig = {
  async headers() { return [{ source: '/(.*)', headers: [
    { key: 'Content-Security-Policy', value: policy },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ...(production ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []),
  ] }]; },
  allowedDevOrigins: [
    "127.0.0.1",
    ...(process.env.GOLVIA_DEV_ORIGINS?.split(',').map(value => value.trim()).filter(Boolean) ?? []),
  ],
};

export default nextConfig;
