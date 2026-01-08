import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Enable server-side external packages for better-sqlite3
  serverExternalPackages: ['better-sqlite3'],
  // Allow Tailscale and other dev origins
  allowedDevOrigins: ['omarchy.tail0a867a.ts.net'],
};

export default nextConfig;
