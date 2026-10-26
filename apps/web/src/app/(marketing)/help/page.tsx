import type { Metadata } from 'next';
import { HelpIndex } from '@/components/marketing/HelpIndex';
import { PageHero, Section } from '@/components/marketing/Site';
import type { ArticleSummary } from '@/components/HelpWidgets';
import { API_URL } from '@/lib/serverApi';
import { pageMeta } from '@/lib/seo';

export const metadata: Metadata = pageMeta({
  title: 'Help Centre: How to Send and Sign Documents Online',
  description: 'Step-by-step guides to sending and e-signing documents, Aadhaar eSign and other India features, teams, security, billing and the API.',
  path: '/help',
  keywords: ['how to sign a PDF online', 'how to send a document for signature', 'Aadhaar eSign help'],
});

export const revalidate = 300;

async function loadArticles(): Promise<ArticleSummary[]> {
  try {
    const res = await fetch(`${API_URL}/api/v1/help/articles`, { next: { revalidate } });
    return res.ok ? ((await res.json()) as ArticleSummary[]) : [];
  } catch {
    return [];
  }
}

export default async function HelpPage() {
  const articles = await loadArticles();
  return (
    <>
      <PageHero eyebrow="Help centre" title="How can we help?" intro="Guides for senders, signers, admins and developers." />
      <Section>
        <HelpIndex articles={articles} />
      </Section>
    </>
  );
}
