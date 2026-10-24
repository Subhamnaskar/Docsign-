import formbody from '@fastify/formbody';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { appendAudit } from '../audit/audit.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { signingToken } from '../lib/auth.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { loadByToken, requireReady, requireSession } from '../signing/routes.js';
import { formatAmount, startCheckout, verifyRazorpayCallback, verifyStripeSignature } from './providers.js';

/** Marks a payment paid (idempotent) and records it in the audit trail. */
export async function markPaid(paymentId: string, receipt: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) return null;
  const claimed = await prisma.payment.updateMany({ where: { id: paymentId, status: { not: 'PAID' } }, data: { status: 'PAID', paidAt: new Date(), receipt } });
  if (claimed.count === 0) return payment;
  const r = await prisma.recipient.findUniqueOrThrow({ where: { id: payment.recipientId } });
  await prisma.$transaction(async (tx) => {
    await tx.field.update({ where: { id: payment.fieldId }, data: { value: payment.id } });
    await appendAudit(tx, {
      envelopeId: payment.envelopeId,
      type: 'payment.completed',
      actor: { kind: 'recipient', id: r.id, name: r.name, email: r.email },
      data: { paymentId: payment.id, provider: payment.provider, amount: payment.amount, currency: payment.currency, receipt },
    });
  });
  return payment;
}

const signPage = async (recipientId: string) => {
  const r = await prisma.recipient.findUniqueOrThrow({ where: { id: recipientId } });
  return `${config.appUrl}/sign/${signingToken(r)}`;
};

export async function paymentRoutes(app: FastifyInstance) {
  await app.register(formbody);
  // Stripe webhooks are verified against the exact raw body
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (req.url.startsWith('/api/v1/payments/stripe/webhook')) return done(null, body);
    try {
      done(null, (body as string).length ? JSON.parse(body as string) : {});
    } catch {
      done(Object.assign(new Error('Invalid JSON'), { statusCode: 400 }), undefined);
    }
  });

  /** Starts (or resumes) the checkout for a PAYMENT field. */
  app.post('/signing/:token/payments/:fieldId/checkout', async (req) => {
    const { token, fieldId } = req.params as { token: string; fieldId: string };
    const r = await loadByToken(token);
    requireReady(r);
    requireSession(req, r);
    const field = await prisma.field.findFirst({ where: { id: fieldId, recipientId: r.id, type: 'PAYMENT' } });
    if (!field || !field.amount || !field.currency) throw notFound('Payment field');
    if (await prisma.payment.findFirst({ where: { fieldId, status: 'PAID' } })) throw conflict('This has already been paid.');

    const payment = await prisma.payment.create({
      data: { envelopeId: r.envelopeId, recipientId: r.id, fieldId, provider: config.payments.provider, amount: field.amount, currency: field.currency },
    });
    const checkout = await startCheckout({
      paymentId: payment.id,
      amount: field.amount,
      currency: field.currency,
      description: field.label || r.envelope.title,
      customerEmail: r.email,
      customerName: r.name,
      returnUrl: `${config.appUrl}/sign/${token}`,
    });
    await prisma.payment.update({ where: { id: payment.id }, data: { providerRef: checkout.providerRef } });
    return { url: checkout.url, paymentId: payment.id };
  });

  app.post('/payments/stripe/webhook', async (req, reply) => {
    const raw = req.body as string;
    if (!verifyStripeSignature(raw, req.headers['stripe-signature'] as string | undefined)) return reply.code(400).send({ error: 'bad signature' });
    const event = JSON.parse(raw) as { type: string; data: { object: { metadata?: { paymentId?: string }; payment_intent?: string; payment_status?: string } } };
    const session = event.data.object;
    if (event.type === 'checkout.session.completed' && session.payment_status === 'paid' && session.metadata?.paymentId) {
      await markPaid(session.metadata.paymentId, session.payment_intent ?? 'stripe');
    }
    return { received: true };
  });

  app.get('/payments/razorpay/callback', async (req, reply: FastifyReply) => {
    const q = req.query as Record<string, string | undefined>;
    if (!verifyRazorpayCallback(q)) throw badRequest('Payment confirmation could not be verified.');
    const payment = await prisma.payment.findUnique({ where: { id: q.razorpay_payment_link_reference_id ?? '' } });
    if (!payment) throw notFound('Payment');
    if (q.razorpay_payment_link_status === 'paid') await markPaid(payment.id, q.razorpay_payment_id ?? 'razorpay');
    return reply.redirect(`${await signPage(payment.recipientId)}?payment=${q.razorpay_payment_link_status === 'paid' ? 'success' : 'cancelled'}`, 303);
  });

  // --- Sandbox checkout (development and tests only) -------------------------
  if (config.payments.provider !== 'sandbox') return;

  app.get('/dev/pay/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const payment = await prisma.payment.findUnique({ where: { id } });
    if (!payment) throw notFound('Payment');
    reply.type('text/html');
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Test checkout</title></head>
<body style="font-family:system-ui,sans-serif;background:#f6f7fb;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
<main style="background:#fff;border-radius:16px;padding:28px;max-width:360px;width:100%;box-shadow:0 1px 3px #0001">
<p style="background:#fef3c7;color:#92400e;border-radius:8px;padding:8px 10px;font-size:13px">SANDBOX checkout: no money moves.</p>
<h1 style="font-size:28px;margin:12px 0">${formatAmount(payment.amount, payment.currency)}</h1>
<form method="POST" action="${config.appUrl}/api/v1/dev/pay/${id}"><button name="outcome" value="pay" style="width:100%;padding:12px;border:0;border-radius:8px;background:#4f46e5;color:#fff;font-weight:600;font-size:15px">Pay (test)</button>
<button name="outcome" value="cancel" style="width:100%;margin-top:8px;padding:10px;border:1px solid #d1d5db;border-radius:8px;background:#fff">Cancel</button></form></main></body></html>`;
  });

  app.post('/dev/pay/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { outcome } = (req.body ?? {}) as { outcome?: string };
    const payment = await prisma.payment.findUnique({ where: { id } });
    if (!payment) throw notFound('Payment');
    if (outcome === 'pay') await markPaid(id, `sbx_receipt_${id.slice(-8)}`);
    return reply.redirect(`${await signPage(payment.recipientId)}?payment=${outcome === 'pay' ? 'success' : 'cancelled'}`, 303);
  });
}
