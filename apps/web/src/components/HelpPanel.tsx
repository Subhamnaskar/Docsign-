'use client';

import { useEffect, useState } from 'react';
import { AskAssistant, type ArticleSummary, SupportForm, useArticleSearch } from '@/components/HelpWidgets';
import { Input, Modal } from '@/components/ui';
import { api } from '@/lib/api';

/** In-app help: search articles, ask the assistant, or write to support. */
export function HelpPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [query, setQuery] = useState('');
  const [contact, setContact] = useState(false);
  const results = useArticleSearch(articles, query).slice(0, 6);
  useEffect(() => {
    if (open && !articles.length) api<ArticleSummary[]>('/help/articles').then(setArticles).catch(() => {});
  }, [open, articles.length]);

  return (
    <Modal open={open} onClose={onClose} title="Help" wide>
      {contact ? (
        <div>
          <button className="mb-3 text-sm text-gray-500 hover:text-gray-800" onClick={() => setContact(false)}>
            ← Back to articles
          </button>
          <SupportForm signedIn />
        </div>
      ) : (
        <div className="space-y-4">
          <AskAssistant compact />
          <Input placeholder="Search help articles" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search help articles" />
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {results.map((a) => (
              <li key={a.slug}>
                <a href={`/help/${a.slug}`} target="_blank" rel="noreferrer" className="block px-3 py-2.5 hover:bg-gray-50">
                  <span className="text-sm font-medium text-gray-900">{a.title}</span>
                  <span className="block text-xs text-gray-500">{a.summary}</span>
                </a>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <a href="/help" target="_blank" rel="noreferrer" className="font-medium text-brand-700 hover:underline">
              Open the help centre
            </a>
            <button className="font-medium text-brand-700 hover:underline" onClick={() => setContact(true)}>
              Contact support
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
