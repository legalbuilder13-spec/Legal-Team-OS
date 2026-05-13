/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@legal/db', '@legal/types'],
  experimental: {
    serverActions: { bodySizeLimit: '10mb' },
  },
  webpack: (config) => {
    // Resolve TypeScript ESM-style `.js` imports to their `.ts` source.
    // Required because workspace packages (and our own routers) use the
    // NodeNext convention of writing `from './foo.js'` for what is actually
    // a `.ts` file. Next.js webpack does not do this by default.
    config.resolve.extensionAlias = {
      '.js': ['.js', '.ts', '.tsx'],
      '.jsx': ['.jsx', '.tsx'],
      '.mjs': ['.mjs', '.mts'],
      '.cjs': ['.cjs', '.cts'],
    };
    return config;
  },
};

export default nextConfig;
