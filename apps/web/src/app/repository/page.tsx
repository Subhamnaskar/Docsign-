'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Card, cx, EmptyState, Input, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface Row {
  id: string;
  title: string;
  status: string;
  completedAt: string | null;
  parties: string[];
  nextDate: string | null;
  contract: { counterparty: string | null; value: number | null; currency: string | null; renewalDate: string | null; expiryDate: string | null; autoRenews: boolean; tags: string[] } | null;
}

const WINDOWS = [
  [0, 'All'],
  [30, 'Due in 30 days'],
  [90, 'Due in 90 days'],
] as const;

const money = (v: number, c: string | null) => new Intl.NumberFormat(c === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: c ?? 'INR', maximumFractionDigits: 0 }).format(v / 100);
const daysUntil = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);

function Repository() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [expiring, setExpiring] = useState(0);

  const load = useCallback(async () => {
    const q = new URLSearchParams();
    if (search.trim()) q.set('search', search.trim());
    if (tag) q.set('tag', tag);
    if (expiring) q.set('expiring', String(expiring));
    setRows(await api<Row[]>(`/repository?${q}`));
  }, [search, tag, expiring]);
  useEffect(() => {
    const t = setTimeout(() => load().catch(() => setRows([])), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search]);
  useEffect(() => {
    api<{ tag: string; count: number }[]>('/repository/tags').then(setTags).catch(() => {});
  }, []);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Repository</h1>
        <p className="text-sm text-gray-500">Completed agreements with their key terms. Add terms on an agreement (or extract them with AI) to track renewals.</p>
      </div>
      <Card className="mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 text-sm" role="group" aria-label="Due date">
          {WINDOWS.map(([days, label]) => (
            <button key={days} onClick={() => setExpiring(days)} aria-pressed={expiring === days} className={cx('rounded-md px-3 py-1.5 font-medium', expiring === days ? 'bg-brand-600 text-white' : 'text-gray-600 hover:text-gray-900')}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 12).map((t) => (
            <button key={t.tag} onClick={() => setTag(tag === t.tag ? null : t.tag)} className={cx('rounded-full px-2.5 py-1 text-xs font-medium', tag === t.tag ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')}>
              {t.tag} <span className="opacity-70">{t.count}</span>
            </button>
          ))}
        </div>
        <Input className="ml-auto w-full sm:w-64" placeholder="Search title, counterparty or signer" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
      </Card>
      <Card className="overflow-hidden">
        {!rows ? (
          <div className="flex justify-center py-16 text-brand-600"><Spinner /></div>
        ) : rows.length === 0 ? (
          <EmptyState title={search || tag || expiring ? 'No matching agreements' : 'No completed agreements yet'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Agreement</th>
                  <th className="px-4 py-2.5 font-medium">Counterparty</th>
                  <th className="px-4 py-2.5 text-right font-medium">Value</th>
                  <th className="px-4 py-2.5 font-medium">Renewal / expiry</th>
                  <th className="px-4 py-2.5 font-medium">Completed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => {
                  const due = r.nextDate ? daysUntil(r.nextDate) : null;
                  return (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link href={`/envelopes/${r.id}`} className="font-medium text-gray-900 hover:underline">{r.title}</Link>
                        {r.contract?.tags.length ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {r.contract.tags.map((t) => <span key={t} className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">{t}</span>)}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{r.contract?.counterparty ?? r.parties.join(', ')}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">{r.contract?.value !== null && r.contract?.value !== undefined ? money(r.contract.value, r.contract.currency) : '—'}</td>
                      <td className="px-4 py-3">
                        {r.nextDate ? (
                          <span className={cx(due !== null && due <= 30 ? 'font-medium text-amber-700' : 'text-gray-700')}>
                            {formatDate(r.nextDate)}
                            <span className="block text-xs text-gray-500">
                              {r.contract?.renewalDate ? (r.contract.autoRenews ? 'auto-renews' : 'renewal') : 'expires'}
                              {due !== null && due >= 0 ? ` · in ${due} day${due === 1 ? '' : 's'}` : ''}
                            </span>
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{formatDate(r.completedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

export default function RepositoryPage() {
  return (
    <AppShell wide>
      <Repository />
    </AppShell>
  );
}
