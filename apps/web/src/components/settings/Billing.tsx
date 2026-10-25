'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, cx, Input, Label, Spinner, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

type Currency = 'INR' | 'USD';
type Interval = 'month' | 'year';

interface PublicPlan {
  id: 'starter' | 'business' | 'enterprise';
  name: string;
  envelopesPerSeat: number | null;
  maxSeats: number | null;
  features: string[];
  price: Record<Currency, number> | null;
}

interface PlansResponse {
  trial: { days: number; envelopes: number; seats: number };
  yearlyMonths: number;
  plans: PublicPlan[];
}

interface BillingState {
  plan: string;
  planName: string;
  state: 'trialing' | 'trial_expired' | 'active' | 'past_due' | 'canceled';
  canSend: boolean;
  blockedReason: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  periodStart: string;
  periodEnd: string | null;
  provider: string;
  managed: boolean;
  currency: Currency;
  interval: Interval;
  seats: number;
  usage: { envelopes: number; envelopeLimit: number | null; seats: number; seatLimit: number | null };
  details: { billingName: string | null; billingEmail: string | null; billingAddress: string | null; taxId: string | null };
  invoices: { id: string; number: string; description: string; currency: Currency; total: number; paidAt: string }[];
  creditNotes: { id: string; number: string; kind: 'refund' | 'credit'; amount: number; currency: Currency; reason: string; invoice: string | null; createdAt: string }[];
}

interface Quote {
  subtotal: number;
  tax: number;
  taxLabel: string | null;
  total: number;
  currency: Currency;
}

export const money = (minor: number, currency: string) =>
  new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency, maximumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100);

const daysUntil = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-gray-600">{label}</span>
        <span className="font-medium text-gray-900">
          {used}
          <span className="font-normal text-gray-500"> {limit === null ? '(unlimited)' : `of ${limit}`}</span>
        </span>
      </div>
      {limit !== null && (
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={used} aria-valuemax={limit} aria-label={label}>
          <div className={cx('h-full rounded-full', pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-brand-600')} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

function statusLine(b: BillingState) {
  if (b.state === 'trialing' && b.trialEndsAt) return `Free trial: ${daysUntil(b.trialEndsAt)} days left (ends ${formatDate(b.trialEndsAt)}).`;
  if (b.state === 'trial_expired') return 'Your free trial has ended. Choose a plan to keep sending agreements.';
  if (b.state === 'canceled') return 'Your subscription has ended. You can still view and download agreements. Choose a plan to send again.';
  if (b.state === 'past_due') return 'Your last payment failed. Update your payment method with the provider to avoid interruption.';
  if (b.cancelAtPeriodEnd && b.periodEnd) return `Cancels on ${formatDate(b.periodEnd)}. You can keep using it until then.`;
  return b.periodEnd ? `Renews on ${formatDate(b.periodEnd)}, billed ${b.interval === 'year' ? 'yearly' : 'monthly'}.` : '';
}

const STATE_BADGE: Record<BillingState['state'], [string, string]> = {
  trialing: ['Trial', 'bg-brand-50 text-brand-700'],
  trial_expired: ['Trial ended', 'bg-red-50 text-red-700'],
  active: ['Active', 'bg-green-50 text-green-700'],
  past_due: ['Payment failed', 'bg-amber-50 text-amber-800'],
  canceled: ['Ended', 'bg-red-50 text-red-700'],
};

/** Plan, usage, plan changes, invoice details and invoices. Owners and admins only. */
export function BillingSettings() {
  const [b, setB] = useState<BillingState | null>(null);
  const [plans, setPlans] = useState<PlansResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null);

  const load = useCallback(() => api<BillingState>('/billing').then(setB), []);
  useEffect(() => {
    load().catch((e) => setError(e.message));
    api<PlansResponse>('/billing/plans').then(setPlans).catch(() => {});
    const outcome = new URLSearchParams(window.location.search).get('checkout');
    if (outcome === 'success') setNotice({ tone: 'success', text: 'Thank you. Your subscription is active.' });
    if (outcome === 'cancelled') setNotice({ tone: 'warning', text: 'Checkout was cancelled. Nothing was charged.' });
  }, [load]);

  async function run(fn: () => Promise<unknown>, success?: string) {
    setError(null);
    setNotice(null);
    try {
      await fn();
      await load();
      if (success) setNotice({ tone: 'success', text: success });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!b) {
    return error ? <Alert>{error}</Alert> : <div className="flex justify-center py-16 text-brand-600"><Spinner /></div>;
  }
  const [badge, badgeClass] = STATE_BADGE[b.state];
  const subscribed = b.plan !== 'trial' && b.state !== 'canceled';

  return (
    <>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {error && <Alert>{error}</Alert>}

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">{b.planName}</h2>
              <span className={cx('rounded-full px-2 py-0.5 text-xs font-medium', badgeClass)}>{badge}</span>
            </div>
            <p className="mt-1 text-sm text-gray-600">{statusLine(b)}</p>
            {b.provider === 'sandbox' && subscribed && <p className="mt-1 text-xs text-amber-700">Test mode: no real payments are taken.</p>}
          </div>
          {subscribed && !b.managed && (
            b.cancelAtPeriodEnd ? (
              <Button variant="secondary" onClick={() => run(() => api('/billing/resume', { method: 'POST' }), 'Your subscription will continue.')}>
                Keep subscription
              </Button>
            ) : (
              <Button
                variant="ghost"
                className="text-red-600"
                onClick={() => {
                  if (confirm('Cancel at the end of the current period? You can keep using the plan until then.')) {
                    run(() => api('/billing/cancel', { method: 'POST' }), 'Your subscription will end at the close of this period.');
                  }
                }}
              >
                Cancel subscription
              </Button>
            )
          )}
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Meter label={b.state === 'trialing' ? 'Agreements sent during the trial' : 'Agreements sent this period'} used={b.usage.envelopes} limit={b.usage.envelopeLimit} />
          <Meter label="Users and open invitations" used={b.usage.seats} limit={b.usage.seatLimit} />
        </div>
      </Card>

      {b.managed ? (
        <Card className="p-5 text-sm text-gray-600">
          Your plan is managed by our sales team. <Link href="/contact?interest=pricing" className="font-medium text-brand-700 hover:underline">Contact us</Link> to change seats or terms.
        </Card>
      ) : (
        plans && <PlanPicker billing={b} plans={plans} onDone={(text) => run(async () => {}, text)} onError={setError} />
      )}

      <BillingDetails initial={b.details} onSaved={() => setNotice({ tone: 'success', text: 'Invoice details saved. They appear on future invoices.' })} />

      <Card className="p-5">
        <h2 className="font-semibold">Invoices</h2>
        {b.invoices.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No invoices yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="py-2 font-medium">Invoice</th>
                  <th className="py-2 font-medium">Date</th>
                  <th className="py-2 font-medium">Description</th>
                  <th className="py-2 text-right font-medium">Total</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {b.invoices.map((i) => (
                  <tr key={i.id}>
                    <td className="py-2.5 font-mono text-xs">{i.number}</td>
                    <td className="py-2.5 text-gray-600">{formatDate(i.paidAt)}</td>
                    <td className="py-2.5 text-gray-600">{i.description}</td>
                    <td className="py-2.5 text-right font-medium">{money(i.total, i.currency)}</td>
                    <td className="py-2.5 text-right">
                      <a href={`/api/v1/billing/invoices/${i.id}/pdf`} className="font-medium text-brand-700 hover:underline">
                        PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {b.creditNotes.length > 0 && (
        <Card className="p-5">
          <h2 className="font-semibold">Refunds and credits</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="py-2 font-medium">Credit note</th>
                  <th className="py-2 font-medium">Date</th>
                  <th className="py-2 font-medium">Details</th>
                  <th className="py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {b.creditNotes.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2.5 font-mono text-xs">{c.number}</td>
                    <td className="py-2.5 text-gray-600">{formatDate(c.createdAt)}</td>
                    <td className="py-2.5 text-gray-600">
                      {c.kind === 'refund' ? `Refund${c.invoice ? ` of ${c.invoice}` : ''}` : 'Account credit'}: {c.reason}
                    </td>
                    <td className="py-2.5 text-right font-medium">{money(c.amount, c.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function PlanPicker({ billing, plans, onDone, onError }: { billing: BillingState; plans: PlansResponse; onDone: (text: string) => void; onError: (m: string) => void }) {
  const subscribed = billing.plan !== 'trial' && billing.state !== 'canceled';
  const [plan, setPlan] = useState<'starter' | 'business'>(billing.plan === 'starter' ? 'starter' : 'business');
  const [interval, setBillingInterval] = useState<Interval>(billing.interval);
  const [seats, setSeats] = useState(Math.max(billing.usage.seats, subscribed ? billing.seats : 1));
  const [q, setQ] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = plans.plans.find((p) => p.id === plan)!;
  const seatsValid = seats >= 1 && (selected.maxSeats === null || seats <= selected.maxSeats) && seats >= billing.usage.seats;
  const unchanged = subscribed && billing.plan === plan && billing.seats === seats && billing.interval === interval;

  useEffect(() => {
    if (!seatsValid) return setQ(null);
    const t = setTimeout(() => {
      api<Quote>('/billing/quote', { method: 'POST', json: { plan, interval, seats } }).then(setQ).catch(() => setQ(null));
    }, 200);
    return () => clearTimeout(t);
  }, [plan, interval, seats, seatsValid]);

  async function go() {
    setBusy(true);
    onError('');
    try {
      const res = await api<{ url?: string; changed?: boolean }>('/billing/checkout', { method: 'POST', json: { plan, interval, seats } });
      if (res.url) return window.location.assign(res.url);
      onDone('Your plan has been updated.');
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">{subscribed ? 'Change plan' : 'Choose a plan'}</h2>
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 text-sm" role="group" aria-label="Billing period">
          {(['month', 'year'] as const).map((i) => (
            <button
              key={i}
              onClick={() => setBillingInterval(i)}
              aria-pressed={interval === i}
              className={cx('rounded-md px-3 py-1.5 font-medium', interval === i ? 'bg-brand-600 text-white' : 'text-gray-600 hover:text-gray-900')}
            >
              {i === 'month' ? 'Monthly' : `Yearly (${12 - plans.yearlyMonths} months free)`}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {plans.plans.map((p) => {
          const buyable = p.id !== 'enterprise';
          const active = buyable && p.id === plan;
          return (
            <div
              key={p.id}
              role={buyable ? 'button' : undefined}
              tabIndex={buyable ? 0 : undefined}
              aria-pressed={buyable ? active : undefined}
              onClick={() => buyable && setPlan(p.id as 'starter' | 'business')}
              onKeyDown={(e) => buyable && (e.key === 'Enter' || e.key === ' ') && setPlan(p.id as 'starter' | 'business')}
              className={cx(
                'rounded-xl border p-4 text-sm',
                buyable && 'cursor-pointer',
                active ? 'border-brand-600 ring-1 ring-brand-600' : 'border-gray-200 hover:border-gray-300',
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-gray-900">{p.name}</span>
                {billing.plan === p.id && subscribed && <span className="text-xs text-gray-500">Current</span>}
              </div>
              <div className="mt-2">
                {p.price ? (
                  <>
                    <span className="text-2xl font-bold text-gray-900">{money(p.price[billing.currency], billing.currency)}</span>
                    <span className="text-gray-500"> / user / month</span>
                  </>
                ) : (
                  <span className="text-lg font-semibold text-gray-900">Custom</span>
                )}
              </div>
              <ul className="mt-3 space-y-1 text-gray-600">
                <li>{p.envelopesPerSeat === null ? 'Unlimited agreements' : `${p.envelopesPerSeat} agreements per user / month`}</li>
                <li>{p.maxSeats === null ? 'Any number of users' : `Up to ${p.maxSeats} users`}</li>
                {p.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {!buyable && (
                <Link href="/contact?interest=pricing" className="mt-3 inline-block font-medium text-brand-700 hover:underline">
                  Talk to sales →
                </Link>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap items-end gap-6">
        <div className="w-32">
          <Label htmlFor="seats">Users</Label>
          <Input id="seats" type="number" min={Math.max(1, billing.usage.seats)} max={selected.maxSeats ?? undefined} value={seats} onChange={(e) => setSeats(Number(e.target.value))} />
        </div>
        <div className="min-w-0 flex-1 text-sm">
          {!seatsValid ? (
            <p className="text-red-600">
              {seats < billing.usage.seats
                ? `You have ${billing.usage.seats} users and invitations; choose at least that many.`
                : `${selected.name} allows up to ${selected.maxSeats} users.`}
            </p>
          ) : q ? (
            <p className="text-gray-600">
              {money(q.subtotal, q.currency)}
              {q.tax > 0 && ` + ${q.taxLabel} ${money(q.tax, q.currency)}`} ={' '}
              <strong className="text-gray-900">
                {money(q.total, q.currency)} / {interval}
              </strong>
            </p>
          ) : null}
        </div>
        <Button onClick={go} loading={busy} disabled={!seatsValid || unchanged}>
          {subscribed ? 'Update plan' : 'Continue to payment'}
        </Button>
      </div>
      {subscribed && <p className="mt-3 text-xs text-gray-500">Changes apply now. Increases are charged pro rata for the rest of this period; reductions are not refunded.</p>}
    </Card>
  );
}

function BillingDetails({ initial, onSaved }: { initial: BillingState['details']; onSaved: () => void }) {
  const [d, setD] = useState({
    billingName: initial.billingName ?? '',
    billingEmail: initial.billingEmail ?? '',
    billingAddress: initial.billingAddress ?? '',
    taxId: initial.taxId ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof d) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api('/billing/details', { method: 'PATCH', json: d });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="font-semibold">Invoice details</h2>
      <p className="mt-1 text-sm text-gray-500">Printed on your invoices. Add your GSTIN to claim input tax credit.</p>
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="bill-name">Legal name</Label>
          <Input id="bill-name" value={d.billingName} onChange={set('billingName')} placeholder="Acme Lending Pvt Ltd" />
        </div>
        <div>
          <Label htmlFor="bill-email">Billing email</Label>
          <Input id="bill-email" type="email" value={d.billingEmail} onChange={set('billingEmail')} placeholder="accounts@example.com" />
        </div>
        <div>
          <Label htmlFor="bill-address">Address</Label>
          <Textarea id="bill-address" rows={3} value={d.billingAddress} onChange={set('billingAddress')} />
        </div>
        <div>
          <Label htmlFor="bill-tax" hint="15 characters, e.g. 27AAPFU0939F1ZV">
            GSTIN / tax ID
          </Label>
          <Input id="bill-tax" className="font-mono uppercase" value={d.taxId} onChange={set('taxId')} maxLength={30} />
        </div>
      </div>
      <div className="mt-4">
        <Button variant="secondary" onClick={save} loading={busy}>
          Save details
        </Button>
      </div>
    </Card>
  );
}
