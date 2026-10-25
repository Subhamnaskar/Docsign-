import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';
import { renewSandboxSubscriptions } from '../src/billing/service.js';
import { prisma } from '../src/db.js';
import { client, getApp, makePdf, multipart, registerSender, uid } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await getApp();
});

type Client = ReturnType<typeof client>;

const orgOf = async (c: Client) => (await c.json('GET', '/auth/me')).organization.id as string;

/** A ready-to-send draft with one signer and a signature field. */
async function draft(c: Client) {
  let env = await c.json('POST', '/envelopes', { json: { title: 'Plan check' } });
  const { payload, headers } = multipart('p.pdf', await makePdf('Plan check'));
  const doc = await c.json('POST', `/envelopes/${env.id}/documents`, { payload, headers });
  env = await c.json('PUT', `/envelopes/${env.id}/recipients`, { json: [{ name: 'Signer', email: `s-${uid()}@example.test` }] });
  await c.json('PUT', `/envelopes/${env.id}/fields`, {
    json: [{ documentId: doc.id, recipientId: env.recipients[0].id, type: 'SIGNATURE', page: 0, x: 0.1, y: 0.1, width: 0.3, height: 0.06 }],
  });
  return env.id as string;
}

/** Buys a plan through the sandbox checkout. */
async function subscribe(c: Client, plan: string, seats: number, interval = 'month') {
  const { url } = await c.json('POST', '/billing/checkout', { json: { plan, seats, interval } });
  const id = new URL(url).pathname.split('/').pop()!;
  const page = await app.inject({ method: 'GET', url: `/api/v1/dev/billing/${id}` });
  const paid = await app.inject({ method: 'POST', url: `/api/v1/dev/billing/${id}`, payload: 'outcome=pay', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  expect(paid.statusCode).toBe(303);
  expect(paid.headers.location).toMatch(/tab=billing&checkout=success/);
  return page.body;
}

describe('plans and limits', () => {
  it('publishes plans and starts every organisation on a trial', async () => {
    const plans = (await app.inject({ method: 'GET', url: '/api/v1/billing/plans' })).json();
    expect(plans.trial).toMatchObject({ days: 14, envelopes: 25 });
    expect(plans.plans.map((p: { id: string }) => p.id)).toEqual(['starter', 'business', 'enterprise']);

    const { c } = await registerSender(app, 'IN');
    const me = await c.json('GET', '/auth/me');
    expect(me.billing).toMatchObject({ plan: 'trial', state: 'trialing', canSend: true });
    const billing = await c.json('GET', '/billing');
    expect(billing.currency).toBe('INR');
    expect(billing.usage).toMatchObject({ envelopes: 0, envelopeLimit: 25, seats: 1, seatLimit: 5 });
  });

  it('blocks sending when the trial ends or its allowance is used', async () => {
    const { c } = await registerSender(app);
    const orgId = await orgOf(c);
    const id = await draft(c);

    await prisma.organization.update({ where: { id: orgId }, data: { trialEndsAt: new Date(Date.now() - 1000) } });
    const ended = await c.call('POST', `/envelopes/${id}/send`);
    expect(ended.statusCode).toBe(402);
    expect(ended.json().error.code).toBe('plan_inactive');
    expect((await c.json('GET', '/auth/me')).billing).toMatchObject({ state: 'trial_expired', canSend: false });

    await prisma.organization.update({ where: { id: orgId }, data: { trialEndsAt: new Date(Date.now() + 86_400_000) } });
    const user = await prisma.user.findFirstOrThrow({ where: { orgId } });
    await prisma.envelope.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({ orgId, createdById: user.id, title: `Old ${i}`, jurisdiction: 'US', status: 'SENT' as const, sentAt: new Date() })),
    });
    const used = await c.call('POST', `/envelopes/${id}/send`);
    expect(used.statusCode).toBe(402);
    expect(used.json().error.code).toBe('plan_limit');
  });
});

describe('subscriptions (sandbox)', () => {
  it('buys Starter with GST, gates features and seats, then upgrades with proration', async () => {
    const { c } = await registerSender(app, 'IN');
    const orgId = await orgOf(c);

    // 2 users at ₹499 = ₹998 + 18% GST
    const q = await c.json('POST', '/billing/quote', { json: { plan: 'starter', seats: 2 } });
    expect(q).toMatchObject({ currency: 'INR', subtotal: 998_00, tax: 179_64, total: 1_177_64, taxLabel: 'GST 18%' });
    expect((await c.call('POST', '/billing/checkout', { json: { plan: 'enterprise', seats: 2 } })).statusCode).toBe(400);
    expect((await c.call('POST', '/billing/checkout', { json: { plan: 'starter', seats: 9 } })).statusCode).toBe(400);

    const page = await subscribe(c, 'starter', 2);
    expect(page).toContain('₹1,177.64');
    let billing = await c.json('GET', '/billing');
    expect(billing).toMatchObject({ plan: 'starter', state: 'active', seats: 2, usage: { envelopeLimit: 50, seatLimit: 2 } });
    expect(billing.invoices).toHaveLength(1);
    expect(billing.invoices[0]).toMatchObject({ total: 1_177_64, currency: 'INR' });
    expect(billing.invoices[0].number).toMatch(/^INV-\d{4}-\d{6}$/);

    const pdf = await c.call('GET', `/billing/invoices/${billing.invoices[0].id}/pdf`);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    // Invoices are private to the organisation
    const other = await registerSender(app);
    expect((await other.c.call('GET', `/billing/invoices/${billing.invoices[0].id}/pdf`)).statusCode).toBe(404);

    // Starter has no API or bulk send
    const key = await c.call('POST', '/api-keys', { json: { name: 'CI' } });
    expect(key.statusCode).toBe(402);
    expect(key.json().error.code).toBe('plan_feature');

    // Owner + one invitation fill both seats
    await c.json('POST', '/team/invitations', { json: { email: `a-${uid()}@acme.test` } });
    const full = await c.call('POST', '/team/invitations', { json: { email: `b-${uid()}@acme.test` } });
    expect(full.statusCode).toBe(402);
    expect(full.json().error.code).toBe('seat_limit');
    expect((await c.call('POST', '/billing/checkout', { json: { plan: 'business', seats: 1 } })).statusCode).toBe(400);

    // Upgrade mid-period: the prorated difference is invoiced now
    const DAY = 86_400_000;
    await prisma.organization.update({ where: { id: orgId }, data: { currentPeriodStart: new Date(Date.now() - 15 * DAY), currentPeriodEnd: new Date(Date.now() + 15 * DAY) } });
    const changed = await c.json('POST', '/billing/checkout', { json: { plan: 'business', seats: 3 } });
    expect(changed.changed).toBe(true);
    billing = await c.json('GET', '/billing');
    expect(billing).toMatchObject({ plan: 'business', seats: 3 });
    expect(billing.invoices).toHaveLength(2);
    // About half of (3 × ₹1,299 − 2 × ₹499) = ₹1,449.50, plus GST
    const prorated = billing.invoices[0].total;
    expect(prorated).toBeGreaterThan(1_449_50 * 1.18 * 0.95);
    expect(prorated).toBeLessThan(1_449_50 * 1.18 * 1.05);
    expect((await c.call('POST', '/api-keys', { json: { name: 'CI' } })).statusCode).toBe(201);
  });

  it('renews, cancels at period end and resumes', async () => {
    const { c } = await registerSender(app);
    const orgId = await orgOf(c);
    await subscribe(c, 'business', 1, 'year');
    const first = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    expect(first.billingCurrency).toBe('USD');

    // Renewal at period end issues the next invoice (no GST on USD)
    await prisma.organization.update({ where: { id: orgId }, data: { currentPeriodEnd: new Date(Date.now() - 1000) } });
    await renewSandboxSubscriptions();
    let billing = await c.json('GET', '/billing');
    expect(billing.invoices).toHaveLength(2);
    expect(billing.invoices[0].total).toBe(25_00 * 10);
    expect(new Date(billing.periodEnd).getTime()).toBeGreaterThan(Date.now() + 300 * 86_400_000);

    expect((await c.json('POST', '/billing/cancel')).cancelAtPeriodEnd).toBe(true);
    expect((await c.json('POST', '/billing/resume')).cancelAtPeriodEnd).toBe(false);
    await c.json('POST', '/billing/cancel');
    await prisma.organization.update({ where: { id: orgId }, data: { currentPeriodEnd: new Date(Date.now() - 1000) } });
    await renewSandboxSubscriptions();
    billing = await c.json('GET', '/billing');
    expect(billing).toMatchObject({ state: 'canceled', canSend: false });
    expect(billing.invoices).toHaveLength(2);
    const id = await draft(c);
    expect((await c.call('POST', `/envelopes/${id}/send`)).statusCode).toBe(402);
  });

  it('validates GSTINs for Indian organisations', async () => {
    const { c } = await registerSender(app, 'IN');
    expect((await c.call('PATCH', '/billing/details', { json: { taxId: '123' } })).statusCode).toBe(400);
    const ok = await c.json('PATCH', '/billing/details', { json: { billingName: 'Acme Lending Pvt Ltd', taxId: '27aapfu0939f1zv' } });
    expect(ok.taxId).toBe('27AAPFU0939F1ZV');
  });
});

describe('provider webhooks', () => {
  async function pendingCheckout(provider: string) {
    const { c } = await registerSender(app, 'IN');
    const orgId = await orgOf(c);
    const checkout = await prisma.billingCheckout.create({ data: { orgId, plan: 'business', interval: 'month', seats: 2, currency: 'INR', provider } });
    return { c, orgId, checkout };
  }

  it('activates and invoices from signed Stripe invoice.paid events only', async () => {
    const { c, orgId, checkout } = await pendingCheckout('stripe');
    const body = JSON.stringify({
      type: 'invoice.paid',
      data: {
        object: {
          id: `in_${uid()}`,
          amount_paid: 3_065_64,
          parent: { subscription_details: { subscription: `sub_${uid()}`, metadata: { checkoutId: checkout.id } } },
          lines: { data: [{ period: { start: 1_790_000_000, end: 1_792_592_000 } }] },
        },
      },
    });
    const ts = Math.floor(Date.now() / 1000);
    const sign = (secret: string) => `t=${ts},v1=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`;
    const send = (sig: string) =>
      app.inject({ method: 'POST', url: '/api/v1/billing/stripe/webhook', payload: body, headers: { 'content-type': 'application/json', 'stripe-signature': sig } });

    // The signing-payments secret is not valid for billing events
    expect((await send(sign('whsec_test_secret'))).statusCode).toBe(400);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).plan).toBe('trial');
    expect((await send(sign('whsec_billing_secret'))).statusCode).toBe(200);
    expect((await send(sign('whsec_billing_secret'))).statusCode).toBe(200); // retried delivery

    const billing = await c.json('GET', '/billing');
    expect(billing).toMatchObject({ plan: 'business', seats: 2, state: 'active', provider: 'stripe' });
    expect(billing.invoices).toHaveLength(1);
    // ₹3,065.64 paid = ₹2,598 + 18% GST
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: billing.invoices[0].id } });
    expect(inv).toMatchObject({ subtotal: 2_598_00, tax: 467_64, total: 3_065_64 });
  });

  it('handles signed Razorpay subscription events', async () => {
    const { c, checkout } = await pendingCheckout('razorpay');
    const subId = `sub_${uid()}`;
    const event = (name: string) =>
      JSON.stringify({
        event: name,
        payload: {
          subscription: { entity: { id: subId, notes: { checkoutId: checkout.id }, current_start: 1_790_000_000, current_end: 1_792_592_000 } },
          payment: { entity: { id: `pay_${uid()}`, amount: 3_065_64 } },
        },
      });
    const send = (body: string, secret = 'rzp_webhook_secret') =>
      app.inject({
        method: 'POST',
        url: '/api/v1/billing/razorpay/webhook',
        payload: body,
        headers: { 'content-type': 'application/json', 'x-razorpay-signature': createHmac('sha256', secret).update(body).digest('hex') },
      });

    expect((await send(event('subscription.charged'), 'wrong')).statusCode).toBe(400);
    expect((await send(event('subscription.charged'))).statusCode).toBe(200);
    expect(await c.json('GET', '/billing')).toMatchObject({ plan: 'business', state: 'active' });
    await send(event('subscription.halted'));
    expect(await c.json('GET', '/billing')).toMatchObject({ state: 'past_due', canSend: true });
    await send(event('subscription.cancelled'));
    expect(await c.json('GET', '/billing')).toMatchObject({ state: 'canceled', canSend: false });
  });
});
