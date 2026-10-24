import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { client, getApp, lastMail, makePdf, multipart, registerSender, signaturePng, uid, waitFor } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await getApp();
});

/** Sent envelope whose signer must pay ₹1,500 and sign; returns the verified signer session. */
async function setup() {
  const { c } = await registerSender(app);
  const email = `payer-${uid()}@example.test`;
  let env = await c.json('POST', '/envelopes', { json: { title: 'Membership' } });
  const { payload, headers } = multipart('m.pdf', await makePdf('Membership'));
  const doc = await c.json('POST', `/envelopes/${env.id}/documents`, { payload, headers });
  env = await c.json('PUT', `/envelopes/${env.id}/recipients`, { json: [{ name: 'Payer', email }] });
  const r = env.recipients[0].id;
  const missing = await c.call('PUT', `/envelopes/${env.id}/fields`, { json: [{ documentId: doc.id, recipientId: r, type: 'PAYMENT', page: 0, x: 0.1, y: 0.3, width: 0.3, height: 0.04 }] });
  expect(missing.statusCode).toBe(400);
  await c.json('PUT', `/envelopes/${env.id}/fields`, {
    json: [
      { documentId: doc.id, recipientId: r, type: 'SIGNATURE', page: 0, x: 0.1, y: 0.1, width: 0.3, height: 0.06 },
      { documentId: doc.id, recipientId: r, type: 'PAYMENT', label: 'Annual fee', amount: 150_000, currency: 'INR', page: 0, x: 0.1, y: 0.3, width: 0.35, height: 0.04 },
    ],
  });
  await c.json('POST', `/envelopes/${env.id}/send`);
  const link = lastMail(email, /Please sign/).text.match(/\/sign\/([\w.-]+)/)![1];
  const s = client(app);
  await s.json('POST', `/signing/${link}/otp/send`);
  await s.json('POST', `/signing/${link}/otp/verify`, { json: { code: lastMail(email, /\d{6}/).subject.match(/\d{6}/)![0] } });
  const session = await s.json('GET', `/signing/${link}`);
  const pay = session.fields.find((f: { type: string }) => f.type === 'PAYMENT');
  const sig = session.fields.find((f: { type: string }) => f.type === 'SIGNATURE');
  expect(pay).toMatchObject({ amount: 150_000, currency: 'INR' });
  return { c, s, link, env, pay, sig };
}

describe('payments at signing', () => {
  it('blocks finishing until paid, then records the payment in the PDF and audit trail', async () => {
    const { c, s, link, env, pay, sig } = await setup();
    const finish = () => s.call('POST', `/signing/${link}/complete`, { json: { consent: true, values: { [sig.id]: signaturePng(), [pay.id]: 'fake-paid' } } });
    expect((await finish()).statusCode).toBe(400);

    const { url, paymentId } = await s.json('POST', `/signing/${link}/payments/${pay.id}/checkout`);
    expect(url).toContain(`/api/v1/dev/pay/${paymentId}`);
    const page = await app.inject({ method: 'GET', url: `/api/v1/dev/pay/${paymentId}` });
    expect(page.body).toContain('₹1,500.00');
    const paid = await app.inject({ method: 'POST', url: `/api/v1/dev/pay/${paymentId}`, payload: 'outcome=pay', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(paid.statusCode).toBe(303);
    expect(paid.headers.location).toMatch(/payment=success/);
    // Paying twice is refused
    expect((await s.call('POST', `/signing/${link}/payments/${pay.id}/checkout`)).statusCode).toBe(409);

    expect((await finish()).statusCode).toBe(200);
    await waitFor(() => c.json('GET', `/envelopes/${env.id}`), (e) => e.status === 'COMPLETED');
    const audit = await c.json('GET', `/envelopes/${env.id}/audit`);
    const evt = audit.events.find((e: { type: string }) => e.type === 'payment.completed');
    expect(evt.data).toMatchObject({ amount: 150_000, currency: 'INR', provider: 'sandbox' });
  });

  it('accepts only correctly signed Stripe webhooks and Razorpay callbacks', async () => {
    const { s, link, pay } = await setup();
    const { paymentId } = await s.json('POST', `/signing/${link}/payments/${pay.id}/checkout`);

    // Stripe
    const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: { payment_status: 'paid', payment_intent: 'pi_123', metadata: { paymentId } } } });
    const ts = Math.floor(Date.now() / 1000);
    const good = `t=${ts},v1=${createHmac('sha256', 'whsec_test_secret').update(`${ts}.${body}`).digest('hex')}`;
    const forged = await app.inject({ method: 'POST', url: '/api/v1/payments/stripe/webhook', payload: body, headers: { 'content-type': 'application/json', 'stripe-signature': `t=${ts},v1=${'0'.repeat(64)}` } });
    expect(forged.statusCode).toBe(400);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('PENDING');
    const ok = await app.inject({ method: 'POST', url: '/api/v1/payments/stripe/webhook', payload: body, headers: { 'content-type': 'application/json', 'stripe-signature': good } });
    expect(ok.statusCode).toBe(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).receipt).toBe('pi_123');

    // Razorpay (a second payment on another envelope)
    const second = await setup();
    const { paymentId: p2 } = await second.s.json('POST', `/signing/${second.link}/payments/${second.pay.id}/checkout`);
    const q = { razorpay_payment_id: 'pay_9', razorpay_payment_link_id: 'plink_1', razorpay_payment_link_reference_id: p2, razorpay_payment_link_status: 'paid' };
    const sigHex = createHmac('sha256', 'rzp_test_secret').update([q.razorpay_payment_link_id, p2, 'paid', 'pay_9'].join('|')).digest('hex');
    const bad = await app.inject({ method: 'GET', url: `/api/v1/payments/razorpay/callback?${new URLSearchParams({ ...q, razorpay_signature: 'ab'.repeat(32) })}` });
    expect(bad.statusCode).toBe(400);
    const cb = await app.inject({ method: 'GET', url: `/api/v1/payments/razorpay/callback?${new URLSearchParams({ ...q, razorpay_signature: sigHex })}` });
    expect(cb.statusCode).toBe(303);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p2 } })).status).toBe('PAID');
  });
});
