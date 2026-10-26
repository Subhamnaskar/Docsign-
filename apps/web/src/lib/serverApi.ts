/**
 * Where server-rendered pages reach the API. A separate API service sets
 * API_URL; on Vercel the API runs inside this app, so pages call the project's
 * own production address (API_URL can name a reachable one while a new custom
 * domain is still waiting for DNS).
 */
const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const BASES = [...new Set([process.env.API_URL, vercelUrl && `https://${vercelUrl}`].filter((b): b is string => !!b))];
if (!BASES.length) BASES.push('http://localhost:4000');

export const API_URL = BASES[0];

/**
 * GET /api/v1{path} from the first address that answers, so one unreachable
 * address (a domain without DNS yet) doesn't blank out prices or help articles.
 */
export async function serverApiFetch(path: string, revalidate: number): Promise<Response | null> {
  for (const base of BASES) {
    try {
      const res = await fetch(`${base}/api/v1${path}`, { next: { revalidate }, signal: AbortSignal.timeout(8000) });
      if (res.ok || res.status === 404) return res;
    } catch {
      // Unreachable: try the next address
    }
  }
  return null;
}
