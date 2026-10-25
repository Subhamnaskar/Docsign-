'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import { FAILURE_REASONS, LOGIN_METHODS, money, type OrgRow, PLAN_OPTIONS, PlanBadge, SimpleTable, Stat, StateBadge, usePlatformRole } from '@/components/admin/shared';
import { Alert, Button, Card, Input, Label, Modal, PageLoader, Select, Textarea } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatDate, formatMoney, relativeTime } from '@/lib/format';

interface Detail extends Omit<OrgRow, 'users'> {
  dataRegion: string;
  periodStart: string;
  periodEnd: string | null;
  usage: { envelopes: number; envelopeLimit: number | null; seats: number; seatLimit: number | null };
  envelopesAllTime: number;
  billingProvider: string | null;
  billingEmail: string | null;
  liveSubscription: boolean;
  suspendedAt: string | null;
  suspendedReason: string | null;
  supportAccessUntil: string | null;
  customLimits: { envelopeLimit?: number | null; seatLimit?: number | null; features?: string[]; note?: string } | null;
  planLimits: { envelopesPerSeat: number | null; maxSeats: number | null; features: string[] };
  features: string[];
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
  invoices: { id: string; number: string; description: string; currency: string; total: number; paidAt: string; provider: string; refunded: number }[];
  creditNotes: { id: string; number: string; kind: 'refund' | 'credit'; amount: number; currency: string; reason: string; provider: string | null; createdBy: string; createdAt: string }[];
  logins: { id: string; email: string; method: string; success: boolean; reason: string | null; ip: string | null; createdAt: string }[];
  actions: { id: string; type: string; actor: { name?: string; email?: string }; data: Record<string, unknown>; createdAt: string }[];
}

const ACTION_LABELS: Record<string, string> = {
  'platform.trial_extended': 'Trial extended',
  'platform.plan_changed': 'Plan changed',
  'platform.user_signed_out': 'User signed out',
  'platform.user_deactivated': 'User deactivated',
  'platform.user_reactivated': 'User reactivated',
  'platform.password_reset_sent': 'Password reset sent',
  'platform.org_suspended': 'Organisation suspended',
  'platform.org_reactivated': 'Organisation reactivated',
  'platform.org_signed_out': 'Everyone signed out',
  'platform.subscription_canceled': 'Subscription cancelled',
  'platform.refund_issued': 'Refund issued',
  'platform.credit_issued': 'Credit issued',
  'platform.support_session_started': 'Support session started',
  'platform.support_session_ended': 'Support session ended',
  'platform.limits_changed': 'Custom limits set',
  'platform.limits_cleared': 'Custom limits removed',
};

const FEATURE_LABELS: Record<string, string> = { api: 'API, webhooks and integrations', bulkSend: 'Bulk send', sso: 'Single sign-on and SCIM' };

function actionDetail(a: Detail['actions'][number]): string {
  const d = a.data;
  const amount = typeof d.amount === 'number' && typeof d.currency === 'string' ? formatMoney(d.amount, d.currency) : '';
  switch (a.type) {
    case 'platform.trial_extended':
      return `by ${d.days} days`;
    case 'platform.plan_changed':
      return `to ${String(d.plan)}, ${d.seats} seats`;
    case 'platform.org_suspended':
    case 'platform.subscription_canceled':
      return String(d.reason ?? '');
    case 'platform.refund_issued':
    case 'platform.credit_issued':
      return `${amount} · ${String(d.creditNote)}`;
    case 'platform.support_session_started':
      return `as ${String(d.viewingAs)}`;
    case 'platform.limits_changed':
      return [
        'envelopeLimit' in d && `agreements ${d.envelopeLimit ?? 'unlimited'}`,
        'seatLimit' in d && `users ${d.seatLimit ?? 'unlimited'}`,
        Array.isArray(d.features) && d.features.length > 0 && `+ ${d.features.map((f) => FEATURE_LABELS[String(f)] ?? f).join(', ')}`,
      ]
        .filter(Boolean)
        .join(' · ');
    default:
      return typeof d.email === 'string' ? d.email : '';
  }
}

export default function OrgDetailPage() {
  return (
    <AppShell wide>
      <OrgDetail />
    </AppShell>
  );
}

type Dialog = { kind: 'suspend' } | { kind: 'cancel' } | { kind: 'credit' } | { kind: 'refund'; invoice: Detail['invoices'][number] } | null;
type Act = (path: string, json: unknown, done: string, confirmText?: string) => Promise<boolean>;

function OrgDetail() {
  const { id } = useParams<{ id: string }>();
  const role = usePlatformRole();
  const canChange = role === 'owner' || role === 'admin';
  const [org, setOrg] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const load = useCallback(() => {
    api<Detail>(`/admin/orgs/${id}`)
      .then(setOrg)
      .catch((e) => setError(e instanceof ApiError && e.status === 404 ? 'Organisation not found, or you do not have access.' : 'Could not load this organisation.'));
  }, [id]);
  useEffect(load, [load]);

  /** Runs a console action (after confirmation, if asked) and reloads. */
  const act: Act = useCallback(
    async (path, json, done, confirmText) => {
      if (confirmText && !window.confirm(confirmText)) return false;
      setNotice(null);
      try {
        await api(path, { method: 'POST', json });
        setNotice({ tone: 'success', text: done });
        load();
        return true;
      } catch (e) {
        setNotice({ tone: 'error', text: e instanceof ApiError ? e.message : 'That did not work.' });
        return false;
      }
    },
    [load],
  );

  async function viewAsCustomer(userId?: string) {
    setNotice(null);
    try {
      const { redirect } = await api<{ redirect: string }>(`/admin/orgs/${id}/support-session`, { method: 'POST', json: userId ? { userId } : {} });
      window.location.href = redirect;
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof ApiError ? e.message : 'Could not start the support session.' });
    }
  }

  if (error) return <Alert>{error}</Alert>;
  if (!org) return <PageLoader />;
  const limit = (used: number, max: number | null) => (max === null ? `${used} (unlimited)` : `${used} / ${max}`);
  const cancellable = org.liveSubscription || (org.managed && org.plan !== 'trial' && org.billingStatus !== 'CANCELED');
  const creditCurrency = org.mrr?.currency ?? (org.jurisdiction === 'IN' ? 'INR' : 'USD');

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
          {org.suspendedAt && <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">Suspended</span>}
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {org.owner ? `${org.owner.name} <${org.owner.email}>` : 'No owner'} · {org.jurisdiction} · data region {org.dataRegion} · signed up {formatDate(org.createdAt, false)} · ID{' '}
          <span className="font-mono">{org.id}</span>
        </p>
      </div>

      {org.suspendedAt && (
        <Alert title={`Suspended ${formatDate(org.suspendedAt)}`}>
          {org.suspendedReason} · Nobody in this organisation can sign in, use the API or open signing links.
        </Alert>
      )}
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {role === 'viewer' && <Alert tone="info">You have view-only access to the console.</Alert>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Users / seat limit" value={limit(org.usage.seats, org.usage.seatLimit)} caption={`${org.seats} seats on the plan`} />
        <Stat label="Agreements this period" value={limit(org.usage.envelopes, org.usage.envelopeLimit)} caption={`${org.envelopesAllTime.toLocaleString()} sent all time`} />
        <Stat
          label="MRR"
          tone="gold"
          value={org.mrr ? formatMoney(org.mrr.amount, org.mrr.currency) : org.managed ? 'Manual billing' : '—'}
          caption={org.cancelAtPeriodEnd ? 'Cancels at period end' : org.managed ? 'Invoiced outside self-serve' : org.interval === 'year' ? 'Billed yearly' : 'Billed monthly'}
        />
        <Stat
          label="Total paid"
          value={money(org.revenue)}
          caption={org.state === 'trialing' && org.trialEndsAt ? `Trial ends ${formatDate(org.trialEndsAt, false)}` : org.periodEnd ? `Period ends ${formatDate(org.periodEnd, false)}` : undefined}
        />
      </div>

      {canChange && (
        <div className="grid gap-6 xl:grid-cols-3">
          <ActionCard title="Account">
            <Row label="Support access" hint={org.supportAccessUntil ? `Granted until ${formatDate(org.supportAccessUntil)}` : 'Not granted. The customer turns it on under Settings → Security.'}>
              <Button size="sm" disabled={!org.supportAccessUntil || Boolean(org.suspendedAt)} onClick={() => viewAsCustomer()}>
                View as customer
              </Button>
            </Row>
            <Row label="Sessions" hint="Signs every user out on every device.">
              <Button size="sm" variant="secondary" onClick={() => act(`/admin/orgs/${org.id}/sign-out-all`, {}, 'Everyone was signed out.', `Sign out everyone in ${org.name}?`)}>
                Sign out everyone
              </Button>
            </Row>
            <Row label="Suspension" hint={org.suspendedAt ? 'Restores sign-in, the API and signing links.' : 'For abuse, fraud or security incidents.'}>
              {org.suspendedAt ? (
                <Button size="sm" variant="secondary" onClick={() => act(`/admin/orgs/${org.id}/reactivate`, {}, 'Organisation reactivated.', `Reactivate ${org.name}?`)}>
                  Reactivate
                </Button>
              ) : (
                <Button size="sm" variant="danger" onClick={() => setDialog({ kind: 'suspend' })}>
                  Suspend
                </Button>
              )}
            </Row>
          </ActionCard>
          <ActionCard title="Plan and trial">
            <TrialAndPlan org={org} act={act} />
          </ActionCard>
          <ActionCard title="Billing">
            <Row
              label="Subscription"
              hint={cancellable ? (org.cancelAtPeriodEnd ? 'Already set to cancel at period end.' : 'Stops renewal now or at the end of the period.') : 'No active subscription.'}
            >
              <Button size="sm" variant="secondary" disabled={!cancellable} onClick={() => setDialog({ kind: 'cancel' })}>
                Cancel
              </Button>
            </Row>
            <Row label="Account credit" hint="Goodwill or service credit, recorded as a credit note.">
              <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'credit' })}>
                Issue credit
              </Button>
            </Row>
            <p className="text-xs text-gray-500">Refunds: use the Refund button next to an invoice below.</p>
          </ActionCard>
          <div className="xl:col-span-3">
            <CustomLimitsCard key={JSON.stringify(org.customLimits)} org={org} onDone={(text, tone) => (setNotice({ tone, text }), tone === 'success' && load())} />
          </div>
        </div>
      )}

      <Card className="p-5">
        <h2 className="font-semibold">Users</h2>
        <div className="mt-4">
          <SimpleTable
            head={['User', 'Role', 'Last sign-in', 'Signed in on', '2FA', 'Joined', '']}
            align={['left', 'left', 'left', 'right', 'left', 'left', 'right']}
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
              canChange ? <UserActions key="a" org={org} user={u} act={act} onViewAs={viewAsCustomer} /> : '',
            ])}
          />
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-semibold">Invoices</h2>
          <div className="mt-4">
            <SimpleTable
              head={['Invoice', 'Paid', 'Total', 'Refunded', '']}
              align={['left', 'left', 'right', 'right', 'right']}
              rows={org.invoices.map((i) => [
                <div key="n">
                  <div className="font-mono text-xs">{i.number}</div>
                  <div className="text-xs text-gray-500">{i.description}</div>
                </div>,
                formatDate(i.paidAt, false),
                formatMoney(i.total, i.currency),
                i.refunded ? formatMoney(i.refunded, i.currency) : '—',
                canChange && i.refunded < i.total ? (
                  <Button key="r" size="sm" variant="ghost" onClick={() => setDialog({ kind: 'refund', invoice: i })}>
                    Refund
                  </Button>
                ) : (
                  ''
                ),
              ])}
            />
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold">Refunds and credits</h2>
          <div className="mt-4">
            <SimpleTable
              head={['Credit note', 'Type', 'Amount', 'By']}
              align={['left', 'left', 'right', 'left']}
              rows={org.creditNotes.map((c) => [
                <div key="n">
                  <div className="font-mono text-xs">{c.number}</div>
                  <div className="text-xs text-gray-500">{c.reason}</div>
                </div>,
                c.kind === 'refund' ? (c.provider ? `Refund via ${c.provider}` : 'Refund (manual transfer)') : 'Credit',
                formatMoney(c.amount, c.currency),
                <span key="b" className="text-xs text-gray-500">
                  {c.createdBy}
                  <br />
                  {formatDate(c.createdAt, false)}
                </span>,
              ])}
            />
          </div>
        </Card>
      </div>

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
                    {FAILURE_REASONS[l.reason ?? 'unknown'] ?? l.reason}
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
          <h2 className="font-semibold">Console actions</h2>
          <p className="text-sm text-gray-500">Changes NuronixAI staff made to this account. The customer sees these in their own activity log.</p>
          <ul className="mt-4 divide-y divide-gray-100 text-sm">
            {org.actions.map((a) => (
              <li key={a.id} className="py-2.5">
                <div>
                  <strong>{ACTION_LABELS[a.type] ?? a.type}</strong> <span className="text-gray-600">{actionDetail(a)}</span>
                </div>
                <div className="text-xs text-gray-500">
                  {a.actor.email ?? a.actor.name} · {formatDate(a.createdAt)}
                </div>
              </li>
            ))}
            {org.actions.length === 0 && <li className="py-4 text-center text-gray-500">No changes yet.</li>}
          </ul>
        </Card>
      </div>

      <ReasonDialog
        open={dialog?.kind === 'suspend'}
        title={`Suspend ${org.name}`}
        intro="Everyone is signed out. Sign-in, the API and signing links stop working until you reactivate the organisation. The owners and admins are emailed the reason."
        submit="Suspend organisation"
        danger
        onClose={() => setDialog(null)}
        onSubmit={({ reason }) => act(`/admin/orgs/${org.id}/suspend`, { reason }, 'Organisation suspended.')}
      />
      <ReasonDialog
        open={dialog?.kind === 'cancel'}
        title="Cancel subscription"
        intro="Cancelling at period end keeps the plan until the paid period finishes. Cancelling now ends it immediately; consider refunding the unused time."
        submit="Cancel subscription"
        choice={{
          label: 'When',
          options: [
            { value: 'period_end', label: 'At the end of the period' },
            { value: 'now', label: 'Immediately' },
          ],
        }}
        onClose={() => setDialog(null)}
        onSubmit={({ reason, choice }) => act(`/admin/orgs/${org.id}/cancel`, { reason, when: choice }, 'Subscription cancelled.')}
      />
      <ReasonDialog
        open={dialog?.kind === 'credit'}
        title="Issue account credit"
        intro="Recorded as a credit note the customer can see under Billing. Apply it to their next manual invoice, or as a customer balance in Stripe or Razorpay."
        submit="Issue credit"
        amount={{ currency: creditCurrency }}
        onClose={() => setDialog(null)}
        onSubmit={({ reason, amount }) => act(`/admin/orgs/${org.id}/credit`, { reason, amount, currency: creditCurrency }, 'Credit issued.')}
      />
      {dialog?.kind === 'refund' && (
        <ReasonDialog
          open
          title={`Refund ${dialog.invoice.number}`}
          intro={
            ['stripe', 'razorpay', 'sandbox'].includes(dialog.invoice.provider)
              ? `The money goes back to the original payment method through ${dialog.invoice.provider}. The customer gets a credit note by email.`
              : 'This invoice was not paid through a card provider. The refund is recorded; transfer the money yourself.'
          }
          submit="Refund"
          amount={{ currency: dialog.invoice.currency, max: dialog.invoice.total - dialog.invoice.refunded }}
          onClose={() => setDialog(null)}
          onSubmit={({ reason, amount }) => act(`/admin/orgs/${org.id}/refund`, { invoiceId: dialog.invoice.id, amount, reason }, 'Refund issued.')}
        />
      )}
    </div>
  );
}

function UserActions({ org, user: u, act, onViewAs }: { org: Detail; user: Detail['users'][number]; act: Act; onViewAs: (userId: string) => void }) {
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {org.supportAccessUntil && !u.disabled && !org.suspendedAt && (
        <Button size="sm" variant="ghost" onClick={() => onViewAs(u.id)}>
          View as
        </Button>
      )}
      <Button size="sm" variant="ghost" disabled={u.activeSessions === 0} onClick={() => act(`/admin/users/${u.id}/sign-out`, {}, `${u.email} was signed out.`)}>
        Sign out
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={u.disabled}
        onClick={() => act(`/admin/users/${u.id}/password-reset`, {}, `Password reset email sent to ${u.email}.`, `Email ${u.email} a password reset link?`)}
      >
        Reset password
      </Button>
      {u.disabled ? (
        <Button size="sm" variant="ghost" onClick={() => act(`/admin/users/${u.id}/reactivate`, {}, `${u.email} was reactivated.`)}>
          Reactivate
        </Button>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="text-red-700"
          onClick={() => act(`/admin/users/${u.id}/deactivate`, {}, `${u.email} was deactivated.`, `Deactivate ${u.email}? They are signed out and can't sign in until reactivated.`)}
        >
          Deactivate
        </Button>
      )}
    </div>
  );
}

function ActionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-3 space-y-4">{children}</div>
    </Card>
  );
}

function Row({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink">{label}</div>
        <div className="text-xs text-gray-500">{hint}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function TrialAndPlan({ org, act }: { org: Detail; act: Act }) {
  const [days, setDays] = useState(7);
  const [plan, setPlan] = useState(org.plan === 'trial' ? 'enterprise' : org.plan);
  const [seats, setSeats] = useState(org.seats);
  const [months, setMonths] = useState(12);
  return (
    <>
      {org.plan === 'trial' && (
        <div className="flex items-end gap-3">
          <div className="w-24">
            <Label htmlFor="days">Extend by</Label>
            <Input id="days" type="number" min={1} max={90} value={days} onChange={(e) => setDays(Number(e.target.value))} />
          </div>
          <span className="pb-2 text-sm text-gray-500">days</span>
          <Button size="sm" className="mb-0.5" onClick={() => act(`/admin/orgs/${org.id}/extend-trial`, { days }, `Trial extended by ${days} days.`, `Extend ${org.name}'s trial by ${days} days?`)}>
            Extend trial
          </Button>
        </div>
      )}
      <div>
        <div className="text-sm font-medium text-ink">Set plan, billed manually</div>
        <div className="text-xs text-gray-500">For Enterprise contracts and pilots. Card billing stops for this organisation.</div>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div className="w-36">
            <Label htmlFor="plan">Plan</Label>
            <Select id="plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
              {PLAN_OPTIONS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-20">
            <Label htmlFor="seats">Seats</Label>
            <Input id="seats" type="number" min={1} value={seats} onChange={(e) => setSeats(Number(e.target.value))} />
          </div>
          <div className="w-20">
            <Label htmlFor="months">Months</Label>
            <Input id="months" type="number" min={1} max={60} value={months} onChange={(e) => setMonths(Number(e.target.value))} />
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="mb-0.5"
            onClick={() =>
              act(`/admin/orgs/${org.id}/plan`, { plan, seats, months }, 'Plan updated.', `Put ${org.name} on ${PLAN_OPTIONS.find((p) => p.id === plan)?.name} with ${seats} seats for ${months} months?`)
            }
          >
            Apply
          </Button>
        </div>
      </div>
    </>
  );
}

/** Dialog asking for a reason, and optionally an amount (entered in major units) or a choice. */
function ReasonDialog({
  open,
  title,
  intro,
  submit,
  danger,
  amount,
  choice,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  intro: string;
  submit: string;
  danger?: boolean;
  amount?: { currency: string; max?: number };
  choice?: { label: string; options: { value: string; label: string }[] };
  onClose: () => void;
  onSubmit: (v: { reason: string; amount: number; choice: string }) => Promise<boolean>;
}) {
  const [reason, setReason] = useState('');
  const [value, setValue] = useState(amount?.max ? String(amount.max / 100) : '');
  const [picked, setPicked] = useState(choice?.options[0].value ?? '');
  const [busy, setBusy] = useState(false);
  const minor = Math.round(Number(value) * 100);
  const amountOk = !amount || (minor > 0 && (!amount.max || minor <= amount.max));

  async function go() {
    setBusy(true);
    const ok = await onSubmit({ reason, amount: minor, choice: picked });
    setBusy(false);
    if (ok) {
      setReason('');
      onClose();
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm text-gray-600">{intro}</p>
      <div className="mt-4 space-y-3">
        {choice && (
          <div>
            <Label htmlFor="dlg-choice">{choice.label}</Label>
            <Select id="dlg-choice" value={picked} onChange={(e) => setPicked(e.target.value)}>
              {choice.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        )}
        {amount && (
          <div>
            <Label htmlFor="dlg-amount" hint={amount.max ? `up to ${formatMoney(amount.max, amount.currency)}` : undefined}>
              Amount ({amount.currency})
            </Label>
            <Input id="dlg-amount" type="number" min={0} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
        )}
        <div>
          <Label htmlFor="dlg-reason">Reason</Label>
          <Textarea id="dlg-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Recorded in the customer's activity log" />
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} disabled={busy || reason.trim().length < 3 || !amountOk} onClick={go}>
          {submit}
        </Button>
      </div>
    </Modal>
  );
}

type LimitMode = 'plan' | 'number' | 'unlimited';

function LimitField({
  id,
  label,
  mode,
  setMode,
  value,
  setValue,
  planText,
}: {
  id: string;
  label: string;
  mode: LimitMode;
  setMode: (m: LimitMode) => void;
  value: string;
  setValue: (v: string) => void;
  planText: string;
}) {
  return (
    <div>
      <Label htmlFor={`${id}-mode`}>{label}</Label>
      <div className="flex gap-2">
        <div className="w-52">
          <Select id={`${id}-mode`} value={mode} onChange={(e) => setMode(e.target.value as LimitMode)}>
            <option value="plan">From the plan ({planText})</option>
            <option value="number">Custom number</option>
            <option value="unlimited">Unlimited</option>
          </Select>
        </div>
        {mode === 'number' && (
          <div className="w-28">
            <Input aria-label={`${label} number`} type="number" min={1} value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Deal-specific limits for this organisation, on top of its plan. */
function CustomLimitsCard({ org, onDone }: { org: Detail; onDone: (text: string, tone: 'success' | 'error') => void }) {
  const c = org.customLimits ?? {};
  const modeOf = (key: 'envelopeLimit' | 'seatLimit'): LimitMode => (!(key in c) ? 'plan' : c[key] === null ? 'unlimited' : 'number');
  const [envMode, setEnvMode] = useState<LimitMode>(modeOf('envelopeLimit'));
  const [envValue, setEnvValue] = useState(c.envelopeLimit ? String(c.envelopeLimit) : '');
  const [seatMode, setSeatMode] = useState<LimitMode>(modeOf('seatLimit'));
  const [seatValue, setSeatValue] = useState(c.seatLimit ? String(c.seatLimit) : '');
  const [extra, setExtra] = useState<string[]>(c.features ?? []);
  const [note, setNote] = useState(c.note ?? '');
  const [busy, setBusy] = useState(false);

  const planEnvelopes = org.planLimits.envelopesPerSeat === null ? 'unlimited' : `${org.planLimits.envelopesPerSeat} per user`;
  const planSeats = org.planLimits.maxSeats === null ? 'no cap' : `up to ${org.planLimits.maxSeats}`;

  async function save(clear = false) {
    setBusy(true);
    const limit = (mode: LimitMode, value: string) => (mode === 'plan' ? undefined : mode === 'unlimited' ? null : Number(value));
    try {
      await api(`/admin/orgs/${org.id}/limits`, {
        method: 'PUT',
        json: clear ? {} : { envelopeLimit: limit(envMode, envValue), seatLimit: limit(seatMode, seatValue), features: extra, note },
      });
      onDone(clear ? 'Custom limits removed. The plan applies again.' : 'Custom limits saved.', 'success');
    } catch (e) {
      onDone(e instanceof ApiError ? e.message : 'Could not save the limits.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">Custom limits</h2>
          <p className="text-sm text-gray-500">For a special deal with this customer: replaces the plan&apos;s limits and adds features, without changing the plan for anyone else.</p>
        </div>
        {org.customLimits && <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">Custom deal active</span>}
      </div>
      <div className="mt-4 grid gap-5 lg:grid-cols-3">
        <LimitField id="env" label="Agreements per period (whole account)" mode={envMode} setMode={setEnvMode} value={envValue} setValue={setEnvValue} planText={planEnvelopes} />
        <LimitField id="seat" label="Users" mode={seatMode} setMode={setSeatMode} value={seatValue} setValue={setSeatValue} planText={planSeats} />
        <div>
          <div className="mb-1 text-sm font-medium text-gray-700">Extra features</div>
          {Object.entries(FEATURE_LABELS).map(([id, label]) => {
            const inPlan = org.planLimits.features.includes(id);
            return (
              <label key={id} className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" disabled={inPlan} checked={inPlan || extra.includes(id)} onChange={(e) => setExtra(e.target.checked ? [...extra, id] : extra.filter((x) => x !== id))} />
                {label}
                {inPlan && <span className="text-xs text-gray-400">(in plan)</span>}
              </label>
            );
          })}
        </div>
      </div>
      <div className="mt-4">
        <Label htmlFor="limits-note" hint="optional">
          Deal note
        </Label>
        <Input id="limits-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Pilot until March: 40 users, unlimited agreements" />
      </div>
      <div className="mt-4 flex justify-between gap-2">
        <Button variant="ghost" size="sm" disabled={busy || !org.customLimits} onClick={() => save(true)}>
          Remove custom limits
        </Button>
        <Button disabled={busy || (envMode === 'number' && !envValue) || (seatMode === 'number' && !seatValue)} onClick={() => save()}>
          Save custom limits
        </Button>
      </div>
    </Card>
  );
}
