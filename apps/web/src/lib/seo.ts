import type { Metadata } from 'next';
import { brand } from './brand';

/** The one address search engines should index (other hosts are noindex, see middleware.ts). */
export const SITE_URL = `https://${brand.domain}`;

const SHARE_IMAGE = { url: '/opengraph-image', width: 1200, height: 630, alt: `${brand.name}: e-signatures for India and the world` };

/**
 * Metadata for a public page: its own title and description, the canonical
 * address, and the share card used by LinkedIn, WhatsApp, X and Facebook.
 * The share image is app/opengraph-image.tsx.
 */
export function pageMeta({ title, description, path, keywords }: { title: string; description: string; path: string; keywords?: string[] }): Metadata {
  return {
    title,
    description,
    keywords,
    alternates: { canonical: path },
    // Named explicitly: a page's own openGraph replaces the inherited one, image included
    openGraph: { title, description, url: path, siteName: brand.name, type: 'website', locale: 'en_IN', images: [SHARE_IMAGE] },
    twitter: { card: 'summary_large_image', title, description, images: [SHARE_IMAGE.url] },
  };
}

/** Structured data for search results (schema.org), rendered as JSON-LD. */
export const organizationLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: brand.legalEntity,
  url: SITE_URL,
  logo: `${SITE_URL}/icons/icon-512.png`,
  email: brand.supportEmail,
  brand: { '@type': 'Brand', name: brand.name },
  sameAs: Object.values(brand.social).filter(Boolean),
};

export const websiteLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: brand.name,
  url: SITE_URL,
  publisher: { '@type': 'Organization', name: brand.legalEntity },
};

/** The product as a web application, with its free tier and plan prices (INR, per user per month). */
export function softwareLd(prices: { name: string; inr: number }[] = []) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: brand.name,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web, Android, iOS',
    url: SITE_URL,
    description: brand.description,
    publisher: { '@type': 'Organization', name: brand.legalEntity },
    offers: [
      { '@type': 'Offer', name: 'Sign a document yourself', price: '0', priceCurrency: 'INR', url: `${SITE_URL}/sign-yourself` },
      ...prices.map((p) => ({ '@type': 'Offer', name: p.name, price: String(p.inr), priceCurrency: 'INR', url: `${SITE_URL}/pricing` })),
    ],
  };
}

export function faqLd(items: [question: string, answer: string][]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  };
}

export function breadcrumbLd(items: [name: string, path: string][]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${SITE_URL}${path}` })),
  };
}
