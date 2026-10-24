import type { MetadataRoute } from 'next';
import { brand } from '@/lib/brand';

export default function robots(): MetadataRoute.Robots {
  return {
    // Keep the signed-in app, signing links and the API out of search results
    rules: { userAgent: '*', allow: '/', disallow: ['/dashboard', '/envelopes', '/templates', '/settings', '/sign/', '/f/', '/invite/', '/api/'] },
    sitemap: `https://${brand.domain}/sitemap.xml`,
  };
}
