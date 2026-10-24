import type { MetadataRoute } from 'next';
import { brand } from '@/lib/brand';

const PAGES = ['', '/product', '/compliance', '/developers', '/pricing', '/partners', '/contact', '/verify', '/legal/terms', '/legal/privacy'];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map((p) => ({ url: `https://${brand.domain}${p}`, changeFrequency: 'monthly', priority: p === '' ? 1 : 0.7 }));
}
