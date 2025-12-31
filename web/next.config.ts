import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Enable server-side external packages for better-sqlite3
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
