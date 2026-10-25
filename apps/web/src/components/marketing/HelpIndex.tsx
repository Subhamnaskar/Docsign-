'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AskAssistant, type ArticleSummary, SupportForm, useArticleSearch } from '@/components/HelpWidgets';
import { Input } from '@/components/ui';

const ORDER = ['Getting started', 'Sending', 'Signing', 'India', 'Teams & security', 'Account', 'Developers'];

export function HelpIndex({ articles }: { articles: ArticleSummary[] }) {
  const [query, setQuery] = useState('');
  const results = useArticleSearch(articles, query);
  const groups = ORDER.map((c) => [c, results.filter((a) => a.category === c)] as const).filter(([, list]) => list.length);

  return (
    <div className="space-y-10">
      <div className="mx-auto max-w-2xl space-y-4">
        <Input placeholder="Search articles" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search articles" className="text-base" />
        <AskAssistant />
      </div>
      {articles.length === 0 && <p className="text-center text-gray-500">Articles are loading. Please refresh in a moment.</p>}
      {query && results.length === 0 && <p className="text-center text-gray-500">No articles match. Try other words, or contact us below.</p>}
      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
        {groups.map(([category, list]) => (
          <div key={category}>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{category}</h2>
            <ul className="mt-3 space-y-3">
              {list.map((a) => (
                <li key={a.slug}>
                  <Link href={`/help/${a.slug}`} className="group block rounded-xl border border-gray-200 p-4 hover:border-brand-300 hover:bg-brand-50/40">
                    <span className="font-medium text-gray-900 group-hover:text-brand-700">{a.title}</span>
                    <span className="mt-1 block text-sm text-gray-600">{a.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto max-w-xl rounded-2xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900">Still need help?</h2>
        <p className="mb-4 mt-1 text-sm text-gray-600">Send us a message and we&apos;ll reply by email.</p>
        <SupportForm signedIn={false} />
      </div>
    </div>
  );
}
