/** @type {import('next').NextConfig} */

// In production, nginx proxies /api/* directly to the NestJS API so no rewrite
// is needed. In local dev there is no nginx so we rewrite to localhost:3001.
const isDev = process.env.NODE_ENV !== 'production';

const nextConfig = {
  transpilePackages: ['@zuti/ui', '@zuti/types'],
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
