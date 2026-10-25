import type { MetadataRoute } from 'next';
import { brand } from '@/lib/brand';
import { SOLUTIONS } from '@/lib/solutions';

const PAGES = ['', '/product', '/compliance', '/developers', '/pricing', '/help', '/partners', '/contact', '/verify', '/legal/terms', '/legal/privacy', ...SOLUTIONS.map((s) => `/solutions/${s.slug}`)];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map((p) => ({ url: `https://${brand.domain}${p}`, changeFrequency: 'monthly', priority: p === '' ? 1 : 0.7 }));
}
