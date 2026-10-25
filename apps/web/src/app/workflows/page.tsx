'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell, useMe } from '@/components/AppShell';
import { Icon } from '@/components/marketing/Icons';
import { Alert, Card, cx, PageLoader } from '@/components/ui';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { ACTION_LABELS, RECIPES, TRIGGER_LABELS, type Workflow } from '@/lib/workflows';

export default function WorkflowsPage() {
  return (
    <AppShell wide>
      <Workflows />
    </AppShell>
  );
}

function Workflows() {
  const me = useMe();
  const admin = me?.user?.role === 'OWNER' || me?.user?.role === 'ADMIN';
  const [list, setList] = useState<Workflow[] | null>(null);
  const load = () => api<{ workflows: Workflow[] }>('/workflows').then((r) => setList(r.workflows));
  useEffect(() => {
    load();
  }, []);

  async function toggle(w: Workflow) {
    await api(`/workflows/${w.id}`, { method: 'PATCH', json: { enabled: !w.enabled } });
    load();
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Workflows</h1>
          <p className="text-sm text-gray-500">Automate what happens when agreements are sent, signed, declined or completed.</p>
        </div>
        {admin && (
          <Link href="/workflows/new" className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-ink shadow-sm hover:brightness-105">
            + New workflow
          </Link>
        )}
      </div>
      {!admin && (
        <div className="mt-4">
          <Alert tone="info">Only owners and admins can create or change workflows.</Alert>
        </div>
      )}

      {!list ? (
        <PageLoader />
      ) : (
        <>
          {list.length > 0 && (
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              {list.map((w) => (
                <Card key={w.id} className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/workflows/${w.id}`} className="min-w-0">
                      <h2 className="truncate font-semibold text-ink hover:underline">{w.name}</h2>
                      {w.description && <p className="mt-0.5 truncate text-sm text-gray-500">{w.description}</p>}
                    </Link>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={w.enabled}
                      aria-label={w.enabled ? 'Pause workflow' : 'Turn on workflow'}
                      disabled={!admin}
                      onClick={() => toggle(w)}
                      className={cx('relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50', w.enabled ? 'bg-brand-500' : 'bg-gray-300')}
                    >
                      <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition', w.enabled ? 'left-[22px]' : 'left-0.5')} />
                    </button>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-md bg-night px-2 py-1 font-semibold text-white">When</span>
                    <span className="text-gray-700">{TRIGGER_LABELS[w.trigger]}</span>
                    {w.conditions.length > 0 && <span className="rounded-md bg-gray-100 px-2 py-1 text-gray-600">{w.conditions.length} condition{w.conditions.length === 1 ? '' : 's'}</span>}
                    <Icon name="arrow" className="h-3.5 w-3.5 text-gray-400" />
                    {w.actions.map((a, i) => (
                      <span key={i} className="rounded-md bg-brand-50 px-2 py-1 font-medium text-brand-700">
                        {ACTION_LABELS[a.type]}
                      </span>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-gray-500">
                    {w.runCount} run{w.runCount === 1 ? '' : 's'}
                    {w.lastRunAt && ` · last ${relativeTime(w.lastRunAt)}`}
                    {!!w.failedThisWeek && <span className="font-medium text-red-700"> · {w.failedThisWeek} failed this week</span>}
                    {!w.enabled && ' · paused'}
                  </p>
                </Card>
              ))}
            </div>
          )}

          <h2 className="mt-10 text-lg font-semibold">{list.length ? 'Start from a recipe' : 'Get started with a recipe'}</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {RECIPES.map((r) => (
              <Link
                key={r.id}
                href={admin ? `/workflows/new?recipe=${r.id}` : '/workflows'}
                className="group rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-brand-100">
                  <Icon name="flow" className="h-5 w-5" />
                </span>
                <h3 className="mt-3 font-semibold text-ink">{r.name}</h3>
                <p className="mt-1 text-sm text-gray-500">{r.description}</p>
                {admin && <span className="mt-3 inline-block text-sm font-semibold text-brand-700 group-hover:underline">Use this recipe</span>}
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
