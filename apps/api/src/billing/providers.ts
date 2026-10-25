import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';
import type { Interval } from './plans.js';

/**
 * Subscription providers. The sandbox completes purchases on a built-in test
 * page; Stripe (Billing via Checkout Sessions) and Razorpay (Subscriptions)
 * follow their published REST APIs and are untested without real credentials.
 *
 * Every provider charges one recurring line whose amount already includes tax,
 * so the invoice we issue matches what the customer paid.
 */

export interface SubscriptionRequest {
  checkoutId: string;
  orgId: string;
  description: string;
  /** Per period, tax included, minor units */
  amount: number;
  currency: string;
  interval: Interval;
  customerEmail: string;
  returnUrl: string;
}

export interface SubscriptionChange {
  description: string;
  amount: number;
  currency: string;
  interval: Interval;
}

export interface BillingProvider {
  start(req: SubscriptionRequest): Promise<{ url: string; providerRef: string }>;
  /** Applies a plan, seat or interval change now (the provider prorates) */
  change(subscriptionRef: string, change: SubscriptionChange): Promise<void>;
  cancel(subscriptionRef: string, atPeriodEnd: boolean): Promise<void>;
  resume(subscriptionRef: string): Promise<void>;
}

const withParam = (url: string, kv: string) => `${url}${url.includes('?') ? '&' : '?'}${kv}`;

// --- Sandbox ------------------------------------------------------------------

const sandbox: BillingProvider = {
  async start(req) {
    return { url: `${config.appUrl}/api/v1/dev/billing/${req.checkoutId}`, providerRef: `sbx_${req.checkoutId}` };
  },
  async change() {},
  async cancel() {},
  async resume() {},
};

// --- Stripe -------------------------------------------------------------------

async function stripe<T>(method: 'GET' | 'POST', path: string, params?: Record<string, string>): Promise<T> {
  const key = config.payments.stripe.secretKey;
  if (!key) throw new HttpError(503, 'Stripe is not configured.', 'billing_unavailable');
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params ? new URLSearchParams(params) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new HttpError(502, 'The payment provider rejected the request.', 'billing_error');
  return (await res.json()) as T;
}

const stripeProvider: BillingProvider = {
  async start(req) {
    const session = await stripe<{ id: string; url: string }>('POST', '/checkout/sessions', {
      mode: 'subscription',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': req.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(req.amount),
      'line_items[0][price_data][recurring][interval]': req.interval,
      'line_items[0][price_data][product_data][name]': req.description,
      customer_email: req.customerEmail,
      client_reference_id: req.checkoutId,
      'metadata[checkoutId]': req.checkoutId,
      'subscription_data[metadata][checkoutId]': req.checkoutId,
      'subscription_data[metadata][orgId]': req.orgId,
      success_url: withParam(req.returnUrl, 'checkout=success'),
      cancel_url: withParam(req.returnUrl, 'checkout=cancelled'),
    });
    return { url: session.url, providerRef: session.id };
  },
  async change(ref, c) {
    const sub = await stripe<{ items: { data: { id: string; price: { product: string } }[] } }>('GET', `/subscriptions/${ref}`);
    const item = sub.items.data[0];
    await stripe('POST', `/subscriptions/${ref}`, {
      'items[0][id]': item.id,
      'items[0][quantity]': '1',
      'items[0][price_data][currency]': c.currency.toLowerCase(),
      'items[0][price_data][unit_amount]': String(c.amount),
      'items[0][price_data][recurring][interval]': c.interval,
      'items[0][price_data][product]': item.price.product,
      proration_behavior: 'always_invoice',
    });
  },
  async cancel(ref, atPeriodEnd) {
    if (atPeriodEnd) await stripe('POST', `/subscriptions/${ref}`, { cancel_at_period_end: 'true' });
    else await stripe('POST', `/subscriptions/${ref}/cancel`);
  },
  async resume(ref) {
    await stripe('POST', `/subscriptions/${ref}`, { cancel_at_period_end: 'false' });
  },
};

// --- Razorpay -----------------------------------------------------------------

async function razorpay<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
  const { keyId, keySecret } = config.payments.razorpay;
  if (!keyId || !keySecret) throw new HttpError(503, 'Razorpay is not configured.', 'billing_unavailable');
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new HttpError(502, 'The payment provider rejected the request.', 'billing_error');
  return (await res.json()) as T;
}

/** Razorpay subscriptions need a plan object per price. */
const razorpayPlan = async (c: SubscriptionChange) =>
  (
    await razorpay<{ id: string }>('POST', '/plans', {
      period: c.interval === 'year' ? 'yearly' : 'monthly',
      interval: 1,
      item: { name: c.description, amount: c.amount, currency: c.currency },
    })
  ).id;

const razorpayProvider: BillingProvider = {
  async start(req) {
    const sub = await razorpay<{ id: string; short_url: string }>('POST', '/subscriptions', {
      plan_id: await razorpayPlan(req),
      // Razorpay requires a finite cycle count: ten years either way
      total_count: req.interval === 'year' ? 10 : 120,
      quantity: 1,
      customer_notify: 1,
      notes: { checkoutId: req.checkoutId, orgId: req.orgId },
    });
    return { url: sub.short_url, providerRef: sub.id };
  },
  async change(ref, c) {
    await razorpay('PATCH', `/subscriptions/${ref}`, { plan_id: await razorpayPlan(c), schedule_change_at: 'now', customer_notify: 1 });
  },
  async cancel(ref, atPeriodEnd) {
    await razorpay('POST', `/subscriptions/${ref}/cancel`, { cancel_at_cycle_end: atPeriodEnd ? 1 : 0 });
  },
  async resume() {
    throw new HttpError(400, 'Razorpay cannot undo a scheduled cancellation. Start a new subscription after it ends.', 'billing_unsupported');
  },
};

export function billingProvider(name: string = config.billing.provider): BillingProvider {
  const p = { sandbox, stripe: stripeProvider, razorpay: razorpayProvider }[name];
  if (!p) throw new HttpError(503, 'Billing is not configured.', 'billing_unavailable');
  return p;
}

const hmacMatches = (secret: string, payload: string, givenHex: string) => {
  const expected = createHmac('sha256', secret).update(payload).digest();
  const given = Buffer.from(givenHex, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
};

/** Razorpay webhooks: X-Razorpay-Signature = hex HMAC-SHA256(raw body, webhook secret). */
export function verifyRazorpayWebhook(rawBody: string, signature: string | undefined): boolean {
  const secret = config.billing.razorpayWebhookSecret;
  return Boolean(secret && signature && hmacMatches(secret, rawBody, signature));
}
