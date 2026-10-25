import formbody from '@fastify/formbody';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { appendAudit } from '../audit/audit.js';
import { verifyRazorpayWebhook } from '../billing/providers.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { signingToken } from '../lib/auth.js';
import { conflict, HttpError, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { IFSC_PATTERN, maskAccount } from '../kyc/providers.js';
import { formatAmount } from '../payments/providers.js';
import { mandateConfig } from './mandate-config.js';
import { actorOf, loadByToken, requireReady, requireSession } from '../signing/routes.js';

/**
 * eNACH e-mandates (NPCI): a signer authorises recurring debits from their bank
 * account as part of signing, e.g. loan EMIs or subscriptions.
 *
 *  - sandbox: a built-in bank approval page that issues a test UMRN.
 *  - razorpay: Razorpay registration links (method "emandate"), confirmed by
 *    webhook. Follows Razorpay's published API; untested without credentials.
 */


const FREQ_TEXT: Record<string, string> = { MONTHLY: 'monthly', QUARTERLY: 'quarterly', HALF_YEARLY: 'half-yearly', YEARLY: 'yearly', AS_PRESENTED: 'as presented' };
const day = (d: Date) => d.toISOString().slice(0, 10);

/** "eNACH UMRN … · up to ₹5,000.00 monthly until 2027-10-25" for each active mandate. */
export async function mandateLabels(envelopeId: string): Promise<[string, string][]> {
  const rows = await prisma.mandate.findMany({ where: { envelopeId, status: 'ACTIVE' } });
  return rows.map((m) => [m.id, `eNACH ${m.umrn ?? m.id} · up to ${formatAmount(m.maxAmount, m.currency)} ${FREQ_TEXT[m.frequency] ?? m.frequency} until ${day(m.endsOn)}`]);
}

/** Marks a mandate registered (idempotent), fills the field and records it in the audit trail. */
export async function activateMandate(mandateId: string, details: { umrn: string; bankName?: string | null }) {
  const claimed = await prisma.mandate.updateMany({
    where: { id: mandateId, status: { not: 'ACTIVE' } },
    data: { status: 'ACTIVE', umrn: details.umrn, bankName: details.bankName ?? undefined, confirmedAt: new Date() },
  });
  const m = await prisma.mandate.findUnique({ where: { id: mandateId } });
  if (!m || claimed.count === 0) return m;
  const r = await prisma.recipient.findUniqueOrThrow({ where: { id: m.recipientId } });
  await prisma.$transaction(async (tx) => {
    await tx.field.update({ where: { id: m.fieldId }, data: { value: m.id } });
    await appendAudit(tx, {
      envelopeId: m.envelopeId,
      type: 'mandate.registered',
      actor: actorOf(r),
      data: { mandateId: m.id, provider: m.provider, umrn: details.umrn, maxAmount: m.maxAmount, currency: m.currency, frequency: m.frequency, endsOn: day(m.endsOn), account: m.account },
    });
  });
  return m;
}

async function razorpayAuthLink(m: { id: string; maxAmount: number; endsOn: Date; frequency: string }, r: { name: string; email: string; phone: string | null }, bank: { account: string; ifsc: string; holder: string }, title: string) {
  const { keyId, keySecret } = config.payments.razorpay;
  if (!keyId || !keySecret) throw new HttpError(503, 'eNACH is not configured.', 'enach_unavailable');
  const res = await fetch('https://api.razorpay.com/v1/subscription_registration/auth_links', {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer: { name: r.name, email: r.email, ...(r.phone ? { contact: r.phone } : {}) },
      type: 'link',
      amount: 0,
      currency: 'INR',
      description: `eNACH mandate for ${title}`.slice(0, 255),
      subscription_registration: {
        method: 'emandate',
        auth_type: 'netbanking',
        max_amount: m.maxAmount,
        expire_at: Math.floor(m.endsOn.getTime() / 1000),
        bank_account: { beneficiary_name: bank.holder, account_number: bank.account, account_type: 'savings', ifsc_code: bank.ifsc },
      },
      receipt: m.id,
      email_notify: false,
      sms_notify: false,
      expire_by: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
      notes: { mandateId: m.id },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new HttpError(502, 'Could not start the eNACH registration.', 'enach_error');
  const link = (await res.json()) as { id: string; short_url: string };
  return { url: link.short_url, providerRef: link.id };
}

export async function enachRoutes(app: FastifyInstance) {
  await app.register(formbody);
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (req.url.startsWith('/api/v1/enach/razorpay/webhook')) return done(null, body);
    try {
      done(null, (body as string).length ? JSON.parse(body as string) : {});
    } catch {
      done(Object.assign(new Error('Invalid JSON'), { statusCode: 400 }), undefined);
    }
  });

  /** Starts the mandate registration for a MANDATE field with the signer's bank account. */
  app.post('/signing/:token/mandates/:fieldId/start', async (req) => {
    const { token, fieldId } = req.params as { token: string; fieldId: string };
    const body = parse(
      z.object({
        accountNumber: z.string().trim().regex(/^\d{9,18}$/, 'Enter the account number (9 to 18 digits)'),
        ifsc: z.string().trim().toUpperCase().regex(IFSC_PATTERN, 'Enter an 11-character IFSC like HDFC0001234'),
        accountHolder: z.string().trim().min(1).max(120),
      }),
      req.body,
    );
    const r = await loadByToken(token);
    requireReady(r);
    requireSession(req, r);
    const field = await prisma.field.findFirst({ where: { id: fieldId, recipientId: r.id, type: 'MANDATE' } });
    if (!field || !field.amount) throw notFound('Mandate field');
    if (await prisma.mandate.findFirst({ where: { fieldId, status: 'ACTIVE' } })) throw conflict('This mandate is already registered.');
    const cfg = mandateConfig.parse(field.config ?? {});
    const startsOn = new Date();
    const endsOn = new Date(startsOn);
    endsOn.setUTCMonth(endsOn.getUTCMonth() + cfg.months);

    const m = await prisma.mandate.create({
      data: {
        envelopeId: r.envelopeId,
        recipientId: r.id,
        fieldId,
        provider: config.enach.provider,
        maxAmount: field.amount,
        currency: 'INR',
        frequency: cfg.frequency,
        startsOn,
        endsOn,
        account: maskAccount(body.accountNumber),
        bankName: body.ifsc.slice(0, 4),
      },
    });
    const started =
      config.enach.provider === 'razorpay'
        ? await razorpayAuthLink(m, r, { account: body.accountNumber, ifsc: body.ifsc, holder: body.accountHolder }, r.envelope.title)
        : { url: `${config.appUrl}/api/v1/dev/enach/${m.id}`, providerRef: `sbx_${m.id}` };
    await prisma.mandate.update({ where: { id: m.id }, data: { providerRef: started.providerRef } });
    return { url: started.url, mandateId: m.id };
  });

  app.post('/enach/razorpay/webhook', async (req, reply) => {
    const raw = req.body as string;
    if (!verifyRazorpayWebhook(raw, req.headers['x-razorpay-signature'] as string | undefined)) return reply.code(400).send({ error: 'bad signature' });
    const event = JSON.parse(raw) as {
      event: string;
      payload: { invoice?: { entity: { receipt?: string; notes?: { mandateId?: string } } }; payment?: { entity: { token_id?: string; bank?: string } } };
    };
    if (event.event === 'invoice.paid') {
      const inv = event.payload.invoice?.entity;
      const mandateId = inv?.notes?.mandateId ?? inv?.receipt;
      // Razorpay identifies the registered mandate by its token; the UMRN is shown in the dashboard
      if (mandateId) await activateMandate(mandateId, { umrn: event.payload.payment?.entity.token_id ?? 'razorpay', bankName: event.payload.payment?.entity.bank ?? null });
    }
    return { received: true };
  });

  // --- Sandbox bank approval (development and tests only) ----------------------
  if (config.enach.provider !== 'sandbox') return;

  const back = async (mandateId: string, outcome: string) => {
    const m = await prisma.mandate.findUniqueOrThrow({ where: { id: mandateId } });
    const r = await prisma.recipient.findUniqueOrThrow({ where: { id: m.recipientId } });
    return `${config.appUrl}/sign/${signingToken(r)}?mandate=${outcome}`;
  };

  app.get('/dev/enach/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const m = await prisma.mandate.findUnique({ where: { id } });
    if (!m) throw notFound('Mandate');
    reply.type('text/html');
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>eNACH (sandbox)</title></head>
<body style="font-family:system-ui,sans-serif;background:#f6f7fb;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
<main style="background:#fff;border-radius:16px;padding:28px;max-width:380px;width:100%;box-shadow:0 1px 3px #0001">
<p style="background:#fef3c7;color:#92400e;border-radius:8px;padding:8px 10px;font-size:13px">SANDBOX bank: no mandate is registered with NPCI.</p>
<h1 style="font-size:20px;margin:12px 0 4px">Approve eNACH mandate</h1>
<p style="color:#6b7280;font-size:14px;margin:0">${m.bankName ?? ''} account ${m.account ?? ''}</p>
<dl style="font-size:14px;display:grid;grid-template-columns:auto 1fr;gap:6px 12px;margin:16px 0">
<dt style="color:#6b7280">Maximum debit</dt><dd style="margin:0;font-weight:600">${formatAmount(m.maxAmount, m.currency)}</dd>
<dt style="color:#6b7280">Frequency</dt><dd style="margin:0">${FREQ_TEXT[m.frequency] ?? m.frequency}</dd>
<dt style="color:#6b7280">Valid until</dt><dd style="margin:0">${day(m.endsOn)}</dd></dl>
<form method="POST" action="${config.appUrl}/api/v1/dev/enach/${id}"><button name="outcome" value="approve" style="width:100%;padding:12px;border:0;border-radius:8px;background:#4f46e5;color:#fff;font-weight:600;font-size:15px">Approve (test)</button>
<button name="outcome" value="reject" style="width:100%;margin-top:8px;padding:10px;border:1px solid #d1d5db;border-radius:8px;background:#fff">Reject</button></form></main></body></html>`;
  });

  app.post('/dev/enach/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { outcome } = (req.body ?? {}) as { outcome?: string };
    if (!(await prisma.mandate.findUnique({ where: { id } }))) throw notFound('Mandate');
    if (outcome === 'approve') {
      // UMRN: 20 characters, bank code prefix + digits (test value)
      const umrn = `SBXN${String(Date.now()).slice(-10)}${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
      await activateMandate(id, { umrn });
      return reply.redirect(await back(id, 'registered'), 303);
    }
    await prisma.mandate.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'FAILED' } });
    return reply.redirect(await back(id, 'rejected'), 303);
  });

}
