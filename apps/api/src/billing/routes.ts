import formbody from '@fastify/formbody';
import type { Organization } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { logActivity } from '../lib/activity.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { verifyStripeSignature } from '../payments/providers.js';
import { renderInvoicePdf } from './invoice-pdf.js';
import {
  CURRENCIES,
  entitlement,
  envelopesUsed,
  FEATURE_NAMES,
  PLANS,
  seatsUsed,
  TRIAL,
  YEARLY_MONTHS,
} from './plans.js';
import { verifyRazorpayWebhook } from './providers.js';
import {
  assertBillable,
  cancel,
  checkout,
  completeSandboxCheckout,
  creditNoteNumber,
  currencyOf,
  invoiceNumber,
  quote,
  recordProviderCharge,
  resume,
  setSubscriptionStatus,
} from './service.js';

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Short billing state for every signed-in page (banners). */
export function billingBrief(org: Organization) {
  const ent = entitlement(org);
  return {
    plan: ent.plan.id,
    planName: ent.plan.name,
    state: ent.state,
    canSend: ent.canSend,
    blockedReason: ent.blockedReason,
    trialEndsAt: ent.plan.id === 'trial' ? org.trialEndsAt : null,
    cancelAtPeriodEnd: org.cancelAtPeriodEnd,
    periodEnd: ent.periodEnd,
    features: ent.features,
  };
}

const choice = z.object({
  plan: z.string(),
  interval: z.enum(['month', 'year']).default('month'),
  seats: z.coerce.number().int().min(1).max(10_000),
});

export async function billingRoutes(app: FastifyInstance) {
  await app.register(formbody);
  // Provider webhooks are verified against the exact raw body
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (/^\/api\/v1\/billing\/(stripe|razorpay)\/webhook/.test(req.url)) return done(null, body);
    try {
      done(null, (body as string).length ? JSON.parse(body as string) : {});
    } catch {
      done(Object.assign(new Error('Invalid JSON'), { statusCode: 400 }), undefined);
    }
  });

  /** Public: the pricing page and the in-app plan picker read this. */
  app.get('/billing/plans', async () => ({
    trial: { ...TRIAL },
    yearlyMonths: YEARLY_MONTHS,
    currencies: CURRENCIES,
    gstRate: config.billing.gstRate,
    plans: (['starter', 'business', 'enterprise'] as const).map((id) => {
      const p = PLANS[id];
      return { id, name: p.name, envelopesPerSeat: p.envelopesPerSeat, maxSeats: p.maxSeats, features: p.features.map((f) => FEATURE_NAMES[f]), price: p.price };
    }),
  }));

  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);
    r.addHook('preHandler', requireRole('OWNER', 'ADMIN'));

    r.get('/billing', async (req) => {
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.auth.orgId } });
      const ent = entitlement(org);
      const [used, seats, invoices, creditNotes] = await Promise.all([
        envelopesUsed(org.id, ent.periodStart),
        seatsUsed(org.id),
        prisma.invoice.findMany({ where: { orgId: org.id }, orderBy: { seq: 'desc' }, take: 100 }),
        prisma.creditNote.findMany({ where: { orgId: org.id }, orderBy: { seq: 'desc' }, take: 100 }),
      ]);
      return {
        ...billingBrief(org),
        provider: org.billingProvider ?? config.billing.provider,
        managed: org.billingProvider === 'manual',
        currency: currencyOf(org),
        interval: org.billingInterval,
        seats: org.seats,
        periodStart: ent.periodStart,
        usage: { envelopes: used, envelopeLimit: ent.envelopeLimit, seats, seatLimit: ent.seatLimit },
        details: { billingName: org.billingName, billingEmail: org.billingEmail, billingAddress: org.billingAddress, taxId: org.taxId },
        invoices: invoices.map((i) => ({
          id: i.id,
          number: invoiceNumber(i),
          description: i.description,
          currency: i.currency,
          total: i.total,
          paidAt: i.paidAt,
          periodStart: i.periodStart,
          periodEnd: i.periodEnd,
        })),
        creditNotes: creditNotes.map((c) => ({
          id: c.id,
          number: creditNoteNumber(c),
          kind: c.kind,
          amount: c.amount,
          currency: c.currency,
          reason: c.reason,
          invoice: invoices.find((i) => i.id === c.invoiceId) ? invoiceNumber(invoices.find((i) => i.id === c.invoiceId)!) : null,
          createdAt: c.createdAt,
        })),
      };
    });

    r.post('/billing/quote', async (req) => {
      const body = parse(choice, req.body);
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.auth.orgId } });
      if (!(body.plan in PLANS) || !PLANS[body.plan as keyof typeof PLANS].price) throw badRequest('Choose Starter or Business.');
      return quote(org, body.plan as 'starter' | 'business', body.interval, body.seats);
    });

    r.post('/billing/checkout', async (req) => {
      const body = parse(choice, req.body);
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.auth.orgId } });
      assertBillable(org);
      const user = req.auth.userId ? await prisma.user.findUnique({ where: { id: req.auth.userId } }) : null;
      const result = await checkout(org.id, user?.email ?? '', body);
      if (result.changed) await logActivity(req, 'billing.plan_changed', { plan: body.plan, seats: body.seats, interval: body.interval });
      return result.changed ? { changed: true, invoiceId: result.invoice?.id ?? null } : { url: result.url };
    });

    r.post('/billing/cancel', async (req) => {
      assertBillable(await prisma.organization.findUniqueOrThrow({ where: { id: req.auth.orgId } }));
      const org = await cancel(req.auth.orgId);
      await logActivity(req, 'billing.canceled', { endsAt: org.currentPeriodEnd });
      return billingBrief(org);
    });

    r.post('/billing/resume', async (req) => {
      const org = await resume(req.auth.orgId);
      await logActivity(req, 'billing.resumed');
      return billingBrief(org);
    });

    r.patch('/billing/details', async (req) => {
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.auth.orgId } });
      const body = parse(
        z.object({
          billingName: z.string().trim().max(200).nullable().optional(),
          billingEmail: z.string().trim().toLowerCase().email().nullable().optional().or(z.literal('').transform(() => null)),
          billingAddress: z.string().trim().max(500).nullable().optional(),
          taxId: z
            .string()
            .trim()
            .toUpperCase()
            .max(30)
            .nullable()
            .optional()
            .transform((v) => v || null)
            .refine((v) => !v || org.jurisdiction !== 'IN' || GSTIN.test(v), 'Enter a valid 15-character GSTIN'),
        }),
        req.body,
      );
      const updated = await prisma.organization.update({ where: { id: org.id }, data: body });
      await logActivity(req, 'billing.details_updated');
      return { billingName: updated.billingName, billingEmail: updated.billingEmail, billingAddress: updated.billingAddress, taxId: updated.taxId };
    });

    r.get('/billing/invoices/:id/pdf', async (req, reply) => {
      const { id } = req.params as { id: string };
      const inv = await prisma.invoice.findFirst({ where: { id, orgId: req.auth.orgId } });
      if (!inv) throw notFound('Invoice');
      reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `attachment; filename="${invoiceNumber(inv)}.pdf"`);
      return Buffer.from(await renderInvoicePdf(inv));
    });
  });

  // --- Provider webhooks ------------------------------------------------------

  app.post('/billing/stripe/webhook', async (req, reply) => {
    const raw = req.body as string;
    if (!verifyStripeSignature(raw, req.headers['stripe-signature'] as string | undefined, config.billing.stripeWebhookSecret)) {
      return reply.code(400).send({ error: 'bad signature' });
    }
    type Meta = { checkoutId?: string };
    const event = JSON.parse(raw) as { type: string; data: { object: Record<string, unknown> } };
    const o = event.data.object;
    if (event.type === 'invoice.paid') {
      // Subscription id and metadata moved under `parent` in newer API versions
      const parent = (o.parent as { subscription_details?: { subscription?: string; metadata?: Meta } } | undefined)?.subscription_details;
      const subscription = (o.subscription as string | undefined) ?? parent?.subscription;
      const meta = (o.subscription_details as { metadata?: Meta } | undefined)?.metadata ?? parent?.metadata;
      const period = (o.lines as { data?: { period?: { start: number; end: number } }[] } | undefined)?.data?.[0]?.period;
      if (subscription) {
        await recordProviderCharge(subscription, {
          providerRef: o.id as string,
          total: o.amount_paid as number,
          checkoutId: meta?.checkoutId,
          ...(period ? { periodStart: new Date(period.start * 1000), periodEnd: new Date(period.end * 1000) } : {}),
        });
      }
    } else if (event.type === 'invoice.payment_failed') {
      const sub = (o.subscription as string | undefined) ?? (o.parent as { subscription_details?: { subscription?: string } } | undefined)?.subscription_details?.subscription;
      if (sub) await setSubscriptionStatus(sub, 'PAST_DUE');
    } else if (event.type === 'customer.subscription.updated') {
      await setSubscriptionStatus(o.id as string, o.status === 'past_due' || o.status === 'unpaid' ? 'PAST_DUE' : 'ACTIVE', Boolean(o.cancel_at_period_end));
    } else if (event.type === 'customer.subscription.deleted') {
      await setSubscriptionStatus(o.id as string, 'CANCELED');
    }
    return { received: true };
  });

  app.post('/billing/razorpay/webhook', async (req, reply) => {
    const raw = req.body as string;
    if (!verifyRazorpayWebhook(raw, req.headers['x-razorpay-signature'] as string | undefined)) return reply.code(400).send({ error: 'bad signature' });
    const event = JSON.parse(raw) as {
      event: string;
      payload: {
        subscription?: { entity: { id: string; notes?: { checkoutId?: string }; current_start?: number; current_end?: number } };
        payment?: { entity: { id: string; amount: number } };
      };
    };
    const sub = event.payload.subscription?.entity;
    if (!sub) return { received: true };
    if (event.event === 'subscription.charged' && event.payload.payment) {
      await recordProviderCharge(sub.id, {
        providerRef: event.payload.payment.entity.id,
        total: event.payload.payment.entity.amount,
        checkoutId: sub.notes?.checkoutId,
        ...(sub.current_start && sub.current_end ? { periodStart: new Date(sub.current_start * 1000), periodEnd: new Date(sub.current_end * 1000) } : {}),
      });
    } else if (event.event === 'subscription.pending' || event.event === 'subscription.halted') {
      await setSubscriptionStatus(sub.id, 'PAST_DUE');
    } else if (event.event === 'subscription.cancelled' || event.event === 'subscription.completed') {
      await setSubscriptionStatus(sub.id, 'CANCELED');
    }
    return { received: true };
  });

  // --- Sandbox checkout (development and tests only) ---------------------------
  if (config.billing.provider !== 'sandbox') return;

  const back = (outcome: string) => `${config.appUrl}/settings?tab=billing&checkout=${outcome}`;

  app.get('/dev/billing/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = await prisma.billingCheckout.findUnique({ where: { id }, include: { org: true } });
    if (!c) throw notFound('Checkout');
    const q = quote(c.org, c.plan as 'starter' | 'business', c.interval as 'month' | 'year', c.seats);
    const fmt = (n: number) => new Intl.NumberFormat('en', { style: 'currency', currency: q.currency }).format(n / 100);
    reply.type('text/html');
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Test checkout</title></head>
<body style="font-family:system-ui,sans-serif;background:#f6f7fb;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
<main style="background:#fff;border-radius:16px;padding:28px;max-width:380px;width:100%;box-shadow:0 1px 3px #0001">
<p style="background:#fef3c7;color:#92400e;border-radius:8px;padding:8px 10px;font-size:13px">SANDBOX checkout: no money moves.</p>
<p style="color:#6b7280;font-size:14px;margin:12px 0 0">${PLANS[q.plan].name} plan &middot; ${q.seats} user${q.seats === 1 ? '' : 's'} &middot; ${q.interval === 'year' ? 'yearly' : 'monthly'}</p>
<h1 style="font-size:28px;margin:6px 0">${fmt(q.total)}<span style="font-size:14px;color:#6b7280;font-weight:400"> / ${q.interval}</span></h1>
${q.tax ? `<p style="color:#6b7280;font-size:13px;margin:0">${fmt(q.subtotal)} + ${q.taxLabel} ${fmt(q.tax)}</p>` : ''}
<form method="POST" action="${config.appUrl}/api/v1/dev/billing/${id}" style="margin-top:18px"><button name="outcome" value="pay" style="width:100%;padding:12px;border:0;border-radius:8px;background:#9a6f08;color:#fff;font-weight:600;font-size:15px">Subscribe (test)</button>
<button name="outcome" value="cancel" style="width:100%;margin-top:8px;padding:10px;border:1px solid #d1d5db;border-radius:8px;background:#fff">Cancel</button></form></main></body></html>`;
  });

  app.post('/dev/billing/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { outcome } = (req.body ?? {}) as { outcome?: string };
    if (outcome === 'pay') {
      if (!(await completeSandboxCheckout(id))) throw notFound('Checkout');
      return reply.redirect(back('success'), 303);
    }
    await prisma.billingCheckout.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'CANCELED' } });
    return reply.redirect(back('cancelled'), 303);
  });
}
