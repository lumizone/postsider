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
