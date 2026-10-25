'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card, cx } from '@/components/ui';
import { api } from '@/lib/api';

interface Onboarding {
  dismissed: boolean;
  done: number;
  steps: { id: string; label: string; done: boolean; href: string | null }[];
}

/** Getting-started checklist on the dashboard until it is complete or dismissed. */
export function OnboardingChecklist() {
  const [data, setData] = useState<Onboarding | null>(null);
  useEffect(() => {
    api<Onboarding>('/onboarding').then(setData).catch(() => {});
  }, []);
  if (!data || data.dismissed || data.done === data.steps.length) return null;
  const pct = Math.round((data.done / data.steps.length) * 100);
  return (
    <Card className="mb-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Get started</h2>
          <p className="text-sm text-gray-500">
            {data.done} of {data.steps.length} done
          </p>
        </div>
        <button className="text-sm text-gray-400 hover:text-gray-700" onClick={() => api('/onboarding/dismiss', { method: 'POST' }).then(() => setData({ ...data, dismissed: true }))}>
          Hide
        </button>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Setup progress">
        <div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
      </div>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {data.steps.map((s) => (
          <li key={s.id} className="flex items-center gap-2 text-sm">
            <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold', s.done ? 'bg-green-100 text-green-700' : 'border border-gray-300 text-transparent')}>✓</span>
            {s.done || !s.href ? (
              <span className={s.done ? 'text-gray-400 line-through' : 'text-gray-700'}>{s.label}</span>
            ) : (
              <Link href={s.href} className="text-gray-700 hover:text-brand-700 hover:underline">{s.label}</Link>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
