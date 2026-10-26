import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Section } from '@/components/marketing/Site';
import { Markdown } from '@/lib/markdown';
import { API_URL } from '@/lib/serverApi';
import { pageMeta } from '@/lib/seo';

interface Article {
  slug: string;
  title: string;
  category: string;
  summary: string;
  body: string;
}

export const revalidate = 300;

async function load(slug: string): Promise<Article | null> {
  try {
    const res = await fetch(`${API_URL}/api/v1/help/articles/${encodeURIComponent(slug)}`, { next: { revalidate } });
    return res.ok ? ((await res.json()) as Article) : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const a = await load((await params).slug);
  return a ? pageMeta({ title: a.title, description: a.summary, path: `/help/${a.slug}` }) : { title: 'Help centre' };
}

export default async function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const a = await load((await params).slug);
  if (!a) notFound();
  return (
    <Section>
      <article className="mx-auto max-w-2xl">
        <Link href="/help" className="text-sm text-gray-500 hover:text-gray-800">
          ← Help centre
        </Link>
        <p className="mt-6 text-sm font-semibold text-brand-600">{a.category}</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-gray-900">{a.title}</h1>
        <p className="mt-2 text-lg text-gray-600">{a.summary}</p>
        <div className="mt-8">
          <Markdown source={a.body} />
        </div>
        <div className="mt-12 rounded-xl bg-gray-50 p-5 text-sm text-gray-600">
          Didn&apos;t find what you need?{' '}
          <Link href="/help" className="font-medium text-brand-700 hover:underline">
            Search other articles or contact us
          </Link>
          .
        </div>
      </article>
    </Section>
  );
}
