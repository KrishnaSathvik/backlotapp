import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The dev badge sits on top of the mobile tab bar.
  devIndicators: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Self-hosted builds (Docker/Node) use the standalone output. Vercel builds Next.js its own
  // way and doesn't need it.
  output: process.env.VERCEL ? undefined : 'standalone',
  // Native and large server-only packages stay out of the function bundles' transpilation.
  serverExternalPackages: ['sharp', 'pg', 'firebase-admin'],
  async headers() {
    // Private and app routes are never indexed (Launch L4). Their pages also carry a noindex meta
    // tag; the header covers API responses and anything without one. Keep in sync with
    // NOINDEX_PATHS in src/lib/site.ts.
    const noindex = { key: 'X-Robots-Tag', value: 'noindex, nofollow' };
    return [
      { source: '/:path*', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }] },
      ...['/app', '/app/:path*', '/login', '/account/:path*', '/api/:path*'].map((source) => ({ source, headers: [noindex] })),
    ];
  },
  webpack: (config, {dev}) => {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modify—file watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }
    return config;
  },
};

export default nextConfig;
