import type { Metadata } from 'next';
import { HelpIndex } from '@/components/marketing/HelpIndex';
import { PageHero, Section } from '@/components/marketing/Site';
import type { ArticleSummary } from '@/components/HelpWidgets';
import { API_URL } from '@/lib/serverApi';

export const metadata: Metadata = {
  title: 'Help centre',
  description: 'Guides for sending and signing agreements, India features, teams, security, billing and the API.',
};

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
