'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Input, Label, Textarea } from '@/components/ui';
import { api } from '@/lib/api';

export interface ArticleSummary {
  slug: string;
  title: string;
  category: string;
  summary: string;
}

/** Filters articles by words in their title and summary. */
export function useArticleSearch(articles: ArticleSummary[], query: string) {
  return useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
    if (!words.length) return articles;
    return articles
      .map((a) => {
        const hay = `${a.title} ${a.summary} ${a.category}`.toLowerCase();
        return { a, score: words.filter((w) => hay.includes(w)).length };
      })
      .filter((x) => x.score > 0)
      .sort((x, y) => y.score - x.score)
      .map((x) => x.a);
  }, [articles, query]);
}

/** "Ask a question" box backed by the help assistant (hidden when AI is off). */
export function AskAssistant({ compact = false }: { compact?: boolean }) {
  const [available, setAvailable] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<{ answer: string; answered: boolean; articles: { slug: string; title: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ available: boolean }>('/help/assistant').then((r) => setAvailable(r.available)).catch(() => {});
  }, []);
  if (!available) return null;

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setAnswer(await api('/help/ask', { method: 'POST', json: { question } }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={compact ? '' : 'rounded-2xl border border-brand-100 bg-brand-50/60 p-5'}>
      <form onSubmit={ask} className="flex gap-2">
        <Input placeholder="Ask a question, e.g. How do I add a second signer?" value={question} onChange={(e) => setQuestion(e.target.value)} aria-label="Question" />
        <Button type="submit" loading={busy} disabled={question.trim().length < 3}>
          Ask
        </Button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {answer && (
        <div className="mt-3 rounded-lg bg-white p-4 text-sm text-gray-700 shadow-sm">
          <p className="whitespace-pre-line">{answer.answer}</p>
          {answer.articles.length > 0 && (
            <p className="mt-2 text-xs text-gray-500">
              Read more:{' '}
              {answer.articles.map((a, i) => (
                <span key={a.slug}>
                  {i > 0 && ' · '}
                  <Link href={`/help/${a.slug}`} className="font-medium text-brand-700 hover:underline">{a.title}</Link>
                </span>
              ))}
            </p>
          )}
          <p className="mt-2 text-[11px] text-gray-400">Answered by AI from our help articles. It can make mistakes.</p>
        </div>
      )}
    </div>
  );
}

/** Contact form; signed-in users don't need to enter an email. */
export function SupportForm({ signedIn, onSent }: { signedIn: boolean; onSent?: () => void }) {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/support', { method: 'POST', json: { subject, message, page: window.location.pathname, ...(signedIn ? {} : { email }) } });
      setSent(true);
      onSent?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <Alert tone="success">Thanks. We&apos;ve emailed you a confirmation and will reply soon.</Alert>;
  return (
    <form onSubmit={send} className="space-y-3">
      {error && <Alert>{error}</Alert>}
      {!signedIn && (
        <div>
          <Label htmlFor="sup-email">Your email</Label>
          <Input id="sup-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      )}
      <div>
        <Label htmlFor="sup-subject">Subject</Label>
        <Input id="sup-subject" required minLength={3} value={subject} onChange={(e) => setSubject(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="sup-message">How can we help?</Label>
        <Textarea id="sup-message" required minLength={10} rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
      </div>
      <Button type="submit" loading={busy}>Send to support</Button>
    </form>
  );
}
