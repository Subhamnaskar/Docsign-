import type { Invoice, Organization, Prisma } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { badRequest, conflict, HttpError } from '../lib/errors.js';
import {
  addInterval,
  CURRENCIES,
  type Currency,
  defaultCurrency,
  entitlement,
  type Interval,
  isPlanId,
  PLANS,
  periodPrice,
  type PlanId,
  planOf,
  seatsUsed,
} from './plans.js';
import { billingProvider } from './providers.js';

export interface Quote {
  plan: PlanId;
  interval: Interval;
  seats: number;
  currency: Currency;
  subtotal: number;
  /** Basis points */
  taxRate: number;
  taxLabel: string | null;
  tax: number;
  total: number;
}

/** GST applies to INR invoices; other currencies are billed without tax (export of services). */
function taxFor(currency: string): { taxRate: number; taxLabel: string | null } {
  const pct = config.billing.gstRate;
  return currency === 'INR' && pct > 0 ? { taxRate: Math.round(pct * 100), taxLabel: `GST ${pct}%` } : { taxRate: 0, taxLabel: null };
}

const withTax = (subtotal: number, currency: string) => {
  const { taxRate, taxLabel } = taxFor(currency);
  const tax = Math.round((subtotal * taxRate) / 10_000);
  return { subtotal, taxRate, taxLabel, tax, total: subtotal + tax };
};

/** Splits a tax-inclusive amount the provider charged back into subtotal and tax. */
const fromTotal = (total: number, currency: string) => {
  const { taxRate, taxLabel } = taxFor(currency);
  const subtotal = Math.round((total * 10_000) / (10_000 + taxRate));
  return { subtotal, taxRate, taxLabel, tax: total - subtotal, total };
};

export function currencyOf(org: Organization): Currency {
  const c = org.billingCurrency;
  return c && (CURRENCIES as readonly string[]).includes(c) ? (c as Currency) : defaultCurrency(org.jurisdiction);
}

export function quote(org: Organization, plan: PlanId, interval: Interval, seats: number): Quote {
  const currency = currencyOf(org);
  return { plan, interval, seats, currency, ...withTax(periodPrice(PLANS[plan], currency, interval, seats), currency) };
}

const describe = (q: Pick<Quote, 'plan' | 'seats' | 'interval'>) =>
  `${PLANS[q.plan].name} plan, ${q.seats} user${q.seats === 1 ? '' : 's'}, billed ${q.interval === 'year' ? 'yearly' : 'monthly'}`;

export const invoiceNumber = (inv: Pick<Invoice, 'seq' | 'createdAt'>) => `INV-${inv.createdAt.getUTCFullYear()}-${String(inv.seq).padStart(6, '0')}`;

async function validateChoice(org: Organization, plan: string, seats: number) {
  if (!isPlanId(plan) || !PLANS[plan].price) throw badRequest('Choose Starter or Business. Enterprise is set up by our sales team.');
  const p = PLANS[plan];
  if (p.maxSeats !== null && seats > p.maxSeats) throw badRequest(`${p.name} allows up to ${p.maxSeats} users.`);
  const used = await seatsUsed(org.id);
  if (seats < used) throw badRequest(`You have ${used} users and open invitations. Remove some first, or choose at least ${used} seats.`);
  return plan;
}

/** True when the organisation has a running paid subscription to change in place. */
const hasLiveSubscription = (org: Organization) =>
  org.plan !== 'trial' && org.billingProvider !== null && org.billingProvider !== 'manual' && entitlement(org).state !== 'canceled';

export async function recordInvoice(
  org: Organization,
  p: { description: string; plan: string; interval: string; seats: number; periodStart: Date; periodEnd: Date; amounts: ReturnType<typeof withTax>; provider: string; providerRef?: string | null },
  tx: Prisma.TransactionClient = prisma,
) {
  if (p.providerRef && (await tx.invoice.findUnique({ where: { providerRef: p.providerRef } }))) return null;
  return tx.invoice.create({
    data: {
      orgId: org.id,
      description: p.description,
      plan: p.plan,
      interval: p.interval,
      seats: p.seats,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      currency: currencyOf(org),
      ...p.amounts,
      provider: p.provider,
      providerRef: p.providerRef ?? null,
      seller: { ...config.billing.seller },
      billTo: { name: org.billingName || org.name, email: org.billingEmail, address: org.billingAddress, taxId: org.taxId },
    },
  });
}

/**
 * Starts a purchase, or changes a running subscription in place.
 * Returns a checkout URL for new purchases.
 */
export async function checkout(orgId: string, customerEmail: string, input: { plan: string; interval: Interval; seats: number }) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
  const plan = await validateChoice(org, input.plan, input.seats);
  const q = quote(org, plan, input.interval, input.seats);

  if (hasLiveSubscription(org)) {
    if (org.plan === plan && org.seats === input.seats && org.billingInterval === input.interval) throw conflict('That is already your plan.');
    return { changed: true as const, invoice: await changeSubscription(org, q) };
  }

  const pending = await prisma.billingCheckout.create({
    data: { orgId, plan, interval: input.interval, seats: input.seats, currency: q.currency, provider: config.billing.provider },
  });
  const started = await billingProvider().start({
    checkoutId: pending.id,
    orgId,
    description: describe(q),
    amount: q.total,
    currency: q.currency,
    interval: input.interval,
    customerEmail: org.billingEmail || customerEmail,
    returnUrl: `${config.appUrl}/settings?tab=billing`,
  });
  await prisma.billingCheckout.update({ where: { id: pending.id }, data: { providerRef: started.providerRef } });
  return { changed: false as const, url: started.url };
}

async function changeSubscription(org: Organization, q: Quote) {
  const provider = org.billingProvider!;
  const now = new Date();
  const intervalChanged = org.billingInterval !== q.interval;

  if (provider !== 'sandbox') {
    // The provider prorates and charges; its webhook records the invoice
    await billingProvider(provider).change(org.subscriptionRef!, { description: describe(q), amount: q.total, currency: q.currency, interval: q.interval });
    await prisma.organization.update({
      where: { id: org.id },
      data: { plan: q.plan, seats: q.seats, billingInterval: q.interval, ...(intervalChanged ? { currentPeriodStart: now, currentPeriodEnd: addInterval(now, q.interval) } : {}) },
    });
    return null;
  }

  // Sandbox proration: credit the unused part of the current period, charge the rest now
  const old = quote(org, planOf(org).id, org.billingInterval as Interval, org.seats);
  const start = org.currentPeriodStart ?? now;
  const end = org.currentPeriodEnd ?? addInterval(now, old.interval);
  const remaining = Math.max(0, Math.min(1, (end.getTime() - now.getTime()) / (end.getTime() - start.getTime())));
  const credit = Math.round(old.subtotal * remaining);
  const periodStart = intervalChanged ? now : start;
  const periodEnd = intervalChanged ? addInterval(now, q.interval) : end;
  const due = intervalChanged ? q.subtotal - credit : Math.round(q.subtotal * remaining) - credit;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.organization.update({
      where: { id: org.id },
      data: { plan: q.plan, seats: q.seats, billingInterval: q.interval, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false },
    });
    // Reductions take effect now without a refund for the current period
    if (due <= 0) return null;
    return recordInvoice(
      updated,
      { description: `${describe(q)} (prorated change)`, plan: q.plan, interval: q.interval, seats: q.seats, periodStart: now, periodEnd, amounts: withTax(due, q.currency), provider },
      tx,
    );
  });
}

/** Activates the subscription a checkout paid for. Idempotent. */
export async function completeCheckout(checkoutId: string, subscriptionRef: string | null) {
  const claimed = await prisma.billingCheckout.updateMany({ where: { id: checkoutId, status: 'PENDING' }, data: { status: 'COMPLETED' } });
  const c = await prisma.billingCheckout.findUnique({ where: { id: checkoutId } });
  if (!c) return null;
  if (claimed.count === 0) return prisma.organization.findUnique({ where: { id: c.orgId } });
  const now = new Date();
  return prisma.organization.update({
    where: { id: c.orgId },
    data: {
      plan: c.plan,
      seats: c.seats,
      billingInterval: c.interval,
      billingCurrency: c.currency,
      billingStatus: 'ACTIVE',
      billingProvider: c.provider,
      subscriptionRef: subscriptionRef ?? `${c.provider}_${c.id}`,
      cancelAtPeriodEnd: false,
      currentPeriodStart: now,
      currentPeriodEnd: addInterval(now, c.interval as Interval),
    },
  });
}

/** Sandbox purchase: activate and invoice the first period. */
export async function completeSandboxCheckout(checkoutId: string) {
  const org = await completeCheckout(checkoutId, null);
  if (!org) return null;
  const q = quote(org, planOf(org).id, org.billingInterval as Interval, org.seats);
  await recordInvoice(org, {
    description: describe(q),
    plan: q.plan,
    interval: q.interval,
    seats: q.seats,
    periodStart: org.currentPeriodStart!,
    periodEnd: org.currentPeriodEnd!,
    amounts: withTax(q.subtotal, q.currency),
    provider: 'sandbox',
    providerRef: `sbx_first_${checkoutId}`,
  });
  return org;
}

/** Records a charge the provider reports (first payment or renewal). */
export async function recordProviderCharge(
  subscriptionRef: string,
  charge: { providerRef: string; total: number; periodStart?: Date; periodEnd?: Date; checkoutId?: string },
) {
  if (charge.checkoutId) await completeCheckout(charge.checkoutId, subscriptionRef);
  const org = await prisma.organization.findUnique({ where: { subscriptionRef } });
  if (!org) return null;
  const periodStart = charge.periodStart ?? new Date();
  const periodEnd = charge.periodEnd ?? addInterval(periodStart, org.billingInterval as Interval);
  const updated = await prisma.organization.update({
    where: { id: org.id },
    data: { billingStatus: 'ACTIVE', currentPeriodStart: periodStart, currentPeriodEnd: periodEnd },
  });
  const q = { plan: planOf(org).id, seats: org.seats, interval: org.billingInterval as Interval };
  return recordInvoice(updated, {
    description: describe(q),
    ...q,
    periodStart,
    periodEnd,
    amounts: fromTotal(charge.total, currencyOf(org)),
    provider: org.billingProvider ?? 'unknown',
    providerRef: charge.providerRef,
  });
}

export async function setSubscriptionStatus(subscriptionRef: string, status: 'PAST_DUE' | 'CANCELED' | 'ACTIVE', cancelAtPeriodEnd?: boolean) {
  await prisma.organization.updateMany({
    where: { subscriptionRef },
    data: { billingStatus: status, ...(cancelAtPeriodEnd === undefined ? {} : { cancelAtPeriodEnd }) },
  });
}

export async function cancel(orgId: string) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
  if (!hasLiveSubscription(org)) throw badRequest('There is no active subscription to cancel.');
  if (org.cancelAtPeriodEnd) return org;
  await billingProvider(org.billingProvider!).cancel(org.subscriptionRef!, true);
  return prisma.organization.update({ where: { id: orgId }, data: { cancelAtPeriodEnd: true } });
}

export async function resume(orgId: string) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
  if (!hasLiveSubscription(org) || !org.cancelAtPeriodEnd) throw badRequest('The subscription is not scheduled to cancel.');
  await billingProvider(org.billingProvider!).resume(org.subscriptionRef!);
  return prisma.organization.update({ where: { id: orgId }, data: { cancelAtPeriodEnd: false } });
}

/**
 * Sandbox renewals (worker): real providers charge on their own schedule and
 * report it by webhook. Ends subscriptions scheduled to cancel.
 */
export async function renewSandboxSubscriptions(now = new Date()) {
  const due = await prisma.organization.findMany({
    where: { billingProvider: 'sandbox', billingStatus: 'ACTIVE', currentPeriodEnd: { lte: now } },
    take: 50,
  });
  for (const org of due) {
    if (org.cancelAtPeriodEnd) {
      await prisma.organization.update({ where: { id: org.id }, data: { billingStatus: 'CANCELED' } });
      continue;
    }
    const interval = org.billingInterval as Interval;
    const periodStart = org.currentPeriodEnd!;
    const periodEnd = addInterval(periodStart, interval);
    const claimed = await prisma.organization.updateMany({
      where: { id: org.id, currentPeriodEnd: periodStart },
      data: { currentPeriodStart: periodStart, currentPeriodEnd: periodEnd },
    });
    if (claimed.count === 0) continue;
    const q = quote(org, planOf(org).id, interval, org.seats);
    await recordInvoice(org, {
      description: describe(q),
      plan: q.plan,
      interval,
      seats: q.seats,
      periodStart,
      periodEnd,
      amounts: withTax(q.subtotal, q.currency),
      provider: 'sandbox',
      providerRef: `sbx_renew_${org.id}_${periodStart.getTime()}`,
    });
  }
}

export function assertBillable(org: Organization) {
  if (org.billingProvider === 'manual') throw new HttpError(400, 'Your plan is managed by our sales team. Contact them to make changes.', 'billing_managed');
}
