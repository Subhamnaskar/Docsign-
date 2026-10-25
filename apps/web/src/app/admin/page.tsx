'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ChartCard, HBars, Legend, LineChart, ORDINAL_BLUE, SERIES } from '@/components/charts';
import {
  device,
  FAILURE_REASONS,
  LOGIN_METHODS,
  money,
  type Money,
  type OrgRow,
  PLAN_OPTIONS,
  PlanBadge,
  SimpleTable,
  Stat,
  STATUS_OPTIONS,
  StateBadge,
  type PlatformRole,
} from '@/components/admin/shared';
import { Alert, Button, Card, cx, Input, Label, PageLoader, Select } from '@/components/ui';
import { api, ApiError, fileUrl } from '@/lib/api';
import { formatDate, formatMoney, relativeTime } from '@/lib/format';

/** NuronixAI platform console: every customer, plan, sign-in and revenue figure. */

interface Point {
  day: string;
  value: number;
}
interface Overview {
  days: number;
  totals: { organizations: number; users: number; payingOrganizations: number };
  signups: { today: number; last7: number; period: number };
  logins: { today: number; failedToday: number };
  activeUsers: { day: number; week: number; month: number };
  envelopes: { sent: number; completed: number };
  mrr: Money;
  arr: Money;
  revenue: Money;
  plans: {
    plan: string;
    name: string;
    total: number;
    status: Record<string, number>;
  }[];
  canceled: number;
  cancelingAtPeriodEnd: number;
  trialsEnding: {
    id: string;
    name: string;
    trialEndsAt: string;
    ownerEmail: string | null;
  }[];
  series: {
    signups: Point[];
    logins: Point[];
    activeUsers: Point[];
    envelopesSent: Point[];
  };
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'customers', label: 'Customers' },
  { id: 'logins', label: 'Sign-ins' },
  { id: 'team', label: 'Team' },
] as const;
type Tab = (typeof TABS)[number]['id'];

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
const n = (v: number) => v.toLocaleString();

export default function AdminPage() {
  return (
    <AppShell wide>
      <Console />
    </AppShell>
  );
}

function Console() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('tab');
    if (TABS.some((t) => t.id === wanted)) setTab(wanted as Tab);
    api('/admin/me')
      .then(() => setAllowed(true))
      .catch(() => setAllowed(false));
  }, []);
  const choose = (t: Tab) => {
    setTab(t);
    window.history.replaceState(null, '', t === 'overview' ? '/admin' : `/admin?tab=${t}`);
  };

  if (allowed === null) return <PageLoader />;
  if (!allowed) return <Alert title="Page not found">This page doesn&apos;t exist or you don&apos;t have access to it.</Alert>;
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">NuronixAI · internal</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Platform console</h1>
        </div>
        <div className="flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => choose(t.id)}
              className={cx('rounded-md px-4 py-1.5 font-medium', tab === t.id ? 'bg-ink text-white' : 'text-gray-600 hover:text-ink')}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-6">
        {tab === 'overview' && <OverviewTab />}
        {tab === 'customers' && <CustomersTab />}
        {tab === 'logins' && <LoginsTab />}
        {tab === 'team' && <TeamTab />}
      </div>
    </>
  );
}

// --- Overview ----------------------------------------------------------------

function OverviewTab() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    api<Overview>(`/admin/overview?days=${days}`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load the overview.'));
  }, [days]);

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <PageLoader />;
  const activity = data.series.activeUsers.map((p, i) => ({
    x: p.day,
    values: [p.value, data.series.logins[i].value],
  }));
  const growth = data.series.signups.map((p, i) => ({
    x: p.day,
    values: [p.value, data.series.envelopesSent[i].value],
  }));
  const paidPlans = data.plans.filter((p) => p.plan !== 'trial');

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <div className="w-44">
          <Select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
            {[7, 30, 90, 365].map((d) => (
              <option key={d} value={d}>
                Last {d} days
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Customers"
          value={n(data.totals.organizations)}
          caption={`${n(data.totals.payingOrganizations)} paying · ${n(data.signups.today)} new today`}
        />
        <Stat label="Users" value={n(data.totals.users)} caption={`${n(data.signups.last7)} new organisations this week`} />
        <Stat
          label="Active users"
          value={n(data.activeUsers.day)}
          caption={`today · ${n(data.activeUsers.week)} this week · ${n(data.activeUsers.month)} this month`}
        />
        <Stat
          label="Sign-ins today"
          value={n(data.logins.today)}
          caption={
            <span className={data.logins.failedToday > 0 ? 'text-red-700' : undefined}>
              {n(data.logins.failedToday)} failed attempt
              {data.logins.failedToday === 1 ? '' : 's'}
            </span>
          }
        />
        <Stat label="MRR" tone="gold" value={money(data.mrr)} caption="Self-serve subscriptions, before GST" />
        <Stat label="ARR" tone="gold" value={money(data.arr)} caption="MRR × 12" />
        <Stat label={`Revenue, last ${data.days} days`} value={money(data.revenue)} caption="Paid invoices, before GST" />
        <Stat label={`Agreements, last ${data.days} days`} value={n(data.envelopes.sent)} caption={`sent · ${n(data.envelopes.completed)} completed`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Activity"
          subtitle="Users active each day, and sign-ins"
          legend={
            <Legend
              items={[
                { label: 'Active users', color: SERIES[0] },
                { label: 'Sign-ins', color: SERIES[1] },
              ]}
            />
          }
          chart={
            <LineChart
              period="day"
              data={activity}
              series={[
                { label: 'Active users', color: SERIES[0] },
                { label: 'Sign-ins', color: SERIES[1] },
              ]}
              formatX={shortDate}
            />
          }
          table={
            <SimpleTable
              head={['Day', 'Active users', 'Sign-ins']}
              align={['left', 'right', 'right']}
              rows={[...activity].reverse().map((r) => [shortDate(r.x), r.values[0], r.values[1]])}
            />
          }
        />
        <ChartCard
          title="Growth"
          subtitle="New organisations and agreements sent each day"
          legend={
            <Legend
              items={[
                { label: 'Sign-ups', color: SERIES[0] },
                { label: 'Agreements sent', color: SERIES[1] },
              ]}
            />
          }
          chart={
            <LineChart
              period="day"
              data={growth}
              series={[
                { label: 'Sign-ups', color: SERIES[0] },
                { label: 'Agreements sent', color: SERIES[1] },
              ]}
              formatX={shortDate}
            />
          }
          table={
            <SimpleTable
              head={['Day', 'Sign-ups', 'Agreements sent']}
              align={['left', 'right', 'right']}
              rows={[...growth].reverse().map((r) => [shortDate(r.x), r.values[0], r.values[1]])}
            />
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-5">
          <h2 className="font-semibold">Subscriptions by plan</h2>
          <p className="text-sm text-gray-500">
            {n(data.canceled)} cancelled · {n(data.cancelingAtPeriodEnd)} cancelling at period end
          </p>
          <div className="mt-4">
            <SimpleTable
              head={['Plan', 'Customers', 'Trialing', 'Active', 'Payment failed', 'Cancelled']}
              align={['left', 'right', 'right', 'right', 'right', 'right']}
              rows={data.plans.map((p) => [
                <PlanBadge key={p.plan} plan={p.plan} name={p.name} />,
                <strong key="t">{n(p.total)}</strong>,
                n(p.status.TRIALING),
                n(p.status.ACTIVE),
                <span key="pd" className={p.status.PAST_DUE ? 'font-semibold text-red-700' : undefined}>
                  {n(p.status.PAST_DUE)}
                </span>,
                n(p.status.CANCELED),
              ])}
            />
          </div>
          <div className="mt-6">
            <h3 className="text-sm font-medium text-gray-700">Paying customers per plan</h3>
            <div className="mt-3">
              <HBars
                rows={paidPlans.map((p) => ({
                  label: p.name,
                  value: p.status.ACTIVE + p.status.PAST_DUE,
                }))}
                colors={ORDINAL_BLUE.slice(1)}
              />
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold">Trials ending in 7 days</h2>
          <p className="text-sm text-gray-500">Good moment for a sales follow-up.</p>
          <ul className="mt-4 divide-y divide-gray-100">
            {data.trialsEnding.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <Link href={`/admin/orgs/${t.id}`} className="font-medium text-ink hover:underline">
                    {t.name}
                  </Link>
                  <div className="truncate text-xs text-gray-500">{t.ownerEmail}</div>
                </div>
                <span className="shrink-0 text-xs font-medium text-amber-800">{formatDate(t.trialEndsAt, false)}</span>
              </li>
            ))}
            {data.trialsEnding.length === 0 && <li className="py-6 text-center text-sm text-gray-500">No trials end this week.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}

// --- Customers ---------------------------------------------------------------

function CustomersTab() {
  const [q, setQ] = useState('');
  const [plan, setPlan] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{
    total: number;
    page: number;
    pageSize: number;
    organizations: OrgRow[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const params = new URLSearchParams({
    ...(q && { q }),
    ...(plan && { plan }),
    ...(status && { status }),
  });
  const query = params.toString();
  useEffect(() => {
    const t = setTimeout(() => {
      api<typeof data>(`/admin/orgs?${query}&page=${page}`)
        .then(setData)
        .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load customers.'));
    }, 250);
    return () => clearTimeout(t);
  }, [query, page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-80">
          <Input
            placeholder="Search organisation, owner or user email"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="w-40">
          <Select value={plan} onChange={(e) => (setPlan(e.target.value), setPage(1))} aria-label="Plan">
            <option value="">All plans</option>
            {PLAN_OPTIONS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-44">
          <Select value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} aria-label="Status">
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <a
          href={fileUrl(`/admin/orgs.csv?${query}`)}
          className="ml-auto rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50"
        >
          Export CSV
        </a>
      </div>
      {error && (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      )}
      <div className="mt-5">
        {!data ? (
          <PageLoader />
        ) : (
          <SimpleTable
            head={['Organisation', 'Plan', 'Status', 'Users / seats', 'Agreements this month', 'MRR', 'Last sign-in', 'Signed up']}
            align={['left', 'left', 'left', 'right', 'right', 'right', 'left', 'left']}
            rows={data.organizations.map((o) => [
              <div key="o" className="min-w-0">
                <Link href={`/admin/orgs/${o.id}`} className="font-medium text-ink hover:underline">
                  {o.name}
                </Link>
                <div className="text-xs text-gray-500">
                  {o.owner?.email ?? '—'} · {o.jurisdiction}
                </div>
              </div>,
              <PlanBadge key="p" plan={o.plan} name={o.planName} />,
              <div key="s">
                <StateBadge state={o.state} />
                {o.suspended && <span className="ml-1 rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">Suspended</span>}
                {o.trialEndsAt && o.state === 'trialing' && <div className="mt-0.5 text-xs text-gray-500">ends {formatDate(o.trialEndsAt, false)}</div>}
                {o.cancelAtPeriodEnd && <div className="mt-0.5 text-xs text-amber-700">cancelling</div>}
              </div>,
              `${o.users} / ${o.seats}`,
              n(o.envelopesThisMonth),
              o.mrr ? formatMoney(o.mrr.amount, o.mrr.currency) : o.managed ? 'manual' : '—',
              <span key="l" className="whitespace-nowrap text-gray-600">
                {o.lastLoginAt ? relativeTime(o.lastLoginAt) : 'never'}
              </span>,
              <span key="c" className="whitespace-nowrap text-gray-600">
                {formatDate(o.createdAt, false)}
              </span>,
            ])}
          />
        )}
      </div>
      {data && (
        <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
          <span>
            {n(data.total)} organisation{data.total === 1 ? '' : 's'}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <span>
              Page {page} of {pages}
            </span>
            <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// --- Sign-ins ----------------------------------------------------------------

interface Logins {
  total: number;
  page: number;
  pageSize: number;
  events: {
    id: string;
    email: string;
    name: string | null;
    organization: { id: string; name: string } | null;
    method: string;
    success: boolean;
    reason: string | null;
    ip: string | null;
    userAgent: string | null;
    createdAt: string;
  }[];
  summary: {
    byMethod: { method: string; count: number }[];
    failuresByReason: { reason: string; count: number }[];
    failingIps: { ip: string; count: number }[];
  };
}

function LoginsTab() {
  const [result, setResult] = useState<'all' | 'success' | 'failed'>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Logins | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      api<Logins>(`/admin/logins?result=${result}&page=${page}${q ? `&q=${encodeURIComponent(q)}` : ''}`).then(setData);
    }, 250);
    return () => clearTimeout(t);
  }, [result, q, page]);

  if (!data) return <PageLoader />;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5">
          <h2 className="font-semibold">How people sign in</h2>
          <p className="text-sm text-gray-500">Successful sign-ins, last 30 days</p>
          <div className="mt-4">
            <HBars
              rows={data.summary.byMethod.map((m) => ({
                label: LOGIN_METHODS[m.method] ?? m.method,
                value: m.count,
              }))}
              colors={[SERIES[0]]}
            />
            {data.summary.byMethod.length === 0 && <p className="text-sm text-gray-500">No sign-ins yet.</p>}
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold">Failed attempts</h2>
          <p className="text-sm text-gray-500">By reason, last 30 days</p>
          <div className="mt-4">
            <HBars
              rows={data.summary.failuresByReason.map((m) => ({
                label: FAILURE_REASONS[m.reason] ?? m.reason,
                value: m.count,
              }))}
              colors={[SERIES[1]]}
            />
            {data.summary.failuresByReason.length === 0 && <p className="text-sm text-gray-500">No failed attempts.</p>}
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold">Most failed attempts by IP</h2>
          <p className="text-sm text-gray-500">Last 24 hours. Many failures from one address can mean password guessing.</p>
          <ul className="mt-4 divide-y divide-gray-100 text-sm">
            {data.summary.failingIps.map((r) => (
              <li key={r.ip} className="flex justify-between py-2">
                <button className="font-mono text-gray-800 hover:underline" onClick={() => (setQ(r.ip), setResult('failed'), setPage(1))}>
                  {r.ip}
                </button>
                <span className={cx('font-semibold tabular-nums', r.count >= 10 ? 'text-red-700' : 'text-gray-900')}>{r.count}</span>
              </li>
            ))}
            {data.summary.failingIps.length === 0 && <li className="py-4 text-center text-gray-500">None.</li>}
          </ul>
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-full sm:w-72">
            <Input placeholder="Search email or IP" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} />
          </div>
          <div className="flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
            {(['all', 'success', 'failed'] as const).map((r) => (
              <button
                key={r}
                onClick={() => (setResult(r), setPage(1))}
                className={cx('rounded-md px-3 py-1 font-medium capitalize', result === r ? 'bg-ink text-white' : 'text-gray-600')}
              >
                {r === 'success' ? 'Successful' : r}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-5">
          <SimpleTable
            head={['When', 'User', 'Organisation', 'Method', 'Result', 'IP', 'Device']}
            rows={data.events.map((e) => [
              <span key="w" className="whitespace-nowrap text-gray-600" title={formatDate(e.createdAt)}>
                {relativeTime(e.createdAt)}
              </span>,
              <div key="u">
                <div className="font-medium text-ink">{e.name ?? '—'}</div>
                <div className="text-xs text-gray-500">{e.email}</div>
              </div>,
              e.organization ? (
                <Link key="o" href={`/admin/orgs/${e.organization.id}`} className="hover:underline">
                  {e.organization.name}
                </Link>
              ) : (
                '—'
              ),
              LOGIN_METHODS[e.method] ?? e.method,
              e.success ? (
                <span key="r" className="font-medium text-emerald-700">
                  Signed in
                </span>
              ) : (
                <span key="r" className="font-medium text-red-700">
                  {FAILURE_REASONS[e.reason ?? 'unknown'] ?? e.reason}
                </span>
              ),
              <span key="ip" className="font-mono text-xs">
                {e.ip ?? '—'}
              </span>,
              <span key="d" className="whitespace-nowrap text-gray-600">
                {device(e.userAgent)}
              </span>,
            ])}
          />
        </div>
        <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
          <span>{n(data.total)} attempts</span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <span>
              Page {page} of {pages}
            </span>
            <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

// --- Team --------------------------------------------------------------------

interface Team {
  you: { email: string; role: PlatformRole };
  twoFactorRequired: boolean;
  members: {
    email: string;
    role: PlatformRole;
    alerts: boolean;
    addedBy: string;
    createdAt: string | null;
    account: { name: string; emailVerified: boolean; twoFactor: boolean; lastLoginAt: string | null } | null;
  }[];
}

const ROLE_INFO: Record<PlatformRole, string> = {
  owner: 'Everything, including managing the team. Set in PLATFORM_ADMINS.',
  admin: 'Everything except managing the team.',
  viewer: 'Can look at everything, cannot change anything.',
};

function TeamTab() {
  const [team, setTeam] = useState<Team | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'viewer'>('viewer');
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const load = () => api<Team>('/admin/team').then(setTeam);
  useEffect(() => {
    load();
  }, []);

  async function call(path: string, init: Parameters<typeof api>[1], done: string) {
    setNotice(null);
    try {
      await api(path, init);
      setNotice({ tone: 'success', text: done });
      await load();
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof ApiError ? e.message : 'That did not work.' });
    }
  }

  if (!team) return <PageLoader />;
  const owner = team.you.role === 'owner';
  const path = (e: string) => `/admin/team/${encodeURIComponent(e)}`;
  return (
    <div className="space-y-6">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <Card className="p-5">
        <h2 className="font-semibold">Console team</h2>
        <p className="text-sm text-gray-500">
          Everyone here needs their own account with a confirmed email{team.twoFactorRequired ? ' and two-factor authentication' : ''}. Alerts email them about failed payments, cancellations, new paying
          customers and bursts of failed sign-ins.
        </p>
        <div className="mt-4">
          <SimpleTable
            head={['Person', 'Role', 'Account', 'Alerts', '']}
            rows={team.members.map((m) => {
              const self = m.email === team.you.email;
              return [
                <div key="p">
                  <div className="font-medium text-ink">
                    {m.account?.name ?? m.email} {self && <span className="text-xs font-normal text-gray-500">(you)</span>}
                  </div>
                  <div className="text-xs text-gray-500">{m.email}</div>
                </div>,
                owner && m.role !== 'owner' ? (
                  <div key="r" className="w-28">
                    <Select value={m.role} aria-label={`Role for ${m.email}`} onChange={(e) => call(path(m.email), { method: 'PATCH', json: { role: e.target.value } }, `${m.email} is now ${e.target.value}.`)}>
                      <option value="admin">Admin</option>
                      <option value="viewer">Viewer</option>
                    </Select>
                  </div>
                ) : (
                  <span key="r" title={ROLE_INFO[m.role]} className="capitalize">
                    {m.role}
                  </span>
                ),
                m.account ? (
                  <span key="a" className="text-xs text-gray-600">
                    {m.account.emailVerified ? 'Email confirmed' : 'Email not confirmed'} · 2FA {m.account.twoFactor ? 'on' : 'off'}
                    <br />
                    {m.account.lastLoginAt ? `Signed in ${relativeTime(m.account.lastLoginAt)}` : 'Never signed in'}
                  </span>
                ) : (
                  <span key="a" className="text-xs text-amber-700">
                    No account yet: ask them to sign up with this email
                  </span>
                ),
                m.role === 'owner' ? (
                  'Always'
                ) : (
                  <label key="al" className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={m.alerts}
                      disabled={!owner && !self}
                      onChange={(e) => call(path(m.email), { method: 'PATCH', json: { alerts: e.target.checked } }, `Alerts ${e.target.checked ? 'on' : 'off'} for ${m.email}.`)}
                    />
                    Email
                  </label>
                ),
                owner && m.role !== 'owner' ? (
                  <Button
                    key="x"
                    size="sm"
                    variant="ghost"
                    className="text-red-700"
                    onClick={() => window.confirm(`Remove ${m.email} from the console team?`) && call(path(m.email), { method: 'DELETE' }, `${m.email} was removed.`)}
                  >
                    Remove
                  </Button>
                ) : (
                  ''
                ),
              ];
            })}
          />
        </div>
      </Card>
      {owner && (
        <Card className="p-5">
          <h2 className="font-semibold">Add someone</h2>
          <form
            className="mt-3 flex flex-wrap items-end gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              await call('/admin/team', { method: 'POST', json: { email, role } }, `${email} was added as ${role}.`);
              setEmail('');
            }}
          >
            <div className="w-full sm:w-72">
              <Label htmlFor="team-email">Work email</Label>
              <Input id="team-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@nuronixai.in" />
            </div>
            <div className="w-32">
              <Label htmlFor="team-role">Role</Label>
              <Select id="team-role" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'viewer')}>
                <option value="viewer">Viewer</option>
                <option value="admin">Admin</option>
              </Select>
            </div>
            <Button type="submit">Add to team</Button>
          </form>
          <p className="mt-3 text-xs text-gray-500">
            Admin: {ROLE_INFO.admin} Viewer: {ROLE_INFO.viewer}
          </p>
        </Card>
      )}
    </div>
  );
}
