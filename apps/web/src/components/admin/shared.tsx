'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { Card, cx } from '@/components/ui';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';

/** Shared pieces of the NuronixAI platform console (/admin). */

export type Money = { INR: number; USD: number };
export type BillingState = 'trialing' | 'trial_expired' | 'active' | 'past_due' | 'canceled';

export interface OrgRow {
  id: string;
  name: string;
  createdAt: string;
  jurisdiction: string;
  plan: string;
  planName: string;
  billingStatus: string;
  state: BillingState;
  interval: string;
  managed: boolean;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  seats: number;
  users: number;
  owner: { name: string; email: string } | null;
  lastLoginAt: string | null;
  lastActiveDay: string | null;
  envelopesThisMonth: number;
  mrr: { currency: 'INR' | 'USD'; amount: number } | null;
  revenue: Money;
  suspended: boolean;
}

export const PLAN_OPTIONS = [
  { id: 'trial', name: 'Free trial' },
  { id: 'starter', name: 'Starter' },
  { id: 'business', name: 'Business' },
  { id: 'enterprise', name: 'Enterprise' },
];

export const STATUS_OPTIONS = [
  { id: 'TRIALING', name: 'Trialing' },
  { id: 'ACTIVE', name: 'Active' },
  { id: 'PAST_DUE', name: 'Payment failed' },
  { id: 'CANCELED', name: 'Cancelled' },
];

const STATE: Record<BillingState, { label: string; className: string }> = {
  trialing: {
    label: 'Trial',
    className: 'bg-sky-50 text-sky-800 ring-sky-200',
  },
  trial_expired: {
    label: 'Trial ended',
    className: 'bg-gray-100 text-gray-700 ring-gray-200',
  },
  active: {
    label: 'Active',
    className: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  },
  past_due: {
    label: 'Payment failed',
    className: 'bg-red-50 text-red-800 ring-red-200',
  },
  canceled: {
    label: 'Cancelled',
    className: 'bg-gray-100 text-gray-600 ring-gray-200',
  },
};

export function StateBadge({ state }: { state: BillingState }) {
  const s = STATE[state] ?? STATE.trialing;
  return <span className={cx('inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', s.className)}>{s.label}</span>;
}

export function PlanBadge({ plan, name }: { plan: string; name: string }) {
  return (
    <span
      className={cx(
        'inline-flex rounded-md px-2 py-0.5 text-xs font-semibold',
        plan === 'trial' ? 'bg-gray-100 text-gray-700' : plan === 'enterprise' ? 'bg-ink text-white' : 'bg-brand-50 text-brand-700',
      )}
    >
      {name}
    </span>
  );
}

/** "₹1,23,000 · $500", skipping currencies with nothing in them. */
export function money(m: Money): string {
  const parts = (['INR', 'USD'] as const).filter((c) => m[c] > 0).map((c) => formatMoney(m[c], c));
  return parts.length ? parts.join(' · ') : '—';
}

export function Stat({ label, value, caption, tone }: { label: string; value: ReactNode; caption?: ReactNode; tone?: 'gold' }) {
  return (
    <Card className="p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className={cx('mt-1 text-2xl font-bold tabular-nums tracking-tight sm:text-3xl', tone === 'gold' ? 'text-brand-600' : 'text-ink')}>{value}</div>
      {caption && <div className="mt-1 text-xs text-gray-500">{caption}</div>}
    </Card>
  );
}

export function SimpleTable({ head, rows, align }: { head: string[]; rows: ReactNode[][]; align?: ('left' | 'right')[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-gray-400">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={cx('whitespace-nowrap px-3 py-2 font-medium first:pl-0', align?.[i] === 'right' && 'text-right')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r, ri) => (
            <tr key={ri} className="align-top">
              {r.map((c, ci) => (
                <td key={ci} className={cx('px-3 py-2.5 first:pl-0', align?.[ci] === 'right' && 'text-right tabular-nums')}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="py-6 text-center text-sm text-gray-500">Nothing here yet.</p>}
    </div>
  );
}

/** Short device description from a user-agent string. */
export function device(ua: string | null): string {
  if (!ua) return '—';
  if (ua === 'Office add-in') return ua;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} · ${os}` : browser;
}

export const LOGIN_METHODS: Record<string, string> = {
  password: 'Password',
  mfa: 'Password + 2FA',
  sso: 'Single sign-on',
  invite: 'Accepted invite',
  register: 'Sign-up',
  office: 'Office add-in',
};

export const FAILURE_REASONS: Record<string, string> = {
  bad_password: 'Wrong password',
  unknown_user: 'No such account',
  deactivated: 'Deactivated user',
  sso_required: 'SSO required',
  bad_code: 'Wrong 2FA code',
  unknown: 'Other',
};

export type PlatformRole = 'owner' | 'admin' | 'viewer';

/** The signed-in staff member's console role (null while loading or without access). */
export function usePlatformRole(): PlatformRole | null {
  const [role, setRole] = useState<PlatformRole | null>(null);
  useEffect(() => {
    api<{ role: PlatformRole }>('/admin/me')
      .then((r) => setRole(r.role))
      .catch(() => setRole(null));
  }, []);
  return role;
}
