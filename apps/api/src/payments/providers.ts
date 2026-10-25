import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';

/**
 * Payment providers for PAYMENT fields. The sandbox ships a built-in test
 * checkout; Stripe (Checkout Sessions) and Razorpay (Payment Links) follow
 * their published REST APIs and are untested without real credentials.
 */

export interface CheckoutRequest {
  paymentId: string;
  amount: number;
  currency: string;
  description: string;
  customerEmail: string;
  customerName: string;
  /** Where the provider sends the payer afterwards */
  returnUrl: string;
}

export interface Checkout {
  url: string;
  providerRef: string;
}

const formatAmount = (amount: number, currency: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).format(amount / 100);
export { formatAmount };

async function stripeCheckout(req: CheckoutRequest): Promise<Checkout> {
  const key = config.payments.stripe.secretKey;
  if (!key) throw new HttpError(503, 'Stripe is not configured.', 'payments_unavailable');
  const body = new URLSearchParams({
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': req.currency.toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(req.amount),
    'line_items[0][price_data][product_data][name]': req.description,
    customer_email: req.customerEmail,
    client_reference_id: req.paymentId,
    'metadata[paymentId]': req.paymentId,
    success_url: `${req.returnUrl}${req.returnUrl.includes('?') ? '&' : '?'}payment=success`,
    cancel_url: `${req.returnUrl}${req.returnUrl.includes('?') ? '&' : '?'}payment=cancelled`,
  });
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new HttpError(502, 'Could not start the Stripe checkout.', 'payments_error');
  const session = (await res.json()) as { id: string; url: string };
  return { url: session.url, providerRef: session.id };
}

/** Stripe-Signature: t=<ts>,v1=<hex HMAC-SHA256 of "ts.payload"> */
export function verifyStripeSignature(rawBody: string, header: string | undefined, secret = config.payments.stripe.webhookSecret, toleranceSec = 300): boolean {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]));
  const ts = Number(parts.t);
  if (!ts || Math.abs(Date.now() / 1000 - ts) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest();
  const given = Buffer.from(parts.v1 ?? '', 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function razorpayCheckout(req: CheckoutRequest): Promise<Checkout> {
  const { keyId, keySecret } = config.payments.razorpay;
  if (!keyId || !keySecret) throw new HttpError(503, 'Razorpay is not configured.', 'payments_unavailable');
  const res = await fetch('https://api.razorpay.com/v1/payment_links', {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: req.amount,
      currency: req.currency,
      description: req.description,
      reference_id: req.paymentId,
      customer: { name: req.customerName, email: req.customerEmail },
      callback_url: `${config.appUrl}/api/v1/payments/razorpay/callback`,
      callback_method: 'get',
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new HttpError(502, 'Could not start the Razorpay payment.', 'payments_error');
  const link = (await res.json()) as { id: string; short_url: string };
  return { url: link.short_url, providerRef: link.id };
}

/** Razorpay payment-link callback signature: HMAC-SHA256(link_id|reference_id|status|payment_id). */
export function verifyRazorpayCallback(q: Record<string, string | undefined>): boolean {
  const secret = config.payments.razorpay.keySecret;
  if (!secret || !q.razorpay_signature) return false;
  const payload = [q.razorpay_payment_link_id, q.razorpay_payment_link_reference_id, q.razorpay_payment_link_status, q.razorpay_payment_id].join('|');
  const expected = createHmac('sha256', secret).update(payload).digest();
  const given = Buffer.from(q.razorpay_signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Built-in test checkout (no money moves). */
async function sandboxCheckout(req: CheckoutRequest): Promise<Checkout> {
  return { url: `${config.appUrl}/api/v1/dev/pay/${req.paymentId}`, providerRef: `sbx_${req.paymentId}` };
}

export async function startCheckout(req: CheckoutRequest): Promise<Checkout & { provider: string }> {
  const provider = config.payments.provider;
  const run = { sandbox: sandboxCheckout, stripe: stripeCheckout, razorpay: razorpayCheckout }[provider];
  if (!run) throw new HttpError(503, 'Payments are not configured.', 'payments_unavailable');
  return { ...(await run(req)), provider };
}
