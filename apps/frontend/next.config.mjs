/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    // Enforce types in CI; we still surface them locally via `next dev`.
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    proxyTimeout: 90_000,
  },
  transpilePackages: ['crypto-hash'],
  async headers() {
    return [
      {
        // The OAuth consent screen is a one-click "give this app access to your
        // workspace" decision. Anything that can frame it can hide it under a
        // decoy and have a signed-in admin click Approve (clickjacking), so it
        // must never be embeddable. The rest of the app stays frameable on
        // purpose (Whop embeds it).
        source: '/oauth/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: '/api/uploads/:path*',
        destination:
          process.env.STORAGE_PROVIDER === 'local' ? '/uploads/:path*' : '/404',
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/uploads/:path*',
        destination:
          process.env.STORAGE_PROVIDER === 'local'
            ? `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3000'}/uploads/:path*`
            : '/404',
      },
    ];
  },
};

export default nextConfig;
