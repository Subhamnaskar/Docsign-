'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Alert, Button, Card, cx, EmptyState, Input, Spinner, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import type { Envelope, EnvelopeStatus, EnvelopeSummary } from '@/lib/types';

const FILTERS: { label: string; status?: EnvelopeStatus }[] = [
  { label: 'All' },
  { label: 'Drafts', status: 'DRAFT' },
  { label: 'Out for signature', status: 'SENT' },
  { label: 'Completed', status: 'COMPLETED' },
  { label: 'Declined', status: 'DECLINED' },
  { label: 'Voided', status: 'VOIDED' },
  { label: 'Expired', status: 'EXPIRED' },
];

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <Card className="p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className={cx('mt-1 text-2xl font-semibold', tone)}>{value}</div>
    </Card>
  );
}

function Dashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<{ counts: Partial<Record<EnvelopeStatus, number>>; awaitingMe: number } | null>(null);
  const [items, setItems] = useState<EnvelopeSummary[] | null>(null);
  const [filter, setFilter] = useState<EnvelopeStatus | undefined>();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (filter) qs.set('status', filter);
    if (search.trim()) qs.set('search', search.trim());
    const res = await api<{ data: EnvelopeSummary[] }>(`/envelopes?${qs}`);
    setItems(res.data);
  }, [filter, search]);

  useEffect(() => {
    api<typeof stats>('/stats').then(setStats).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load().catch((e) => setError(e.message)), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  async function createEnvelope() {
    setCreating(true);
    try {
      const env = await api<Envelope>('/envelopes', { method: 'POST', json: { title: 'Untitled agreement' } });
      router.push(`/envelopes/${env.id}/edit`);
    } catch (err) {
      setError((err as Error).message);
      setCreating(false);
    }
  }

  const c = stats?.counts ?? {};
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Agreements</h1>
          <p className="text-sm text-gray-500">Send documents for signature and track their progress.</p>
        </div>
        <Button onClick={createEnvelope} loading={creating}>
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" /></svg>
          New agreement
        </Button>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Awaiting others" value={c.SENT ?? 0} tone="text-blue-700" />
        <Stat label="Completed" value={c.COMPLETED ?? 0} tone="text-green-700" />
        <Stat label="Drafts" value={c.DRAFT ?? 0} tone="text-gray-900" />
        <Stat label="Declined / expired" value={(c.DECLINED ?? 0) + (c.EXPIRED ?? 0)} tone="text-red-700" />
      </div>

      {error && (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <Card className="mt-6">
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 p-3">
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.label}
                onClick={() => setFilter(f.status)}
                className={cx(
                  'rounded-md px-3 py-1.5 text-sm font-medium',
                  filter === f.status ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-50',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <Input
            className="ml-auto max-w-xs"
            placeholder="Search title or recipient"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {!items ? (
          <div className="flex justify-center py-16 text-brand-600">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <EmptyState title={filter || search ? 'No matching agreements' : 'No agreements yet'}>
            {!filter && !search && 'Create your first agreement to send it for signature.'}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-gray-100">
            {items.map((e) => {
              const signers = e.recipients.filter((r) => r.role === 'SIGNER');
              const signed = signers.filter((r) => r.status === 'SIGNED').length;
              return (
                <li key={e.id}>
                  <Link
                    href={e.status === 'DRAFT' ? `/envelopes/${e.id}/edit` : `/envelopes/${e.id}`}
                    className="flex flex-wrap items-center gap-4 px-4 py-3.5 hover:bg-gray-50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-gray-900">{e.title}</div>
                      <div className="truncate text-sm text-gray-500">
                        {signers.length ? `To: ${signers.map((r) => r.name).join(', ')}` : 'No recipients yet'}
                      </div>
                    </div>
                    {e.status === 'SENT' && signers.length > 0 && (
                      <div className="hidden w-32 sm:block">
                        <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                          <div className="h-full rounded-full bg-brand-500" style={{ width: `${(signed / signers.length) * 100}%` }} />
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          {signed} of {signers.length} signed
                        </div>
                      </div>
                    )}
                    <span className="w-10 text-xs font-medium text-gray-400">{e.jurisdiction}</span>
                    <StatusBadge status={e.status} />
                    <span className="w-20 text-right text-xs text-gray-400">{relativeTime(e.updatedAt)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}

export default function DashboardPage() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}
