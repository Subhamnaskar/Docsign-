'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { device, FAILURE_REASONS, LOGIN_METHODS, money, type OrgRow, PLAN_OPTIONS, PlanBadge, SimpleTable, Stat, StateBadge } from '@/components/admin/shared';
import { Alert, Button, Card, Input, Label, PageLoader, Select } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatDate, formatMoney, relativeTime } from '@/lib/format';

interface Detail extends Omit<OrgRow, 'users'> {
  dataRegion: string;
  periodStart: string;
  periodEnd: string | null;
  usage: {
    envelopes: number;
    envelopeLimit: number | null;
    seats: number;
    seatLimit: number | null;
  };
  envelopesAllTime: number;
  billingProvider: string | null;
  billingEmail: string | null;
  users: {
    id: string;
    name: string;
    email: string;
    role: string;
    createdAt: string;
    lastLoginAt: string | null;
    twoFactor: boolean;
    emailVerified: boolean;
    disabled: boolean;
    activeSessions: number;
  }[];
  invoices: {
    id: string;
    number: string;
    description: string;
    currency: string;
    total: number;
    paidAt: string;
  }[];
  logins: {
    id: string;
    email: string;
    method: string;
    success: boolean;
    reason: string | null;
    ip: string | null;
    createdAt: string;
  }[];
  actions: {
    id: string;
    type: string;
    actor: { name?: string; email?: string };
    data: Record<string, unknown>;
    createdAt: string;
  }[];
}

const ACTION_LABELS: Record<string, string> = {
  'platform.trial_extended': 'Trial extended',
  'platform.plan_changed': 'Plan changed',
};

export default function OrgDetailPage() {
  return (
    <AppShell wide>
      <OrgDetail />
    </AppShell>
  );
}

function OrgDetail() {
  const { id } = useParams<{ id: string }>();
  const [org, setOrg] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Detail>(`/admin/orgs/${id}`)
      .then(setOrg)
      .catch((e) =>
        setError(e instanceof ApiError && e.status === 404 ? 'Organisation not found, or you do not have access.' : 'Could not load this organisation.'),
      );
  }, [id]);
  useEffect(load, [load]);

  if (error) return <Alert>{error}</Alert>;
  if (!org) return <PageLoader />;
  const limit = (used: number, max: number | null) => (max === null ? `${used} (unlimited)` : `${used} / ${max}`);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin?tab=customers" className="text-sm text-gray-500 hover:text-ink">
          ← Customers
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{org.name}</h1>
          <PlanBadge plan={org.plan} name={org.planName} />
          <StateBadge state={org.state} />
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {org.owner ? `${org.owner.name} <${org.owner.email}>` : 'No owner'} · {org.jurisdiction} · data region {org.dataRegion} · signed up{' '}
          {formatDate(org.createdAt, false)} · ID <span className="font-mono">{org.id}</span>
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Users / seat limit" value={limit(org.usage.seats, org.usage.seatLimit)} caption={`${org.seats} seats on the plan`} />
        <Stat
          label="Agreements this period"
          value={limit(org.usage.envelopes, org.usage.envelopeLimit)}
          caption={`${org.envelopesAllTime.toLocaleString()} sent all time`}
        />
        <Stat
          label="MRR"
          tone="gold"
          value={org.mrr ? formatMoney(org.mrr.amount, org.mrr.currency) : org.managed ? 'Manual billing' : '—'}
          caption={org.managed ? 'Invoiced outside self-serve' : org.interval === 'year' ? 'Billed yearly' : 'Billed monthly'}
        />
        <Stat
          label="Total paid"
          value={money(org.revenue)}
          caption={
            org.state === 'trialing' && org.trialEndsAt
              ? `Trial ends ${formatDate(org.trialEndsAt, false)}`
              : org.periodEnd
                ? `Renews ${formatDate(org.periodEnd, false)}`
                : undefined
          }
        />
      </div>

      <SupportActions org={org} onDone={load} />

      <Card className="p-5">
        <h2 className="font-semibold">Users</h2>
        <div className="mt-4">
          <SimpleTable
            head={['User', 'Role', 'Last sign-in', 'Signed in on', '2FA', 'Joined']}
            align={['left', 'left', 'left', 'right', 'left', 'left']}
            rows={org.users.map((u) => [
              <div key="u">
                <div className="font-medium text-ink">
                  {u.name} {u.disabled && <span className="ml-1 text-xs font-normal text-red-700">deactivated</span>}
                </div>
                <div className="text-xs text-gray-500">
                  {u.email}
                  {!u.emailVerified && ' · email not confirmed'}
                </div>
              </div>,
              u.role.charAt(0) + u.role.slice(1).toLowerCase(),
              <span key="l" title={u.lastLoginAt ? formatDate(u.lastLoginAt) : undefined}>
                {u.lastLoginAt ? relativeTime(u.lastLoginAt) : 'never'}
              </span>,
              `${u.activeSessions} device${u.activeSessions === 1 ? '' : 's'}`,
              u.twoFactor ? 'On' : '—',
              formatDate(u.createdAt, false),
            ])}
          />
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-semibold">Recent sign-ins</h2>
          <div className="mt-4">
            <SimpleTable
              head={['When', 'User', 'Method', 'Result', 'IP']}
              rows={org.logins.map((l) => [
                <span key="w" className="whitespace-nowrap text-gray-600" title={formatDate(l.createdAt)}>
                  {relativeTime(l.createdAt)}
                </span>,
                <span key="e" className="text-xs">
                  {l.email}
                </span>,
                LOGIN_METHODS[l.method] ?? l.method,
                l.success ? (
                  <span key="r" className="text-emerald-700">
                    OK
                  </span>
                ) : (
                  <span key="r" className="text-red-700">
                    {FAILURE_REASONS[l.reason ?? 'unknown']}
                  </span>
                ),
                <span key="ip" className="font-mono text-xs">
                  {l.ip ?? '—'}
                </span>,
              ])}
            />
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold">Invoices</h2>
          <div className="mt-4">
            <SimpleTable
              head={['Invoice', 'Description', 'Paid', 'Total']}
              align={['left', 'left', 'left', 'right']}
              rows={org.invoices.map((i) => [
                <span key="n" className="font-mono text-xs">
                  {i.number}
                </span>,
                i.description,
                formatDate(i.paidAt, false),
                formatMoney(i.total, i.currency),
              ])}
            />
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="font-semibold">Console actions</h2>
        <p className="text-sm text-gray-500">Changes NuronixAI staff made to this account. The customer sees these in their own activity log.</p>
        <ul className="mt-4 divide-y divide-gray-100 text-sm">
          {org.actions.map((a) => (
            <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2.5">
              <span>
                <strong>{ACTION_LABELS[a.type] ?? a.type}</strong>{' '}
                <span className="text-gray-600">
                  {a.type === 'platform.trial_extended' && `by ${a.data.days} days`}
                  {a.type === 'platform.plan_changed' && `to ${String(a.data.plan)}, ${a.data.seats} seats`}
                </span>
              </span>
              <span className="text-gray-500">
                {a.actor.email ?? a.actor.name} · {formatDate(a.createdAt)}
              </span>
            </li>
          ))}
          {org.actions.length === 0 && <li className="py-4 text-center text-gray-500">No changes yet.</li>}
        </ul>
      </Card>
    </div>
  );
}

function SupportActions({ org, onDone }: { org: Detail; onDone: () => void }) {
  const [days, setDays] = useState(7);
  const [plan, setPlan] = useState(org.plan === 'trial' ? 'enterprise' : org.plan);
  const [seats, setSeats] = useState(org.seats);
  const [months, setMonths] = useState(12);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);

  async function run(path: string, json: unknown, confirmText: string, done: string) {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setMessage(null);
    try {
      await api(path, { method: 'POST', json });
      setMessage({ tone: 'success', text: done });
      onDone();
    } catch (e) {
      setMessage({
        tone: 'error',
        text: e instanceof ApiError ? e.message : 'That did not work.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="font-semibold">Support actions</h2>
      <p className="text-sm text-gray-500">Each change is recorded and shown in the customer&apos;s activity log.</p>
      {message && (
        <div className="mt-4">
          <Alert tone={message.tone}>{message.text}</Alert>
        </div>
      )}
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold">Extend free trial</h3>
          {org.plan === 'trial' ? (
            <div className="mt-3 flex items-end gap-3">
              <div className="w-24">
                <Label htmlFor="days">Days</Label>
                <Input id="days" type="number" min={1} max={90} value={days} onChange={(e) => setDays(Number(e.target.value))} />
              </div>
              <Button
                disabled={busy}
                onClick={() =>
                  run(`/admin/orgs/${org.id}/extend-trial`, { days }, `Extend ${org.name}'s trial by ${days} days?`, `Trial extended by ${days} days.`)
                }
              >
                Extend trial
              </Button>
            </div>
          ) : (
            <p className="mt-2 text-sm text-gray-500">Only available on the free trial.</p>
          )}
        </div>
        <div className="rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold">Set plan (billed manually)</h3>
          <p className="mt-1 text-xs text-gray-500">For Enterprise contracts and pilots. Self-serve card billing stops for this organisation.</p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Label htmlFor="plan">Plan</Label>
              <Select id="plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
                {PLAN_OPTIONS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-24">
              <Label htmlFor="seats">Seats</Label>
              <Input id="seats" type="number" min={1} value={seats} onChange={(e) => setSeats(Number(e.target.value))} />
            </div>
            <div className="w-24">
              <Label htmlFor="months">Months</Label>
              <Input id="months" type="number" min={1} max={60} value={months} onChange={(e) => setMonths(Number(e.target.value))} />
            </div>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                run(
                  `/admin/orgs/${org.id}/plan`,
                  { plan, seats, months },
                  `Put ${org.name} on ${PLAN_OPTIONS.find((p) => p.id === plan)?.name} with ${seats} seats for ${months} months?`,
                  'Plan updated.',
                )
              }
            >
              Apply
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
