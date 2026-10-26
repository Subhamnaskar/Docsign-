/**
 * Where server-rendered pages reach the API. A separate API service sets
 * API_URL; on Vercel the API runs inside this app, so pages call the
 * project's own production address.
 */
const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
export const API_URL = process.env.API_URL ?? (vercelUrl ? `https://${vercelUrl}` : 'http://localhost:4000');
