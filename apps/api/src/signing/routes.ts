import type { Recipient } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { appendAudit, type Actor } from '../audit/audit.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { clientInfo, parseSigningToken, signingToken, signingTokenMatches } from '../lib/auth.js';
import { numericCode, randomToken, safeEqualHex, sha256Hex } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, HttpError, notFound, unauthorized } from '../lib/errors.js';
import { assertClean } from '../lib/malware.js';
import { t } from '../i18n/messages.js';
import { maskPhone, sendOtpMessage } from '../messaging/providers.js';
import { getBranding } from '../organization/branding.js';
import { layout, sendMail } from '../lib/mailer.js';
import { getObject, putObject } from '../lib/storage.js';
import { MAX_SIGNATURE_BYTES, resolveFieldValues } from './values.js';
import { parse } from '../lib/validate.js';
import { resolvePolicy, type ResolvedPolicy } from '../policy/engine.js';
import { advanceEnvelope, notifySender, notifySigners } from '../envelopes/service.js';
import { applyElectronicIncrement, isIncremental } from '../esign/service.js';
import { enqueueWebhook } from '../webhooks/dispatcher.js';
import { assertKycComplete, kycSummary } from '../kyc/routes.js';

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_MS = 30 * 1000;
const OTP_MAX_ATTEMPTS = 5;
export const SIGNER_SESSION_TTL_MS = 2 * 3600 * 1000;
const SESSION_TTL_MS = SIGNER_SESSION_TTL_MS;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function sniffAttachment(data: Buffer): string | null {
  if (data.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  return null;
}

/** What established the signer's identity, for the audit trail. */
function identityEvidence(r: Recipient) {
  if (r.hostUserId) return { method: 'in_person', hostUserId: r.hostUserId, verifiedAt: r.verifiedAt?.toISOString() };
  if (r.embedded) return { method: 'embedded', clientUserId: r.clientUserId, verifiedAt: r.verifiedAt?.toISOString() };
  return { method: r.authMethod.toLowerCase(), verifiedAt: r.verifiedAt?.toISOString() };
}

export const cookieName = (recipientId: string) => `ds_signer_${recipientId}`;

export async function loadByToken(token: string) {
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

/**
 * The signer session travels in a cookie, or in the X-Signer-Session header
 * for embedded signing (iframes can't rely on third-party cookies).
 */
function hasSession(req: FastifyRequest, r: Recipient): boolean {
  const header = req.headers['x-signer-session'];
  const value = req.cookies[cookieName(r.id)] ?? (typeof header === 'string' ? header : undefined);
  if (!value || !r.signerSessionHash || !r.verifiedAt) return false;
  if (Date.now() - r.verifiedAt.getTime() > SESSION_TTL_MS) return false;
  return safeEqualHex(sha256Hex(value), r.signerSessionHash);
}

export function requireSession(req: FastifyRequest, r: Recipient) {
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

export function requireReady(r: LoadedRecipient) {
  const state = signerState(r);
  if (state !== 'ready') throw conflict(`This signing request is ${state}.`);
}

/** Where one-time codes go for this recipient, or null for access codes. */
function otpChannel(r: Recipient): 'email' | 'sms' | 'whatsapp' | null {
  if (r.authMethod === 'SMS_OTP') return 'sms';
  if (r.authMethod === 'WHATSAPP_OTP') return 'whatsapp';
  if (r.authMethod === 'ACCESS_CODE' || r.authMethod === 'NONE') return null;
  return 'email';
}

export const actorOf = (r: Recipient): Actor => ({ kind: 'recipient', id: r.id, name: r.name, email: r.email });

export async function labelledValues(envelopeId: string, recipientId: string) {
  const fields = await prisma.field.findMany({ where: { envelopeId, recipientId: { not: recipientId }, label: { not: null }, value: { not: null } } });
  return Object.fromEntries(fields.filter((f) => f.type !== 'SIGNATURE' && f.type !== 'INITIALS').map((f) => [f.label!, f.value!]));
}

const maskEmail = (email: string) => email.replace(/^(.{1,2})[^@]*(@.*)$/, (_, a, b) => `${a}***${b}`);

export async function signingRoutes(app: FastifyInstance) {
  /** Starts an embedded session from a one-time ticket. The ticket can be used once. */
  app.post('/embed-sessions/:ticket', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const { ticket } = req.params as { ticket: string };
    const hash = sha256Hex(ticket);
    const r = await prisma.recipient.findUnique({ where: { embedTicketHash: hash }, include: { envelope: { include: { org: true } } } });
    if (!r || !r.embedTicketExpiresAt || r.embedTicketExpiresAt < new Date()) throw notFound('Signing session');
    // Single use: clear the ticket atomically
    const claimed = await prisma.recipient.updateMany({ where: { id: r.id, embedTicketHash: hash }, data: { embedTicketHash: null, embedTicketExpiresAt: null } });
    if (claimed.count === 0) throw notFound('Signing session');
    const session = randomToken();
    await prisma.$transaction(async (tx) => {
      await tx.recipient.update({ where: { id: r.id }, data: { verifiedAt: new Date(), signerSessionHash: sha256Hex(session) } });
      await appendAudit(tx, {
        envelopeId: r.envelopeId,
        type: 'recipient.verified',
        actor: actorOf(r),
        data: { method: 'embedded', clientUserId: r.clientUserId },
        ...clientInfo(req),
      });
    });
    return {
      signPath: `/sign/${signingToken(r)}`,
      sessionToken: session,
      recipientId: r.id,
      returnUrl: r.embedReturnUrl,
    };
  });

  /** Origins allowed to frame a signing page: the org's embed origins for embedded recipients only. */
  app.get('/frame-origins', async (req) => {
    const { token, ticket } = req.query as { token?: string; ticket?: string };
    let recipient: { embedded: boolean; envelope: { org: { embedOrigins: string[] } } } | null = null;
    if (ticket) {
      recipient = await prisma.recipient.findUnique({ where: { embedTicketHash: sha256Hex(ticket) }, include: { envelope: { include: { org: true } } } });
    } else if (token) {
      const parsed = parseSigningToken(token);
      const r = parsed && (await prisma.recipient.findUnique({ where: { id: parsed.id }, include: { envelope: { include: { org: true } } } }));
      if (r && signingTokenMatches(r, parsed.mac)) recipient = r;
    }
    return { origins: recipient?.embedded ? recipient.envelope.org.embedOrigins : [] };
  });

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
        authMethod: r.authMethod,
        signatureMethod: r.signatureMethod,
        esignSandbox: r.signatureMethod === 'AADHAAR_ESIGN' && config.esign.mode === 'sandbox',
        maskedPhone: r.phone ? maskPhone(r.phone) : null,
        embedded: r.embedded,
        returnUrl: r.embedded ? r.embedReturnUrl : null,
        idChecks: verified ? await kycSummary(r) : r.idChecks.map((kind) => ({ kind, status: 'NOT_STARTED' })),
      },
      branding: await getBranding(env.orgId),
      aiAvailable: config.ai.enabled && Boolean((await prisma.organization.findUnique({ where: { id: env.orgId }, select: { aiEnabled: true } }))?.aiEnabled),
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
        options: f.options,
        formula: f.formula,
        condition: f.condition,
        amount: f.amount,
        currency: f.currency,
        config: f.config,
        value: f.value,
      })),
      // Values from earlier signers that this signer's conditions/formulas may refer to
      context: verified ? await labelledValues(r.envelopeId, r.id) : {},
    };
  });

  app.post(
    '/signing/:token/otp/send',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req) => {
      const { token } = req.params as { token: string };
      const r = await loadByToken(token);
      requireReady(r);
      const channel = otpChannel(r);
      if (!channel) throw badRequest('This signing request uses an access code from the sender.');
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
          data: { channel, to: channel === 'email' ? r.email : maskPhone(r.phone!) },
          ...clientInfo(req),
        });
      });
      if (channel === 'email') {
        const { html, text } = layout({
          locale: r.locale,
          brand: await getBranding(r.envelope.orgId),
          heading: t(r.locale, 'otpHeading'),
          paragraphs: [t(r.locale, 'otpIntro', { title: r.envelope.title }), code, t(r.locale, 'otpExpiry')],
        });
        await sendMail({ to: r.email, subject: t(r.locale, 'otpSubject', { code }), html, text, orgId: r.envelope.orgId });
        return { sentTo: maskEmail(r.email), channel, expiresInSeconds: OTP_TTL_MS / 1000 };
      }
      await sendOtpMessage(channel, { to: r.phone!, code, text: t(r.locale, 'otpSubject', { code }) });
      return { sentTo: maskPhone(r.phone!), channel, expiresInSeconds: OTP_TTL_MS / 1000 };
    },
  );

  app.post(
    '/signing/:token/otp/verify',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (req, reply: FastifyReply) => {
      const { token } = req.params as { token: string };
      const { code } = parse(z.object({ code: z.string().trim().min(4).max(32) }), req.body);
      const r = await loadByToken(token);
      requireReady(r);
      const accessCode = r.authMethod === 'ACCESS_CODE';
      if (accessCode) {
        if (!r.accessCodeHash) throw badRequest('This signing request has no access code.');
        if (r.otpAttempts >= OTP_MAX_ATTEMPTS) throw forbidden('Too many incorrect attempts. Ask the sender to reset your access code.');
      } else {
        if (!/^\d{6}$/.test(code)) throw badRequest('Enter the 6-digit code');
        if (!r.otpHash || !r.otpExpiresAt || r.otpExpiresAt < new Date()) {
          throw badRequest('The code has expired. Request a new one.');
        }
        if (r.otpAttempts >= OTP_MAX_ATTEMPTS) throw forbidden('Too many incorrect attempts. Request a new code.');
      }
      const expected = accessCode ? r.accessCodeHash! : r.otpHash!;

      if (!safeEqualHex(sha256Hex(`${r.id}:${code}`), expected)) {
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
          data: { method: r.authMethod.toLowerCase(), assurance: 'LOW' },
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
    if (r.signatureMethod !== 'ELECTRONIC') throw badRequest('This document is signed with Aadhaar eSign or a DSC; use that option to sign.');
    await assertKycComplete(r);
    const [fields, others, attachments] = await Promise.all([
      prisma.field.findMany({ where: { recipientId: r.id } }),
      prisma.field.findMany({ where: { envelopeId: r.envelopeId, recipientId: { not: r.id } } }),
      prisma.signerAttachment.findMany({ where: { recipientId: r.id } }),
    ]);
    const updates = resolveFieldValues(r, fields, others, body.values, attachments);
    const approving = r.role === 'APPROVER';

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
        type: approving ? 'recipient.approved' : 'recipient.signed',
        actor: actorOf(r),
        data: {
          fieldsCompleted: updates.filter((u) => u.value).length,
          signatureImageSha256: signature ? sha256Hex(signature) : null,
          attachments: attachments
            .filter((a) => updates.some((u) => u.value === a.id))
            .map((a) => ({ name: a.name, sha256: a.sha256 })),
          identity: identityEvidence(r),
        },
        ...client,
      });
      await enqueueWebhook(tx, r.envelope.orgId, 'recipient.signed', {
        envelopeId: r.envelopeId,
        recipientId: r.id,
        email: r.email,
      });
    });

    // In envelopes with cryptographic signers, values are appended now so later signatures cover them
    const envRecipients = await prisma.recipient.findMany({ where: { envelopeId: r.envelopeId }, select: { signatureMethod: true } });
    if (isIncremental(envRecipients)) await applyElectronicIncrement(r.envelopeId, r.id);

    // Routing and sealing can take a few seconds (timestamp authority round-trip); run after responding.
    advanceEnvelope(r.envelopeId).catch((err) => req.log.error({ err }, 'advanceEnvelope failed'));
    return { signed: true };
  });

  /** Upload a file for an ATTACHMENT field; returns an id to submit as the field's value. */
  app.post('/signing/:token/attachments/:fieldId', async (req, reply) => {
    const { token, fieldId } = req.params as { token: string; fieldId: string };
    const r = await loadByToken(token);
    requireReady(r);
    requireSession(req, r);
    const field = await prisma.field.findFirst({ where: { id: fieldId, recipientId: r.id, type: 'ATTACHMENT' } });
    if (!field) throw notFound('Attachment field');
    const file = await req.file({ limits: { fileSize: MAX_ATTACHMENT_BYTES } });
    if (!file) throw badRequest('Attach a file in the "file" field.');
    const data = await file.toBuffer();
    if (file.file.truncated) throw badRequest('Attachments are limited to 10 MB.');
    const kind = sniffAttachment(data);
    if (!kind) throw badRequest('Upload a PDF, PNG or JPG file.');
    await assertClean(file.filename, data);
    const sha256 = sha256Hex(data);
    const created = await prisma.signerAttachment.create({
      data: {
        envelopeId: r.envelopeId,
        fieldId,
        recipientId: r.id,
        name: file.filename.slice(0, 200),
        contentType: kind,
        size: data.length,
        sha256,
        storageKey: '',
      },
    });
    const storageKey = `envelopes/${r.envelopeId}/attachments/${created.id}`;
    await putObject(storageKey, data, kind);
    await prisma.signerAttachment.update({ where: { id: created.id }, data: { storageKey } });
    reply.code(201);
    return { id: created.id, name: created.name, size: created.size };
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
