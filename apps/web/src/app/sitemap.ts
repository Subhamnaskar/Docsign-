import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';
import { API_URL } from '@/lib/serverApi';
import { SOLUTIONS } from '@/lib/solutions';

export const revalidate = 3600;

const PAGES: [path: string, priority: number][] = [
  ['', 1],
  ['/sign-yourself', 0.9],
  ['/pricing', 0.9],
  ['/product', 0.8],
  ['/compliance', 0.8],
  ['/developers', 0.7],
  ['/register', 0.7],
  ['/help', 0.6],
  ['/partners', 0.5],
  ['/contact', 0.6],
  ['/verify', 0.5],
  ['/legal/terms', 0.2],
  ['/legal/privacy', 0.2],
  ...SOLUTIONS.map((s) => [`/solutions/${s.slug}`, 0.8] as [string, number]),
];

async function helpArticles(): Promise<string[]> {
  try {
    const res = await fetch(`${API_URL}/api/v1/help/articles`, { next: { revalidate } });
    if (!res.ok) return [];
    const body = (await res.json()) as { slug: string }[] | { articles?: { slug: string }[] };
    return (Array.isArray(body) ? body : (body.articles ?? [])).map((a) => `/help/${a.slug}`);
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  return [
    ...PAGES.map(([path, priority]) => ({ url: `${SITE_URL}${path}`, lastModified: now, changeFrequency: 'weekly' as const, priority })),
    ...(await helpArticles()).map((path) => ({ url: `${SITE_URL}${path}`, lastModified: now, changeFrequency: 'monthly' as const, priority: 0.5 })),
  ];
}
