import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

const api = JSON.parse(readFileSync(path.join(__dirname, '../api/package.json'), 'utf8')) as { dependencies: Record<string, string> };

/**
 * Two ways to reach the API:
 * - Separate API service (local dev, Docker, Render): /api is proxied to API_URL.
 * - EMBEDDED_API=true (Vercel): the API runs inside this app as a serverless
 *   function (vercel/api-route.ts, copied into src/pages/api by the Vercel build).
 * Either way the browser only talks to this origin, so session cookies stay first-party.
 */
const embedded = process.env.EMBEDDED_API === 'true';
const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  async rewrites() {
    if (embedded) return [];
    // beforeFiles: the proxy wins over any route in this app
    return { beforeFiles: [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }], afterFiles: [], fallback: [] };
  },
  ...(embedded && {
    // The API source lives in ../api and is compiled into the function
    outputFileTracingRoot: path.join(__dirname, '../..'),
    experimental: { externalDir: true },
    // The API's libraries are loaded from node_modules at runtime rather than bundled
    serverExternalPackages: Object.keys(api.dependencies),
    webpack(config) {
      // The API uses ESM-style ".js" imports for its TypeScript files
      config.resolve.extensionAlias = { '.js': ['.ts', '.js'] };
      return config;
    },
  }),
};

export default nextConfig;
