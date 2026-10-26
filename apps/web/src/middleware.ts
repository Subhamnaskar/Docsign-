import { NextResponse, type NextRequest } from 'next/server';

const API_URL = process.env.API_URL;
const OFFICE_ORIGINS = ['https://*.officeapps.live.com', 'https://*.office.com', 'https://*.office365.com', 'https://outlook.live.com', 'https://*.sharepoint.com', 'https://*.microsoft365.com'];

/**
 * Clickjacking protection. Pages can only be framed by this site, except
 * embedded signing pages, which the sending organisation's allowed origins
 * (Settings → Organization) may also frame.
 */
export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  let origins: string[] = [];
  const m = /^\/(sign|embed)\/([^/]+)/.exec(req.nextUrl.pathname);
  if (m) {
    const param = m[1] === 'sign' ? 'token' : 'ticket';
    try {
      const r = await fetch(`${API_URL ?? req.nextUrl.origin}/api/v1/frame-origins?${param}=${encodeURIComponent(m[2])}`, { cache: 'no-store' });
      // The API only stores validated https?://host origins, so they are safe to place in the header
      if (r.ok) origins = ((await r.json()).origins as string[]) ?? [];
    } catch {
      // API unreachable: fall back to the strict policy
    }
  }
  // The Office task pane is framed by Office on the web
  if (req.nextUrl.pathname.startsWith('/office/taskpane')) origins = OFFICE_ORIGINS;
  res.headers.set('Content-Security-Policy', ["frame-ancestors 'self'", ...origins].join(' '));
  return res;
}

export const config = {
  matcher: ['/((?!_next/|api/|favicon|pdf\\.worker).*)'],
};
