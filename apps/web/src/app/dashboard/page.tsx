'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AppShell, useMe } from '@/components/AppShell';
import { Alert, Button, Card, cx, EmptyState, Input, Select, Spinner, StatusBadge } from '@/components/ui';
import { api, fileUrl } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import type { Envelope, EnvelopeStatus, EnvelopeSummary } from '@/lib/types';
import { OnboardingChecklist } from '@/components/Onboarding';
import { type AppKey, useAppT } from '@/lib/appI18n';

const FILTERS: { label: string; status?: EnvelopeStatus }[] = [
  { label: 'All' },
  { label: 'Drafts', status: 'DRAFT' },
  { label: 'Out for signature', status: 'SENT' },
  { label: 'Completed', status: 'COMPLETED' },
  { label: 'Declined', status: 'DECLINED' },
  { label: 'Voided', status: 'VOIDED' },
  { label: 'Expired', status: 'EXPIRED' },
];

interface Folder {
  id: string;
  name: string;
  count: number;
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <Card className="p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className={cx('mt-1 text-2xl font-semibold', tone)}>{value}</div>
    </Card>
  );
}

function Folders({ folders, active, onSelect, onChange }: { folders: Folder[]; active: string | undefined; onSelect: (id: string | undefined) => void; onChange: () => void }) {
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const item = (id: string | undefined, label: string, count?: number) => (
    <button
      key={id ?? 'all'}
      onClick={() => onSelect(id)}
      className={cx('flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-sm', active === id ? 'bg-brand-50 font-medium text-brand-700' : 'text-gray-600 hover:bg-gray-100')}
    >
      <span className="truncate">{label}</span>
      {count !== undefined && <span className="text-xs text-gray-400">{count}</span>}
    </button>
  );
  return (
    <nav className="space-y-0.5">
      {item(undefined, 'All agreements')}
      {item('none', 'Not in a folder')}
      <div className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-gray-400">Folders</div>
      {folders.map((f) => (
        <div key={f.id} className="group relative">
          {item(f.id, f.name, f.count)}
          <button
            className="absolute right-8 top-1.5 hidden text-xs text-gray-400 hover:text-red-600 group-hover:block"
            title="Delete folder"
            onClick={async () => {
              if (!confirm(`Delete folder "${f.name}"? Its agreements are kept.`)) return;
              await api(`/folders/${f.id}`, { method: 'DELETE' });
              if (active === f.id) onSelect(undefined);
              onChange();
            }}
          >
            ✕
          </button>
        </div>
      ))}
      {adding ? (
        <form
          className="px-1 pt-1"
          onSubmit={async (e) => {
            e.preventDefault();
            await api('/folders', { method: 'POST', json: { name } });
            setName('');
            setAdding(false);
            onChange();
          }}
        >
          <Input autoFocus placeholder="Folder name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => !name && setAdding(false)} />
        </form>
      ) : (
        <button onClick={() => setAdding(true)} className="w-full rounded-md px-3 py-1.5 text-left text-sm text-brand-600 hover:bg-gray-100">
          + New folder
        </button>
      )}
    </nav>
  );
}

function Dashboard() {
  const router = useRouter();
  const me = useMe();
  const t = useAppT();
  const isAdmin = me?.user?.role !== 'MEMBER';
  const [stats, setStats] = useState<{ counts: Partial<Record<EnvelopeStatus, number>>; awaitingMe: number } | null>(null);
  const [items, setItems] = useState<EnvelopeSummary[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folder, setFolder] = useState<string | undefined>();
  const [filter, setFilter] = useState<EnvelopeStatus | undefined>();
  const [mine, setMine] = useState(false);
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFolders = useCallback(() => api<Folder[]>('/folders').then(setFolders), []);
  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (filter) qs.set('status', filter);
    if (search.trim()) qs.set('search', search.trim());
    if (folder) qs.set('folderId', folder);
    if (mine) qs.set('sender', 'me');
    if (awaitingApproval) qs.set('approval', 'pending');
    const res = await api<{ data: EnvelopeSummary[] }>(`/envelopes?${qs}`);
    setItems(res.data);
    setSelected(new Set());
  }, [filter, search, folder, mine, awaitingApproval]);

  useEffect(() => {
    api<typeof stats>('/stats').then(setStats).catch(() => {});
    loadFolders();
    // Search from the top bar arrives as ?q=
    const q = new URLSearchParams(window.location.search).get('q');
    if (q) setSearch(q);
  }, [loadFolders]);

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

  async function download() {
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch(fileUrl('/envelopes/download'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selected] }),
      });
      if (!res.ok) throw new Error((await res.json()).error?.message ?? 'Download failed');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await res.blob());
      a.download = `agreements-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  async function moveTo(folderId: string) {
    await Promise.all([...selected].map((id) => api(`/envelopes/${id}/folder`, { method: 'PATCH', json: { folderId: folderId || null } })));
    await Promise.all([load(), loadFolders()]);
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const selectedCompleted = items?.filter((e) => selected.has(e.id) && e.status === 'COMPLETED').length ?? 0;
  const c = stats?.counts ?? {};

  return (
    <>
      <OnboardingChecklist />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t('dash.title')}</h1>
          <p className="text-sm text-gray-500">{t('dash.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <a href={fileUrl(`/envelopes/export.csv${filter ? `?status=${filter}` : ''}`)} className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50">
            {t('dash.export')}
          </a>
          <Button onClick={createEnvelope} loading={creating}>
            {t('dash.new')}
          </Button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={t('dash.awaitingOthers')} value={c.SENT ?? 0} tone="text-blue-700" />
        <Stat label={t('dash.completed')} value={c.COMPLETED ?? 0} tone="text-green-700" />
        <Stat label={t('dash.drafts')} value={c.DRAFT ?? 0} tone="text-gray-900" />
        <Stat label={t('dash.declinedExpired')} value={(c.DECLINED ?? 0) + (c.EXPIRED ?? 0)} tone="text-red-700" />
      </div>

      {error && (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[200px_1fr]">
        <aside className="hidden lg:block">
          <Folders folders={folders} active={folder} onSelect={setFolder} onChange={() => Promise.all([loadFolders(), load()])} />
        </aside>
        <Card className="min-w-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 p-3">
            <div className="flex flex-wrap gap-1">
              {FILTERS.map((f) => (
                <button
                  key={f.label}
                  onClick={() => setFilter(f.status)}
                  className={cx('rounded-md px-3 py-1.5 text-sm font-medium', filter === f.status ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-50')}
                >
                  {f.status === 'SENT' ? t('dash.waiting') : f.status ? t(`status.${f.status}` as AppKey) : t('dash.filterAll')}
                </button>
              ))}
            </div>
            {isAdmin && (
              <label className="flex items-center gap-1.5 text-sm text-gray-600">
                <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> {t('dash.sentByMe')}
              </label>
            )}
            {me?.organization.approvalPolicy && me.organization.approvalPolicy !== 'off' && (
              <label className="flex items-center gap-1.5 text-sm text-gray-600">
                <input type="checkbox" checked={awaitingApproval} onChange={(e) => setAwaitingApproval(e.target.checked)} /> {t('dash.awaitingApproval')}
              </label>
            )}
            <Input className="ml-auto max-w-xs" placeholder={t('dash.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 bg-brand-50/50 px-4 py-2 text-sm">
              <span className="font-medium">{t('dash.selected', { n: selected.size })}</span>
              <Button size="sm" variant="secondary" loading={downloading} disabled={selectedCompleted === 0} onClick={download} title="Completed agreements only">
                {t('dash.downloadSigned')}{selectedCompleted > 0 ? ` (${selectedCompleted})` : ''}
              </Button>
              <Select className="w-44" value="" onChange={(e) => e.target.value !== '' && moveTo(e.target.value === '__none' ? '' : e.target.value)} aria-label="Move to folder">
                <option value="">{t('dash.moveToFolder')}</option>
                <option value="__none">{t('dash.removeFromFolder')}</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
              <button className="ml-auto text-gray-500 hover:text-gray-800" onClick={() => setSelected(new Set())}>
                {t('dash.clear')}
              </button>
            </div>
          )}

          {!items ? (
            <div className="flex justify-center py-16 text-brand-600">
              <Spinner />
            </div>
          ) : items.length === 0 ? (
            <EmptyState title={filter || search || folder ? t('dash.noMatching') : t('dash.noneYet')}>
              {!filter && !search && !folder && t('dash.createFirst')}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-gray-100">
              {items.map((e) => {
                const signers = e.recipients.filter((r) => r.role !== 'CC');
                const signed = signers.filter((r) => r.status === 'SIGNED').length;
                return (
                  <li key={e.id} className="flex items-center gap-3 px-4 hover:bg-gray-50">
                    <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} aria-label={`Select ${e.title}`} />
                    <Link href={e.status === 'DRAFT' ? `/envelopes/${e.id}/edit` : `/envelopes/${e.id}`} className="flex min-w-0 flex-1 flex-wrap items-center gap-4 py-3.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-gray-900">
                          {e.title}
                          {e.testMode && <span className="ml-2 rounded-full bg-amber-50 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase text-amber-800">{t('dash.test')}</span>}
                        </div>
                        <div className="truncate text-sm text-gray-500">
                          {signers.length ? t('dash.to', { names: signers.map((r) => r.name).join(', ') }) : t('dash.noRecipients')}
                          {isAdmin && e.sender && <span className="text-gray-400"> · {t('dash.from', { name: e.sender })}</span>}
                          {e.folder && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">{e.folder.name}</span>}
                        </div>
                      </div>
                      {e.status === 'SENT' && signers.length > 0 && (
                        <div className="hidden w-32 sm:block">
                          <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                            <div className="h-full rounded-full bg-brand-500" style={{ width: `${(signed / signers.length) * 100}%` }} />
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            {t('dash.signedOf', { signed, total: signers.length })}
                          </div>
                        </div>
                      )}
                      <span className="w-10 text-xs font-medium text-gray-400">{e.jurisdiction}</span>
                      {e.status === 'DRAFT' && e.approvalStatus === 'PENDING' ? (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">{t('dash.awaitingApproval')}</span>
                      ) : (
                        <>
                          <StatusBadge status={e.status} />
                          {e.inReview && <span className="inline-flex rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 ring-1 ring-inset ring-sky-200">{t('dash.inReview')}</span>}
                        </>
                      )}
                      <span className="w-20 text-right text-xs text-gray-400">{relativeTime(e.updatedAt)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

export default function DashboardPage() {
  return (
    <AppShell wide>
      <Dashboard />
    </AppShell>
  );
}
