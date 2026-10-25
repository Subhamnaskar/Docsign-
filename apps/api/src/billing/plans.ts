import type { Organization } from '@prisma/client';
import { prisma } from '../db.js';
import { HttpError } from '../lib/errors.js';

/**
 * Plans, limits and prices: the single source for the API, the in-app billing
 * page and the public pricing page.
 *
 * Prices are PLACEHOLDERS until the business sets them. They are per user per
 * month, in minor units, before tax. Yearly billing charges 10 months.
 */

export type PlanId = 'trial' | 'starter' | 'business' | 'enterprise';
export type Feature = 'api' | 'bulkSend' | 'sso';
export type Interval = 'month' | 'year';
export const CURRENCIES = ['INR', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

export interface Plan {
  id: PlanId;
  name: string;
  /** Envelopes sent per user per billing period; null = unlimited */
  envelopesPerSeat: number | null;
  /** Most users the plan allows; null = no cap */
  maxSeats: number | null;
  features: Feature[];
  /** Per user per month, minor units; null = not sold online (contact sales) */
  price: Record<Currency, number> | null;
}

export const TRIAL_DAYS = 14;
export const TRIAL_ENVELOPES = 25;
export const TRIAL_SEATS = 5;
export const YEARLY_MONTHS = 10;

export const PLANS: Record<PlanId, Plan> = {
  trial: { id: 'trial', name: 'Free trial', envelopesPerSeat: null, maxSeats: TRIAL_SEATS, features: ['api', 'bulkSend', 'sso'], price: null },
  starter: { id: 'starter', name: 'Starter', envelopesPerSeat: 25, maxSeats: 5, features: [], price: { INR: 499_00, USD: 10_00 } },
  business: { id: 'business', name: 'Business', envelopesPerSeat: 100, maxSeats: null, features: ['api', 'bulkSend'], price: { INR: 1_299_00, USD: 25_00 } },
  enterprise: { id: 'enterprise', name: 'Enterprise', envelopesPerSeat: null, maxSeats: null, features: ['api', 'bulkSend', 'sso'], price: null },
};

export const FEATURE_NAMES: Record<Feature, string> = {
  api: 'The API, webhooks and integrations',
  bulkSend: 'Bulk send',
  sso: 'Single sign-on and SCIM',
};

export const isPlanId = (id: string): id is PlanId => id in PLANS;
export const planOf = (org: Pick<Organization, 'plan'>): Plan => PLANS[isPlanId(org.plan) ? org.plan : 'trial'];
export const defaultCurrency = (jurisdiction: string): Currency => (jurisdiction === 'IN' ? 'INR' : 'USD');

/** Price for one billing period, before tax. */
export function periodPrice(plan: Plan, currency: Currency, interval: Interval, seats: number): number {
  if (!plan.price) throw new HttpError(400, `${plan.name} is not sold online. Contact sales.`, 'plan_not_purchasable');
  return plan.price[currency] * seats * (interval === 'year' ? YEARLY_MONTHS : 1);
}

export function addInterval(d: Date, interval: Interval): Date {
  const r = new Date(d);
  if (interval === 'year') r.setUTCFullYear(r.getUTCFullYear() + 1);
  else r.setUTCMonth(r.getUTCMonth() + 1);
  return r;
}

export type BillingState = 'trialing' | 'trial_expired' | 'active' | 'past_due' | 'canceled';

export interface Entitlement {
  plan: Plan;
  state: BillingState;
  canSend: boolean;
  /** Why sending is blocked (shown to the user) */
  blockedReason: string | null;
  periodStart: Date;
  periodEnd: Date | null;
  envelopeLimit: number | null;
  seatLimit: number | null;
}

/** What the organisation may do right now. Pure: no database access. */
export function entitlement(org: Organization, now = new Date()): Entitlement {
  const plan = planOf(org);
  if (plan.id === 'trial') {
    const expired = org.trialEndsAt <= now;
    return {
      plan,
      state: expired ? 'trial_expired' : 'trialing',
      canSend: !expired,
      blockedReason: expired ? 'Your free trial has ended. Choose a plan to keep sending.' : null,
      periodStart: org.createdAt,
      periodEnd: org.trialEndsAt,
      envelopeLimit: TRIAL_ENVELOPES,
      seatLimit: TRIAL_SEATS,
    };
  }
  const ended = org.billingStatus === 'CANCELED' || (org.cancelAtPeriodEnd && org.currentPeriodEnd !== null && org.currentPeriodEnd <= now);
  const state: BillingState = ended ? 'canceled' : org.billingStatus === 'PAST_DUE' ? 'past_due' : 'active';
  return {
    plan,
    state,
    // Past-due accounts keep sending while the provider retries the payment
    canSend: !ended,
    blockedReason: ended ? 'Your subscription has ended. Choose a plan to keep sending.' : null,
    periodStart: org.currentPeriodStart ?? org.createdAt,
    periodEnd: org.currentPeriodEnd,
    envelopeLimit: plan.envelopesPerSeat === null ? null : plan.envelopesPerSeat * org.seats,
    seatLimit: org.seats,
  };
}

export const envelopesUsed = (orgId: string, since: Date) => prisma.envelope.count({ where: { orgId, sentAt: { gte: since } } });

/** Active users plus open invitations. */
export async function seatsUsed(orgId: string) {
  const [users, invitations] = await Promise.all([
    prisma.user.count({ where: { orgId, disabledAt: null } }),
    prisma.invitation.count({ where: { orgId, acceptedAt: null, expiresAt: { gt: new Date() } } }),
  ]);
  return users + invitations;
}

const loadOrg = (orgId: string) => prisma.organization.findUniqueOrThrow({ where: { id: orgId } });

/** Refuses a send that the plan doesn't allow (trial over, subscription ended, monthly limit reached). */
export async function assertCanSend(orgId: string) {
  const ent = entitlement(await loadOrg(orgId));
  if (!ent.canSend) throw new HttpError(402, ent.blockedReason!, 'plan_inactive');
  if (ent.envelopeLimit !== null && (await envelopesUsed(orgId, ent.periodStart)) >= ent.envelopeLimit) {
    const when = ent.state === 'trialing' ? 'during the trial' : 'this billing period';
    throw new HttpError(402, `You have sent all ${ent.envelopeLimit} agreements included ${when}. Upgrade or add users to send more.`, 'plan_limit');
  }
}

/** Refuses adding a user beyond the seats paid for. */
export async function assertSeatAvailable(orgId: string) {
  const ent = entitlement(await loadOrg(orgId));
  if (ent.seatLimit !== null && (await seatsUsed(orgId)) >= ent.seatLimit) {
    throw new HttpError(402, `All ${ent.seatLimit} user seats are in use. Add seats under Settings → Billing.`, 'seat_limit');
  }
}

/** Refuses a feature the plan doesn't include. */
export async function assertFeature(orgId: string, feature: Feature) {
  const plan = planOf(await loadOrg(orgId));
  if (!plan.features.includes(feature)) {
    const needed = feature === 'sso' ? 'Enterprise' : 'Business';
    throw new HttpError(402, `${FEATURE_NAMES[feature]} needs the ${needed} plan.`, 'plan_feature');
  }
}
