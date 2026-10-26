import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';

/** Private areas stay out of search results; other hosts (vercel.app) are noindex in middleware.ts. */
const PRIVATE = [
  '/dashboard', '/home', '/envelopes', '/templates', '/settings', '/reports', '/admin', '/contacts', '/workflows', '/repository',
  '/sign/', '/f/', '/embed/', '/invite/', '/office/', '/verify-email/', '/reset-password/', '/forgot-password', '/login', '/api/',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: PRIVATE },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
