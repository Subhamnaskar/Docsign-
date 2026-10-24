import type { Recipient } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { appendAudit, type Actor } from '../audit/audit.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { clientInfo, parseSigningToken, signingTokenMatches } from '../lib/auth.js';
import { numericCode, randomToken, safeEqualHex, sha256Hex } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, HttpError, notFound, unauthorized } from '../lib/errors.js';
import { normalizeSignaturePng } from '../lib/image.js';
import { t } from '../i18n/messages.js';
import { getBranding } from '../organization/branding.js';
import { layout, sendMail } from '../lib/mailer.js';
import { getObject } from '../lib/storage.js';
import { parse } from '../lib/validate.js';
import { resolvePolicy, type ResolvedPolicy } from '../policy/engine.js';
import { advanceEnvelope, notifySender, notifySigners } from '../envelopes/service.js';
import { enqueueWebhook } from '../webhooks/dispatcher.js';

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_MS = 30 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const SESSION_TTL_MS = 2 * 3600 * 1000;
const MAX_SIGNATURE_BYTES = 400 * 1024;

const cookieName = (recipientId: string) => `ds_signer_${recipientId}`;

async function loadByToken(token: string) {
  const parsed = parseSigningToken(token);
  if (!parsed) throw notFound('Signing request');
  const recipient = await prisma.recipient.findUnique({
    where: { id: parsed.id },
    include: {
      envelope: {
        include: {
          documents: { orderBy: { order: 'asc' } },
          createdBy: { select: { name: true, email: true } },
          org: { select: { name: true } },
        },
      },
    },
  });
  if (!recipient || recipient.role === 'CC' || !signingTokenMatches(recipient, parsed.mac)) throw notFound('Signing request');
  return recipient;
}

type LoadedRecipient = Awaited<ReturnType<typeof loadByToken>>;

function hasSession(req: FastifyRequest, r: Recipient): boolean {
  const value = req.cookies[cookieName(r.id)];
  if (!value || !r.signerSessionHash || !r.verifiedAt) return false;
  if (Date.now() - r.verifiedAt.getTime() > SESSION_TTL_MS) return false;
  return safeEqualHex(sha256Hex(value), r.signerSessionHash);
}

function requireSession(req: FastifyRequest, r: Recipient) {
  if (!hasSession(req, r)) throw unauthorized('Verify your identity to continue.');
}

/** Where this signer stands in the workflow. */
function signerState(r: LoadedRecipient) {
  const env = r.envelope;
  if (env.status === 'VOIDED') return 'voided';
  if (env.status === 'EXPIRED') return 'expired';
  if (env.status === 'DECLINED') return 'declined';
  if (r.status === 'SIGNED') return 'signed';
  if (r.status === 'DECLINED') return 'declined';
  if (env.status === 'COMPLETED') return 'completed';
  if (env.status !== 'SENT') return 'unavailable';
  if (r.status === 'CREATED') return 'waiting';
  return 'ready';
}

function requireReady(r: LoadedRecipient) {
  const state = signerState(r);
  if (state !== 'ready') throw conflict(`This signing request is ${state}.`);
}

const actorOf = (r: Recipient): Actor => ({ kind: 'recipient', id: r.id, name: r.name, email: r.email });

const maskEmail = (email: string) => email.replace(/^(.{1,2})[^@]*(@.*)$/, (_, a, b) => `${a}***${b}`);

export async function signingRoutes(app: FastifyInstance) {
  app.get('/signing/:token', async (req) => {
    const { token } = req.params as { token: string };
    let r = await loadByToken(token);
    const state = signerState(r);

    if (state === 'ready' && r.status === 'SENT') {
      await prisma.$transaction(async (tx) => {
        await tx.recipient.update({ where: { id: r.id }, data: { status: 'VIEWED', viewedAt: new Date() } });
        await appendAudit(tx, { envelopeId: r.envelopeId, type: 'recipient.viewed', actor: actorOf(r), ...clientInfo(req) });
        await enqueueWebhook(tx, r.envelope.orgId, 'recipient.viewed', { envelopeId: r.envelopeId, recipientId: r.id });
      });
      r = await loadByToken(token);
    }

    const verified = hasSession(req, r);
    const env = r.envelope;
    const policy = (env.policy as unknown as ResolvedPolicy | null) ?? resolvePolicy(env.jurisdiction, env.documentType);
    const fields = verified
      ? await prisma.field.findMany({ where: { recipientId: r.id }, orderBy: [{ page: 'asc' }, { y: 'asc' }, { x: 'asc' }] })
      : [];

    return {
      state,
      verified,
      envelope: {
        id: env.id,
        title: env.title,
        message: env.message,
        sender: env.createdBy,
        organization: env.org.name,
        expiresAt: env.expiresAt,
      },
      recipient: {
        id: r.id,
        name: r.name,
        email: r.email,
        maskedEmail: maskEmail(r.email),
        status: r.status,
        locale: r.locale,
        role: r.role,
        canReassign: !r.embedded && !r.hostUserId,
      },
      branding: await getBranding(env.orgId),
      compliance: {
        jurisdiction: policy.jurisdictionName,
        laws: policy.laws,
        signatureLevel: policy.signatureLevel,
        consentText: policy.consentText,
      },
      documents: verified
        ? env.documents.map((d) => ({ id: d.id, name: d.name, pageCount: d.pageCount, pages: d.pages }))
        : [],
      fields: fields.map((f) => ({
        id: f.id,
        documentId: f.documentId,
        type: f.type,
        page: f.page,
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
        required: f.required,
        label: f.label,
        value: f.value,
      })),
    };
  });

  app.post(
    '/signing/:token/otp/send',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req) => {
      const { token } = req.params as { token: string };
      const r = await loadByToken(token);
      requireReady(r);
      if (r.otpExpiresAt && r.otpExpiresAt.getTime() - OTP_TTL_MS > Date.now() - OTP_RESEND_MS) {
        throw new HttpError(429, 'Please wait a few seconds before requesting another code.', 'rate_limited');
      }
      const code = numericCode(6);
      await prisma.$transaction(async (tx) => {
        await tx.recipient.update({
          where: { id: r.id },
          data: { otpHash: sha256Hex(`${r.id}:${code}`), otpExpiresAt: new Date(Date.now() + OTP_TTL_MS), otpAttempts: 0 },
        });
        await appendAudit(tx, {
          envelopeId: r.envelopeId,
          type: 'recipient.otp_sent',
          actor: actorOf(r),
          data: { channel: 'email' },
          ...clientInfo(req),
        });
      });
      const { html, text } = layout({
        locale: r.locale,
        brand: await getBranding(r.envelope.orgId),
        heading: t(r.locale, 'otpHeading'),
        paragraphs: [t(r.locale, 'otpIntro', { title: r.envelope.title }), code, t(r.locale, 'otpExpiry')],
      });
      await sendMail({ to: r.email, subject: t(r.locale, 'otpSubject', { code }), html, text });
      return { sentTo: maskEmail(r.email), expiresInSeconds: OTP_TTL_MS / 1000 };
    },
  );

  app.post(
    '/signing/:token/otp/verify',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (req, reply: FastifyReply) => {
      const { token } = req.params as { token: string };
      const { code } = parse(z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') }), req.body);
      const r = await loadByToken(token);
      requireReady(r);
      if (!r.otpHash || !r.otpExpiresAt || r.otpExpiresAt < new Date()) {
        throw badRequest('The code has expired. Request a new one.');
      }
      if (r.otpAttempts >= OTP_MAX_ATTEMPTS) throw forbidden('Too many incorrect attempts. Request a new code.');

      if (!safeEqualHex(sha256Hex(`${r.id}:${code}`), r.otpHash)) {
        await prisma.$transaction(async (tx) => {
          await tx.recipient.update({ where: { id: r.id }, data: { otpAttempts: { increment: 1 } } });
          await appendAudit(tx, { envelopeId: r.envelopeId, type: 'recipient.otp_failed', actor: actorOf(r), ...clientInfo(req) });
        });
        throw badRequest('That code is incorrect.');
      }

      const session = randomToken();
      await prisma.$transaction(async (tx) => {
        await tx.recipient.update({
          where: { id: r.id },
          data: { otpHash: null, otpExpiresAt: null, otpAttempts: 0, verifiedAt: new Date(), signerSessionHash: sha256Hex(session) },
        });
        await appendAudit(tx, {
          envelopeId: r.envelopeId,
          type: 'recipient.verified',
          actor: actorOf(r),
          data: { method: 'email-otp', assurance: 'LOW' },
          ...clientInfo(req),
        });
      });
      reply.setCookie(cookieName(r.id), session, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: config.isProduction,
        maxAge: SESSION_TTL_MS / 1000,
      });
      return { verified: true };
    },
  );

  app.get('/signing/:token/documents/:docId/file', async (req, reply) => {
    const { token, docId } = req.params as { token: string; docId: string };
    const r = await loadByToken(token);
    requireSession(req, r);
    const doc = r.envelope.documents.find((d) => d.id === docId);
    if (!doc) throw notFound('Document');
    // Once complete the signer may download the sealed copy
    const key = r.envelope.status === 'COMPLETED' && doc.finalKey ? doc.finalKey : doc.storageKey;
    reply.header('Content-Type', 'application/pdf').header('Cache-Control', 'private, no-store');
    return getObject(key);
  });

  app.post('/signing/:token/complete', async (req) => {
    const { token } = req.params as { token: string };
    const body = parse(
      z.object({
        consent: z.literal(true, { errorMap: () => ({ message: 'You must agree to sign electronically.' }) }),
        values: z.record(z.string(), z.string().max(MAX_SIGNATURE_BYTES * 1.4)),
      }),
      req.body,
    );
    const r = await loadByToken(token);
    requireReady(r);
    requireSession(req, r);
    const fields = await prisma.field.findMany({ where: { recipientId: r.id } });

    const updates: { id: string; value: string | null }[] = [];
    for (const f of fields) {
      let value: string | null = body.values[f.id]?.trim() || null;
      switch (f.type) {
        case 'NAME':
          value = r.name;
          break;
        case 'EMAIL':
          value = r.email;
          break;
        case 'DATE_SIGNED':
          // Rendered from signedAt at sealing time
          value = new Date().toISOString().slice(0, 10);
          break;
        case 'SIGNATURE':
        case 'INITIALS':
          if (value) {
            if (Buffer.byteLength(value) > MAX_SIGNATURE_BYTES * 1.4) throw badRequest('Signature image is too large.');
            value = normalizeSignaturePng(value);
          }
          break;
        case 'CHECKBOX':
          value = value === 'true' ? 'true' : f.required ? null : 'false';
          break;
        case 'TEXT':
          if (value && value.length > 500) throw badRequest('Text fields are limited to 500 characters.');
          break;
      }
      if (f.required && !value) {
        throw badRequest(`Complete all required fields (${f.label ?? f.type.toLowerCase().replace('_', ' ')} on page ${f.page + 1}).`);
      }
      updates.push({ id: f.id, value });
    }

    const policy = (r.envelope.policy as unknown as ResolvedPolicy | null) ?? resolvePolicy(r.envelope.jurisdiction, r.envelope.documentType);
    const client = clientInfo(req);
    const signature = updates.find((u) => fields.find((f) => f.id === u.id)?.type === 'SIGNATURE')?.value;

    await prisma.$transaction(async (tx) => {
      // Conditional update so a double submit can't sign twice
      const claimed = await tx.recipient.updateMany({
        where: { id: r.id, status: { in: ['SENT', 'VIEWED'] } },
        data: { status: 'SIGNED', signedAt: new Date(), signedIp: client.ip, signedUserAgent: client.userAgent },
      });
      if (claimed.count === 0) throw conflict('You have already signed.');
      for (const u of updates) await tx.field.update({ where: { id: u.id }, data: { value: u.value } });
      await appendAudit(tx, {
        envelopeId: r.envelopeId,
        type: 'recipient.consented',
        actor: actorOf(r),
        data: { consentTextSha256: sha256Hex(policy.consentText) },
        ...client,
      });
      await appendAudit(tx, {
        envelopeId: r.envelopeId,
        type: 'recipient.signed',
        actor: actorOf(r),
        data: {
          fieldsCompleted: updates.filter((u) => u.value).length,
          signatureImageSha256: signature ? sha256Hex(signature) : null,
          identity: { method: 'email-otp', verifiedAt: r.verifiedAt?.toISOString() },
        },
        ...client,
      });
      await enqueueWebhook(tx, r.envelope.orgId, 'recipient.signed', {
        envelopeId: r.envelopeId,
        recipientId: r.id,
        email: r.email,
      });
    });

    // Routing and sealing can take a few seconds (timestamp authority round-trip); run after responding.
    advanceEnvelope(r.envelopeId).catch((err) => req.log.error({ err }, 'advanceEnvelope failed'));
    return { signed: true };
  });

  /** The signer hands the request to someone else (e.g. the right person in their company). */
  app.post('/signing/:token/reassign', async (req) => {
    const { token } = req.params as { token: string };
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(120),
        email: z.string().trim().toLowerCase().email(),
        reason: z.string().trim().min(1).max(500),
      }),
      req.body,
    );
    const r = await loadByToken(token);
    requireReady(r);
    requireSession(req, r);
    if (r.embedded || r.hostUserId) throw conflict('This signing request cannot be reassigned.');
    if (body.email === r.email) throw badRequest('Enter a different person.');
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.recipient.update({
        where: { id: r.id },
        data: {
          name: body.name,
          email: body.email,
          status: 'SENT',
          tokenVersion: { increment: 1 },
          signerSessionHash: null,
          verifiedAt: null,
          viewedAt: null,
          otpHash: null,
          // The new person may use a different language; start from the default
          locale: r.locale,
        },
      });
      await appendAudit(tx, {
        envelopeId: r.envelopeId,
        type: 'recipient.reassigned',
        actor: actorOf(r),
        data: { recipientId: r.id, from: { name: r.name, email: r.email }, to: { name: body.name, email: body.email }, reason: body.reason },
        ...clientInfo(req),
      });
      return u;
    });
    await notifySigners(r.envelope, [updated], 'invite');
    await notifySender(r.envelope, `Reassigned: ${r.envelope.title}`, [
      `${r.name} (${r.email}) passed "${r.envelope.title}" to ${body.name} (${body.email}).`,
      `Reason: ${body.reason}`,
    ]).catch(() => {});
    return { reassigned: true };
  });

  app.post('/signing/:token/decline', async (req) => {
    const { token } = req.params as { token: string };
    const { reason } = parse(z.object({ reason: z.string().trim().min(1).max(500) }), req.body);
    const r = await loadByToken(token);
    requireReady(r);
    requireSession(req, r);
    await prisma.$transaction(async (tx) => {
      await tx.recipient.update({ where: { id: r.id }, data: { status: 'DECLINED', declinedAt: new Date(), declineReason: reason } });
      await tx.envelope.update({ where: { id: r.envelopeId }, data: { status: 'DECLINED' } });
      await appendAudit(tx, { envelopeId: r.envelopeId, type: 'recipient.declined', actor: actorOf(r), data: { reason }, ...clientInfo(req) });
      await enqueueWebhook(tx, r.envelope.orgId, 'recipient.declined', { envelopeId: r.envelopeId, recipientId: r.id, reason });
    });
    await notifySender(r.envelope, `Declined: ${r.envelope.title}`, [
      `${r.name} (${r.email}) declined to sign "${r.envelope.title}".`,
      `Reason: ${reason}`,
    ]).catch(() => {});
    return { declined: true };
  });
}
