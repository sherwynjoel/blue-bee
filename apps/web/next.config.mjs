/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The workspace packages ship a built CJS dist; transpile them so Next handles the React hook
  // (useAuthSession) + types cleanly across the monorepo.
  transpilePackages: ['@blue-bee/shared', '@blue-bee/api-client'],
  eslint: {
    // We run `next lint` explicitly in CI/turbo; don't fail `next build` on lint (build proves bundling).
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
