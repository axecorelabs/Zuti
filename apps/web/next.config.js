/** @type {import('next').NextConfig} */

// In production, nginx proxies /api/* directly to the NestJS API so no rewrite
// is needed. In local dev there is no nginx so we rewrite to localhost:3001.
const isDev = process.env.NODE_ENV !== 'production';

// Some client components fetch NEXT_PUBLIC_API_URL directly (not through the /api/* same-origin
// rewrite above), so connect-src needs that origin explicitly, not just 'self'. The Socket.IO
// client (lib/socket.tsx) also connects to this same host but over ws:/wss: — a different scheme
// as far as CSP is concerned, confirmed live (a bare http(s) entry doesn't cover it), so both are
// listed.
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
let apiOrigin = '';
let apiWsOrigin = '';
try {
  apiOrigin = new URL(apiUrl).origin;
  apiWsOrigin = apiOrigin.replace(/^http/, 'ws');
} catch { /* leave blank if unset/invalid */ }

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=15552000; includeSubDomains' },
  {
    key: 'Content-Security-Policy',
    // script-src needs 'unsafe-inline': Next.js's App Router itself injects inline <script> tags
    // for hydration/RSC payload streaming, regardless of whether app code uses dangerouslySetInnerHTML
    // — confirmed by testing, a plain 'self' broke even the login page. A real nonce-based CSP would
    // avoid this but needs per-request middleware; not worth the added complexity/risk here.
    // style-src needs 'unsafe-inline' too, for the computed inline style={{...}} objects used
    // throughout the codebase. 'unsafe-eval' is dev-only — confirmed live that Next.js's Fast
    // Refresh runtime calls eval() to apply hot-reloaded modules; without it the dev server's own
    // JS crashes on every edit. Production builds don't use eval, so it's dropped there.
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' https: data: blob:",
      "font-src 'self' data:",
      `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ''}${apiWsOrigin ? ` ${apiWsOrigin}` : ''}`,
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; '),
  },
];

const nextConfig = {
  transpilePackages: ['@zuti/ui', '@zuti/types'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  ...(isDev && {
    async rewrites() {
      return [
        {
          source: '/api/:path*',
          destination: `${process.env.API_URL || 'http://localhost:3001'}/api/:path*`,
        },
      ];
    },
  }),
};

module.exports = nextConfig;
