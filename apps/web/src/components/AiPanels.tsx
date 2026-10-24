'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { Alert, Button, Card, cx, Input } from './ui';

interface Review {
  overallRisk: 'low' | 'medium' | 'high';
  overview: string;
  findings: { clause: string; issue: string; severity: 'low' | 'medium' | 'high'; suggestion: string; page: number | null }[];
  missingClauses: string[];
  disclaimer: string;
}

const SEVERITY: Record<string, string> = {
  low: 'bg-gray-100 text-gray-700',
  medium: 'bg-amber-50 text-amber-800',
  high: 'bg-red-50 text-red-700',
};

/** Contract review for the sender. */
export function AiReviewPanel({ envelopeId }: { envelopeId: string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      setReview(await api<Review>(`/envelopes/${envelopeId}/ai/review`, { method: 'POST' }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">AI contract review</h3>
        {!review && (
          <Button size="sm" variant="secondary" loading={loading} onClick={run}>
            Review
          </Button>
        )}
      </div>
      {!review && !error && <p className="mt-1 text-xs text-gray-500">Flags risky or one-sided clauses and missing terms before you send.</p>}
      {error && (
        <div className="mt-2">
          <Alert>{error}</Alert>
        </div>
      )}
      {review && (
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-2">
            <span className={cx('rounded-full px-2 py-0.5 text-xs font-semibold capitalize', SEVERITY[review.overallRisk])}>{review.overallRisk} risk</span>
          </div>
          <p className="text-gray-700">{review.overview}</p>
          {review.findings.length > 0 && (
            <ul className="space-y-2">
              {review.findings.map((f, i) => (
                <li key={i} className="rounded-lg border border-gray-200 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{f.clause}</span>
                    <span className={cx('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', SEVERITY[f.severity])}>{f.severity}</span>
                  </div>
                  <p className="mt-1 text-gray-600">{f.issue}</p>
                  <p className="mt-1 text-gray-800">
                    <span className="font-medium">Suggestion: </span>
                    {f.suggestion}
                    {f.page && <span className="text-gray-400"> (page {f.page})</span>}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {review.missingClauses.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Possibly missing</div>
              <ul className="mt-1 list-disc pl-4 text-gray-700">
                {review.missingClauses.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-gray-400">{review.disclaimer}</p>
        </div>
      )}
    </Card>
  );
}

interface Answer {
  text: string;
  citations: { document: string; page: number | null; quote: string }[];
}

/** Questions about the agreement, answered with citations. */
export function AiAskPanel({ envelopeId }: { envelopeId: string }) {
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<{ q: string; a: Answer }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    try {
      const a = await api<Answer>(`/envelopes/${envelopeId}/ai/ask`, { method: 'POST', json: { question: q } });
      setHistory((h) => [...h, { q, a }]);
      setQuestion('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-4 text-sm">
      <h3 className="font-semibold">Ask about this agreement</h3>
      <div className="mt-3 space-y-3">
        {history.map((h, i) => (
          <div key={i}>
            <p className="font-medium text-gray-900">{h.q}</p>
            <p className="mt-1 whitespace-pre-wrap text-gray-700">{h.a.text}</p>
            {h.a.citations.length > 0 && (
              <ul className="mt-1 space-y-1">
                {h.a.citations.map((c, j) => (
                  <li key={j} className="border-l-2 border-brand-100 pl-2 text-xs text-gray-500">
                    “{c.quote}” <span className="text-gray-400">({c.document}{c.page ? `, p. ${c.page}` : ''})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      {error && (
        <div className="mt-2">
          <Alert>{error}</Alert>
        </div>
      )}
      <form onSubmit={ask} className="mt-3 flex gap-2">
        <Input placeholder="e.g. When can either party terminate?" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={1000} />
        <Button type="submit" size="sm" loading={loading} disabled={!question.trim()}>
          Ask
        </Button>
      </form>
    </Card>
  );
}

interface Summary {
  summary: string;
  keyTerms: { term: string; detail: string }[];
  yourObligations: string[];
  datesAndAmounts: string[];
  worthCheckingBeforeSigning: string[];
  disclaimer: string;
}

/** Plain-language summary for the signer, in their language. */
export function SignerSummary({ token, locale, label }: { token: string; locale: string; label: string }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function load() {
    setOpen(true);
    if (summary) return;
    setLoading(true);
    setError(null);
    try {
      setSummary(await api<Summary>(`/signing/${token}/ai/summary`, { method: 'POST', json: { locale } }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={load}>
        ✨ {label}
      </Button>
    );
  }
  return (
    <Card className="mb-6 p-5 text-sm">
      {loading && <p className="text-gray-500">…</p>}
      {error && <Alert>{error}</Alert>}
      {summary && (
        <div className="space-y-3">
          <p className="text-gray-800">{summary.summary}</p>
          {summary.keyTerms.length > 0 && (
            <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
              {summary.keyTerms.map((k) => (
                <div key={k.term} className="contents">
                  <dt className="font-medium text-gray-900">{k.term}</dt>
                  <dd className="text-gray-600">{k.detail}</dd>
                </div>
              ))}
            </dl>
          )}
          {[summary.yourObligations, summary.datesAndAmounts].map(
            (list, i) =>
              list.length > 0 && (
                <ul key={i} className="list-disc pl-5 text-gray-700">
                  {list.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              ),
          )}
          {summary.worthCheckingBeforeSigning.length > 0 && (
            <Alert tone="warning">
              <ul className="list-disc pl-4">
                {summary.worthCheckingBeforeSigning.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </Alert>
          )}
          <p className="text-xs text-gray-400">{summary.disclaimer}</p>
          <button onClick={() => setOpen(false)} className="text-xs text-gray-500 hover:text-gray-800">
            Hide
          </button>
        </div>
      )}
    </Card>
  );
}
