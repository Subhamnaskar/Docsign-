'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppShell, useMe } from '@/components/AppShell';
import { Icon, type IconName } from '@/components/marketing/Icons';
import { Alert, Card, cx, PageLoader, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { AUDIT_LABELS, formatDate, relativeTime } from '@/lib/format';
import type { EnvelopeStatus } from '@/lib/types';

interface Item {
  id: string;
  title: string;
  status: EnvelopeStatus;
  sentAt: string | null;
  expiresAt: string | null;
  updatedAt: string;
}
interface Home {
  name: string | null;
  counts: { drafts: number; awaitingOthers: number; completedThisMonth: number; toSign: number };
  attention: { toSign: Item[]; expiring: Item[]; declined: Item[]; inReview: Item[]; awaitingApproval: Item[] };
  renewals: { envelope: { id: string; title: string }; counterparty: string | null; date: string; kind: 'renewal' | 'expiry'; autoRenews: boolean; noticeDays: number | null }[];
  activity: { id: string; type: string; actor: { name?: string; email?: string; kind: string }; createdAt: string; envelope: { id: string; title: string } }[];
  workflows: { enabled: number; failedThisWeek: number };
}

const ATTENTION: { key: keyof Home['attention']; label: string; note: (i: Item) => string; tone: string }[] = [
  { key: 'toSign', label: 'Waiting for your signature', note: () => 'Open and sign', tone: 'text-brand-700' },
  { key: 'inReview', label: 'Signers left comments', note: () => 'Review the comments', tone: 'text-sky-700' },
  { key: 'awaitingApproval', label: 'Waiting for approval', note: () => 'Approve before it is sent', tone: 'text-violet-700' },
  { key: 'expiring', label: 'Expiring soon', note: (i) => (i.expiresAt ? `Expires ${formatDate(i.expiresAt, false)}` : ''), tone: 'text-amber-700' },
  { key: 'declined', label: 'Declined recently', note: (i) => `Declined ${relativeTime(i.updatedAt)}`, tone: 'text-red-700' },
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function HomePage() {
  return (
    <AppShell wide>
      <HomeView />
    </AppShell>
  );
}

function HomeView() {
  const router = useRouter();
  const me = useMe();
  const [data, setData] = useState<Home | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    api<Home>('/home').then(setData).catch((e) => setError(e.message));
  }, []);

  async function newAgreement() {
    setCreating(true);
    try {
      const env = await api<{ id: string }>('/envelopes', { method: 'POST', json: { title: 'Untitled agreement' } });
      router.push(`/envelopes/${env.id}/edit`);
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  }

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <PageLoader />;
  const attentionCount = ATTENTION.reduce((n, a) => n + data.attention[a.key].length, 0);
  const admin = me?.user?.role === 'OWNER' || me?.user?.role === 'ADMIN';

  const actions: { label: string; note: string; icon: IconName; onClick?: () => void; href?: string; primary?: boolean }[] = [
    { label: 'New agreement', note: 'Upload a document and send it', icon: 'pen', onClick: newAgreement, primary: true },
    { label: 'Use a template', note: 'Start from a saved layout', icon: 'layers', href: '/templates' },
    { label: 'Add a contact', note: 'Save someone you send to', icon: 'users', href: '/contacts?new=1' },
    { label: 'Create a workflow', note: 'Automate what happens next', icon: 'flow', href: admin ? '/workflows/new' : '/workflows' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {greeting()}
          {data.name ? `, ${data.name.split(' ')[0]}` : ''}
        </h1>
        <p className="mt-1 text-sm text-gray-500">{attentionCount ? `${attentionCount} thing${attentionCount === 1 ? '' : 's'} need your attention.` : 'You are all caught up.'}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {actions.map((a) => {
          const body = (
            <>
              <span className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', a.primary ? 'bg-gold text-ink' : 'bg-brand-50 text-brand-600 ring-1 ring-brand-100')}>
                <Icon name={a.icon} className="h-5 w-5" />
              </span>
              <span className="min-w-0 text-left">
                <span className="block font-semibold text-ink">{a.label}</span>
                <span className="block text-xs text-gray-500">{a.note}</span>
              </span>
            </>
          );
          const cls = 'flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md disabled:opacity-60';
          return a.href ? (
            <Link key={a.label} href={a.href} className={cls}>
              {body}
            </Link>
          ) : (
            <button key={a.label} type="button" onClick={a.onClick} disabled={creating} className={cls}>
              {body}
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Waiting for others', value: data.counts.awaitingOthers, href: '/dashboard' },
          { label: 'Waiting for you', value: data.counts.toSign, href: '/dashboard' },
          { label: 'Drafts', value: data.counts.drafts, href: '/dashboard' },
          { label: 'Completed this month', value: data.counts.completedThisMonth, href: '/dashboard' },
        ].map((s) => (
          <Link key={s.label} href={s.href} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-brand-200">
            <div className="text-sm text-gray-500">{s.label}</div>
            <div className="mt-1 text-3xl font-bold tabular-nums text-ink">{s.value}</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-5">
          <h2 className="font-semibold">Needs your attention</h2>
          {attentionCount === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">Nothing needs you right now.</p>
          ) : (
            <div className="mt-3 space-y-5">
              {ATTENTION.filter((a) => data.attention[a.key].length > 0).map((a) => (
                <div key={a.key}>
                  <p className={cx('text-xs font-semibold uppercase tracking-wide', a.tone)}>{a.label}</p>
                  <ul className="mt-1.5 divide-y divide-gray-100">
                    {data.attention[a.key].map((i) => (
                      <li key={i.id}>
                        <Link href={`/envelopes/${i.id}`} className="flex items-center gap-3 py-2.5 hover:bg-gray-50">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                            <Icon name="document" className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-ink">{i.title}</span>
                            <span className="block text-xs text-gray-500">{a.note(i)}</span>
                          </span>
                          <StatusBadge status={i.status} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Upcoming renewals</h2>
              <Link href="/repository" className="text-sm font-medium text-brand-700 hover:underline">
                Repository
              </Link>
            </div>
            <ul className="mt-3 divide-y divide-gray-100">
              {data.renewals.map((r) => (
                <li key={r.envelope.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <Link href={`/envelopes/${r.envelope.id}`} className="min-w-0">
                    <span className="block truncate font-medium text-ink hover:underline">{r.envelope.title}</span>
                    <span className="block text-xs text-gray-500">
                      {r.counterparty ?? 'No counterparty'}
                      {r.noticeDays ? ` · ${r.noticeDays} days' notice` : ''}
                    </span>
                  </Link>
                  <span className="shrink-0 text-right text-xs">
                    <span className="block font-semibold text-amber-800">{formatDate(r.date, false)}</span>
                    <span className="text-gray-500">{r.kind === 'renewal' ? (r.autoRenews ? 'Auto-renews' : 'Renewal') : 'Expires'}</span>
                  </span>
                </li>
              ))}
              {data.renewals.length === 0 && <li className="py-6 text-center text-sm text-gray-500">No renewals in the next 60 days.</li>}
            </ul>
          </Card>
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Workflows</h2>
              <Link href="/workflows" className="text-sm font-medium text-brand-700 hover:underline">
                Manage
              </Link>
            </div>
            <p className="mt-2 text-sm text-gray-600">
              {data.workflows.enabled} active workflow{data.workflows.enabled === 1 ? '' : 's'}
              {data.workflows.failedThisWeek > 0 && <span className="font-medium text-red-700"> · {data.workflows.failedThisWeek} failed run{data.workflows.failedThisWeek === 1 ? '' : 's'} this week</span>}
            </p>
          </Card>
        </div>
      </div>

      <Card className="p-5">
        <h2 className="font-semibold">Recent activity</h2>
        <ul className="mt-3 divide-y divide-gray-100">
          {data.activity.map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-2.5 text-sm">
              <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" />
              <span className="min-w-0 flex-1">
                <span className="font-medium text-ink">{AUDIT_LABELS[a.type] ?? a.type}</span>
                {a.actor.name && <span className="text-gray-500"> by {a.actor.name}</span>}
                <span className="text-gray-500"> · </span>
                <Link href={`/envelopes/${a.envelope.id}`} className="text-brand-700 hover:underline">
                  {a.envelope.title}
                </Link>
              </span>
              <span className="shrink-0 text-xs text-gray-400">{relativeTime(a.createdAt)}</span>
            </li>
          ))}
          {data.activity.length === 0 && <li className="py-6 text-center text-sm text-gray-500">Activity on your agreements shows up here.</li>}
        </ul>
      </Card>
    </div>
  );
}
