import type { Envelope, Prisma, Recipient } from '@prisma/client';
import { appendAudit, verifyChain, type Actor } from '../audit/audit.js';
import { prisma, type Tx } from '../db.js';
import { buildCertificate } from '../documents/certificate.js';
import { renderCompletedPdf } from '../documents/render.js';
import { signingUrl } from '../lib/auth.js';
import { sha256Hex } from '../lib/crypto.js';
import { conflict, notFound, unprocessable } from '../lib/errors.js';
import { formatDateFor, t } from '../i18n/messages.js';
import { getBranding } from '../organization/branding.js';
import { layout, sendMail } from '../lib/mailer.js';
import { getObject, putObject } from '../lib/storage.js';
import { resolvePolicy, type ResolvedPolicy } from '../policy/engine.js';
import { isIncremental, prepareForSend } from '../esign/service.js';
import { formatAmount } from '../payments/providers.js';
import { sealPdf, sealPdfIncremental, type SealResult } from '../trust/pades.js';
import { enqueueWebhook } from '../webhooks/dispatcher.js';
import { assertCanSend } from '../billing/plans.js';
import { HttpError } from '../lib/errors.js';
import { mandateLabels } from '../enach/routes.js';
import { approvalGate } from '../approvals/service.js';
import { appBaseFor } from '../governance/delivery.js';
import { rememberRecipients } from '../contacts/service.js';

export const envelopeInclude = {
  documents: { orderBy: { order: 'asc' } },
  recipients: { orderBy: [{ routingOrder: 'asc' }, { name: 'asc' }] },
  fields: true,
} satisfies Prisma.EnvelopeInclude;

export type FullEnvelope = Prisma.EnvelopeGetPayload<{ include: typeof envelopeInclude }>;

/** Members see the envelopes they created; admins and owners see the whole organisation's. */
/** Members see their own agreements and those of departments they manage; admins see everything. */
export function envelopeScope(auth: { orgId: string; userId: string | null; role: string; managedDepartmentIds?: string[]; testMode?: boolean }): Prisma.EnvelopeWhereInput {
  // API keys see only agreements of their own mode (test or live)
  if (auth.testMode !== undefined) return { orgId: auth.orgId, testMode: auth.testMode };
  if (auth.role !== 'MEMBER') return { orgId: auth.orgId };
  const managed = auth.managedDepartmentIds ?? [];
  return managed.length
    ? { orgId: auth.orgId, OR: [{ createdById: auth.userId ?? '-' }, { departmentId: { in: managed } }] }
    : { orgId: auth.orgId, createdById: auth.userId ?? '-' };
}

export async function getVisibleEnvelope(auth: { orgId: string; userId: string | null; role: string; managedDepartmentIds?: string[]; testMode?: boolean }, id: string): Promise<FullEnvelope> {
  const env = await prisma.envelope.findFirst({ where: { id, ...envelopeScope(auth) }, include: envelopeInclude });
  if (!env) throw notFound('Envelope');
  return env;
}

export async function getEnvelope(orgId: string, id: string): Promise<FullEnvelope> {
  const env = await prisma.envelope.findFirst({ where: { id, orgId }, include: envelopeInclude });
  if (!env) throw notFound('Envelope');
  return env;
}

export function assertDraft(env: Envelope) {
  if (env.status !== 'DRAFT') throw conflict('Only draft envelopes can be edited.');
}

/** Problems that prevent sending, independent of jurisdiction rules. */
export function sendReadinessProblems(env: FullEnvelope): string[] {
  const problems: string[] = [];
  if (env.documents.length === 0) problems.push('Add at least one document.');
  const signers = env.recipients.filter((r) => r.role === 'SIGNER');
  if (signers.length === 0) problems.push('Add at least one signer.');
  const signerIds = new Set(signers.map((s) => s.id));
  if (env.fields.some((f) => !signerIds.has(f.recipientId))) problems.push('Some fields belong to recipients who no longer sign.');

  const policy = resolvePolicy(env.jurisdiction, env.documentType);
  if (policy.signatureLevel !== 'SES') {
    for (const s of signers.filter((x) => x.signatureMethod === 'ELECTRONIC')) {
      problems.push(
        policy.signatureLevel === 'QES'
          ? `${s.name} must sign with a qualified electronic signature (QES required for this document).`
          : `${s.name} must sign with Aadhaar eSign, a DSC or a qualified signature (${policy.signatureLevel} signature required for this document).`,
      );
    }
  }
  if (isIncremental(env.recipients)) {
    const actors = env.recipients.filter(actsOn);
    if (env.routing !== 'SEQUENTIAL' || new Set(actors.map((r) => r.routingOrder)).size !== actors.length) {
      problems.push('With Aadhaar eSign, DSC or qualified signatures, set a signing order with one person per step.');
    }
    if (env.fields.some((f) => f.type === 'ATTACHMENT')) problems.push('Attachment fields are not available with Aadhaar eSign, DSC or qualified signatures yet.');
    if (env.recipients.some((r) => r.signatureMethod === 'QES' && (r.embedded || r.hostUserId))) problems.push('Qualified-signature signers cannot be embedded or in person.');
    if (env.recipients.some((r) => r.signatureMethod === 'AADHAAR_ESIGN') && env.jurisdiction !== 'IN') problems.push('Aadhaar eSign is only available for Indian agreements.');
    if (env.recipients.some((r) => r.signatureMethod === 'AADHAAR_ESIGN' && (r.embedded || r.hostUserId))) problems.push('Aadhaar eSign signers cannot be embedded or in person.');
  }
  if (policy.stampDutyRequired && !env.estamp) problems.push('Add e-stamp details (stamp duty is payable for this document).');
  // Witnesses sign after the person whose signature they witness
  for (const w of signers.filter((s) => s.witnessForId)) {
    const principal = signers.find((s) => s.id === w.witnessForId);
    if (!principal) problems.push(`${w.name} witnesses someone who is no longer a signer.`);
    else if (env.routing === 'SEQUENTIAL' && w.routingOrder <= principal.routingOrder) problems.push(`${w.name} must sign after ${principal.name}, whose signature they witness.`);
  }
  for (const s of signers) {
    if (!env.fields.some((f) => f.recipientId === s.id && f.type === 'SIGNATURE')) {
      problems.push(`Place at least one signature field for ${s.name}.`);
    }
  }
  return problems;
}

/** Recipients who must act (signers and approvers). */
export const actsOn = (r: Recipient) => r.role === 'SIGNER' || r.role === 'APPROVER';

/** Recipients whose turn it is: everyone for parallel routing, the lowest pending order otherwise. */
function activeSigners(env: Envelope, recipients: Recipient[]): Recipient[] {
  const pending = recipients.filter((r) => actsOn(r) && r.status !== 'SIGNED' && r.status !== 'DECLINED');
  if (env.routing === 'PARALLEL') return pending;
  const next = Math.min(...pending.map((r) => r.routingOrder));
  return pending.filter((r) => r.routingOrder === next);
}

/** Long-term validation details for the audit trail. */
const ltvAudit = (sealed: SealResult) => ({
  level: sealed.ltv.level,
  certificates: sealed.ltv.certificates,
  crls: sealed.ltv.crls,
  ocsps: sealed.ltv.ocsps,
  ...(sealed.ltv.missing.length ? { missingRevocationData: sealed.ltv.missing } : {}),
  ...(sealed.ltv.documentTimestamp ? { archiveTimestamp: sealed.ltv.documentTimestamp.toISOString() } : {}),
  ...(sealed.ltv.error ? { error: sealed.ltv.error } : {}),
});

const ltvFields = (sealed: SealResult) => ({ ltvLevel: sealed.format, archiveTimestampAt: sealed.ltv.documentTimestamp ?? null });

export async function sendEnvelope(orgId: string, id: string, actor: Actor, client: { ip?: string | null; userAgent?: string | null }) {
  const env = await getEnvelope(orgId, id);
  assertDraft(env);
  const problems = sendReadinessProblems(env);
  if (problems.length) throw unprocessable('The envelope is not ready to send.', { problems });
  const policy = resolvePolicy(env.jurisdiction, env.documentType);
  if (!policy.allowed) throw unprocessable('This document cannot be sent under the selected compliance profile.', { problems: policy.blockers });
  if (!env.testMode) await assertCanSend(orgId);
  // Internal approval: the agreement waits as a draft until an approver approves it
  if (actor.kind === 'user' && (await approvalGate(env, actor.id)) === 'pending') return getEnvelope(orgId, id);
  if (actor.kind === 'user') {
    const sender = await prisma.user.findUnique({ where: { id: actor.id }, select: { emailVerifiedAt: true } });
    if (sender && !sender.emailVerifiedAt) throw new HttpError(403, 'Confirm your email address before sending. We sent you a link when you signed up.', 'email_unverified');
  }

  await prepareForSend(id, actor);
  // Documents may have changed (e-stamp page added); record what is actually sent
  const sent = await getEnvelope(orgId, id);

  const toNotify = await prisma.$transaction(async (tx) => {
    const updated = await tx.envelope.update({
      where: { id },
      data: { status: 'SENT', sentAt: new Date(), policy: policy as unknown as Prisma.JsonObject },
    });
    await appendAudit(tx, {
      envelopeId: id,
      type: 'envelope.sent',
      actor,
      data: {
        policy: { jurisdiction: policy.jurisdiction, level: policy.signatureLevel, format: policy.signatureFormat },
        documents: sent.documents.map((d) => ({ id: d.id, name: d.name, sha256: d.sha256 })),
        ...(sent.estampResult ? { estamp: sent.estampResult } : {}),
        recipients: env.recipients.map((r) => ({ id: r.id, name: r.name, email: r.email, role: r.role, order: r.routingOrder })),
      },
      ...client,
    });
    await enqueueWebhook(tx, orgId, 'envelope.sent', { envelopeId: id, title: env.title });
    const active = activeSigners(updated, env.recipients);
    await tx.recipient.updateMany({ where: { id: { in: active.map((r) => r.id) } }, data: { status: 'SENT' } });
    return active;
  });

  await notifySigners(env, toNotify, 'invite');
  if (!env.testMode) await rememberRecipients(orgId, env.recipients).catch((err) => console.error('contacts update failed', err));
  return getEnvelope(orgId, id);
}

/** Emails signing links and records each notification in the audit trail. */
export async function notifySigners(env: Envelope, recipients: Recipient[], kind: 'invite' | 'reminder') {
  const sender = await prisma.user.findUnique({ where: { id: env.createdById } });
  const brand = await getBranding(env.orgId);
  const base = await appBaseFor(env.orgId);
  for (const r of recipients) {
    // Embedded and in-person signers are reached through the integrating app or the host
    if (r.embedded || r.hostUserId) continue;
    const vars = { title: env.title, sender: sender?.name ?? 'DocSign', name: r.name };
    const { html, text } = layout({
      locale: r.locale,
      brand,
      heading: t(r.locale, kind === 'invite' ? 'inviteHeading' : 'reminderHeading', vars),
      paragraphs: [
        t(r.locale, 'hello', vars),
        t(r.locale, 'waiting', vars),
        ...(env.message ? [t(r.locale, 'senderMessage', { ...vars, message: env.message })] : []),
        ...(env.expiresAt ? [t(r.locale, 'expires', { date: formatDateFor(r.locale, env.expiresAt) })] : []),
      ],
      button: { label: t(r.locale, 'reviewAndSign'), url: signingUrl(r, base) },
    });
    await sendMail({
      to: r.email,
      subject: `${env.testMode ? '[TEST] ' : ''}${t(r.locale, kind === 'invite' ? 'inviteSubject' : 'reminderSubject', vars)}`,
      html,
      text,
      orgId: env.orgId,
    });
    await prisma.$transaction(async (tx) => {
      await tx.recipient.update({ where: { id: r.id }, data: { lastNotifiedAt: new Date() } });
      await appendAudit(tx, {
        envelopeId: env.id,
        type: kind === 'invite' ? 'recipient.notified' : 'recipient.reminded',
        actor: { kind: 'system' },
        data: { recipientId: r.id, email: r.email, channel: 'email' },
      });
    });
  }
}

/**
 * Called after a signer finishes. Either notifies the next routing group or,
 * when every signer is done, seals the envelope.
 */
export async function advanceEnvelope(envelopeId: string) {
  const env = await prisma.envelope.findUnique({ where: { id: envelopeId }, include: { recipients: true } });
  if (!env || env.status !== 'SENT') return;
  const signers = env.recipients.filter(actsOn);
  if (signers.every((r) => r.status === 'SIGNED')) {
    await finalizeEnvelope(envelopeId);
    return;
  }
  const next = activeSigners(env, env.recipients).filter((r) => r.status === 'CREATED');
  if (next.length === 0) return;
  await prisma.recipient.updateMany({ where: { id: { in: next.map((r) => r.id) } }, data: { status: 'SENT' } });
  await notifySigners(env, next, 'invite');
}

const STALE_CLAIM_MS = 5 * 60 * 1000;

/** "Paid ₹500.00 · receipt pay_123" per confirmed payment, and the registration line per active eNACH mandate. */
export async function paidLabels(envelopeId: string): Promise<Map<string, string>> {
  const payments = await prisma.payment.findMany({ where: { envelopeId, status: 'PAID' } });
  return new Map([...payments.map((p) => [p.id, `Paid ${formatAmount(p.amount, p.currency)} · ${p.receipt ?? p.id}`] as [string, string]), ...(await mandateLabels(envelopeId))]);
}

/**
 * Burns field values into each document, applies the PAdES platform seal,
 * stores results write-once and issues the certificate of completion.
 * Safe to re-run: finished steps are skipped.
 */
export async function finalizeEnvelope(envelopeId: string): Promise<void> {
  const claimed = await prisma.envelope.updateMany({
    where: {
      id: envelopeId,
      status: 'SENT',
      OR: [{ finalizingAt: null }, { finalizingAt: { lt: new Date(Date.now() - STALE_CLAIM_MS) } }],
    },
    data: { finalizingAt: new Date() },
  });
  if (claimed.count === 0) return;

  const env = await prisma.envelope.findUniqueOrThrow({ where: { id: envelopeId }, include: envelopeInclude });
  const policy = (env.policy as unknown as ResolvedPolicy) ?? resolvePolicy(env.jurisdiction, env.documentType);
  const signers = env.recipients.filter((r) => r.role === 'SIGNER');
  const signedAt = new Map(env.recipients.filter(actsOn).map((r) => [r.id, r.signedAt!]));
  const reason = `Signed electronically by ${signers.map((s) => s.name).join(', ')}`;
  let sealFormat = policy.signatureFormat;

  // Signer attachments are embedded in the first document, inside the seal
  const attachments = await prisma.signerAttachment.findMany({
    where: { envelopeId: env.id, id: { in: env.fields.filter((f) => f.type === 'ATTACHMENT' && f.value).map((f) => f.value!) } },
  });
  const attachmentNames = new Map(attachments.map((a) => [a.id, a.name]));
  const paymentLabels = await paidLabels(env.id);
  const byRecipient = new Map(env.recipients.map((r) => [r.id, r.name]));

  const incremental = isIncremental(env.recipients);
  for (const [index, doc] of env.documents.entries()) {
    if (doc.finalKey) continue;
    if (incremental) {
      // Signer signatures are already in the working copy; append the platform seal
      const sealed = await sealPdfIncremental(await getObject(doc.workingKey!), { reason });
      const finalSha256 = sha256Hex(sealed.pdf);
      const finalKey = `envelopes/${env.id}/completed/${doc.id}.pdf`;
      await putObject(finalKey, sealed.pdf, 'application/pdf', policy.retentionYears);
      sealFormat = sealed.format;
      await prisma.$transaction(async (tx) => {
        await tx.document.update({ where: { id: doc.id }, data: { finalKey, finalSha256, ...ltvFields(sealed) } });
        await appendAudit(tx, {
          envelopeId: env.id,
          type: 'document.sealed',
          actor: { kind: 'system' },
          data: { documentId: doc.id, sha256: finalSha256, format: sealed.format, keyProvider: sealed.keyProvider, incremental: true, ltv: ltvAudit(sealed) },
        });
      });
      continue;
    }
    const original = await getObject(doc.storageKey);
    const embed =
      index === 0
        ? await Promise.all(
            attachments.map(async (a) => ({
              name: a.name,
              data: await getObject(a.storageKey),
              mimeType: a.contentType,
              description: `Uploaded by ${byRecipient.get(a.recipientId) ?? 'signer'} (SHA-256 ${a.sha256})`,
            })),
          )
        : [];
    const rendered = await renderCompletedPdf(
      original,
      env.fields.filter((f) => f.documentId === doc.id),
      { envelopeId: env.id, signedAt, attachmentNames, paymentLabels, embed, testMode: env.testMode },
    );
    const sealed = await sealPdf(Buffer.from(rendered), { reason });
    sealFormat = sealed.format;
    const finalSha256 = sha256Hex(sealed.pdf);
    const finalKey = `envelopes/${env.id}/completed/${doc.id}.pdf`;
    await putObject(finalKey, sealed.pdf, 'application/pdf', policy.retentionYears);
    await prisma.$transaction(async (tx) => {
      await tx.document.update({ where: { id: doc.id }, data: { finalKey, finalSha256, ...ltvFields(sealed) } });
      await appendAudit(tx, {
        envelopeId: env.id,
        type: 'document.sealed',
        actor: { kind: 'system' },
        data: {
          documentId: doc.id,
          sha256: finalSha256,
          format: sealed.format,
          keyProvider: sealed.keyProvider,
          timestamp: sealed.timestamp.timestamped
            ? { genTime: sealed.timestamp.genTime?.toISOString(), tsa: sealed.timestamp.tsa }
            : { error: sealed.timestamp.error ?? 'No timestamp authority configured' },
          ltv: ltvAudit(sealed),
        },
      });
    });
  }

  if (!env.completedAt) {
    await prisma.$transaction(async (tx) => {
      await tx.envelope.update({ where: { id: env.id }, data: { completedAt: new Date() } });
      await appendAudit(tx, { envelopeId: env.id, type: 'envelope.completed', actor: { kind: 'system' }, data: {} });
    });
  }

  const fresh = await prisma.envelope.findUniqueOrThrow({ where: { id: envelopeId }, include: envelopeInclude });
  const events = await prisma.auditEvent.findMany({ where: { envelopeId }, orderBy: { seq: 'asc' } });
  const chain = await verifyChain(envelopeId);
  const signatureImages = new Map<string, string>();
  for (const f of fresh.fields) {
    if (f.type === 'SIGNATURE' && f.value && !signatureImages.has(f.recipientId)) signatureImages.set(f.recipientId, f.value);
  }
  const certPdf = await buildCertificate({
    envelope: { ...fresh, status: 'COMPLETED' },
    documents: fresh.documents,
    recipients: fresh.recipients,
    signatureImages,
    events,
    chainHead: chain.headHash,
    policy,
    sealFormat,
  });
  const sealedCert = await sealPdf(Buffer.from(certPdf), { reason: 'Certificate of Completion' });
  const certificateKey = `envelopes/${env.id}/completed/certificate.pdf`;
  await putObject(certificateKey, sealedCert.pdf, 'application/pdf', policy.retentionYears);

  await prisma.$transaction(async (tx) => {
    await tx.envelope.update({
      where: { id: env.id },
      data: {
        status: 'COMPLETED',
        certificateKey,
        certificateSha256: sha256Hex(sealedCert.pdf),
        certificateArchiveTimestampAt: sealedCert.ltv.documentTimestamp ?? null,
        finalizingAt: null,
      },
    });
    await enqueueWebhook(tx, env.orgId, 'envelope.completed', {
      envelopeId: env.id,
      title: env.title,
      documents: fresh.documents.map((d) => ({ id: d.id, name: d.name, sha256: d.finalSha256 })),
    });
  });

  await sendCompletionEmails(env.id).catch((err) => console.error('completion email failed', err));
}

async function sendCompletionEmails(envelopeId: string) {
  const env = await prisma.envelope.findUniqueOrThrow({
    where: { id: envelopeId },
    include: { ...envelopeInclude, createdBy: true },
  });
  const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
  let total = 0;
  for (const d of env.documents) {
    const buf = await getObject(d.finalKey!);
    total += buf.length;
    attachments.push({ filename: d.name.replace(/\.[^.]+$/, '') + ' (signed).pdf', content: buf, contentType: 'application/pdf' });
  }
  const cert = await getObject(env.certificateKey!);
  attachments.push({ filename: 'Certificate of Completion.pdf', content: cert, contentType: 'application/pdf' });
  // Keep emails deliverable; large envelopes are downloaded from the app instead
  const attach = total + cert.length < 15 * 1024 * 1024;

  const brand = await getBranding(env.orgId);
  const to = [
    ...env.recipients.map((r) => ({ name: r.name, email: r.email, locale: r.locale })),
    { name: env.createdBy.name, email: env.createdBy.email, locale: 'en' },
  ].filter((v, i, a) => a.findIndex((x) => x.email.toLowerCase() === v.email.toLowerCase()) === i);

  for (const person of to) {
    const vars = { title: env.title, name: person.name };
    const { html, text } = layout({
      locale: person.locale,
      brand,
      heading: t(person.locale, 'completedSubject', vars),
      paragraphs: [
        t(person.locale, 'hello', vars),
        t(person.locale, 'completedBody', vars),
        t(person.locale, attach ? 'completedAttached' : 'completedTooLarge'),
      ],
      footer: `Envelope ID: ${env.id}`,
    });
    await sendMail({
      to: person.email,
      subject: t(person.locale, 'completedSubject', vars),
      html,
      text,
      attachments: attach ? attachments : undefined,
      orgId: env.orgId,
    });
  }
}

export async function voidEnvelope(orgId: string, id: string, reason: string, actor: Actor, client: { ip?: string | null; userAgent?: string | null }) {
  const env = await getEnvelope(orgId, id);
  if (env.status !== 'SENT') throw conflict('Only envelopes that are out for signature can be voided.');
  await prisma.$transaction(async (tx) => {
    await tx.envelope.update({ where: { id }, data: { status: 'VOIDED', voidReason: reason } });
    await appendAudit(tx, { envelopeId: id, type: 'envelope.voided', actor, data: { reason }, ...client });
    await enqueueWebhook(tx, orgId, 'envelope.voided', { envelopeId: id, reason });
  });
  const notified = env.recipients.filter((r) => r.status !== 'CREATED');
  for (const r of notified) {
    const vars = { title: env.title, name: r.name, reason };
    const { html, text } = layout({
      locale: r.locale,
      heading: t(r.locale, 'voidedSubject', vars),
      paragraphs: [t(r.locale, 'hello', vars), t(r.locale, 'voidedBody', vars), t(r.locale, 'reason', vars)],
    });
    await sendMail({ to: r.email, subject: t(r.locale, 'voidedSubject', vars), html, text, orgId: env.orgId }).catch(() => {});
  }
  return getEnvelope(orgId, id);
}

export async function notifySender(env: Envelope, subject: string, paragraphs: string[]) {
  const sender = await prisma.user.findUnique({ where: { id: env.createdById } });
  if (!sender) return;
  const { html, text } = layout({ heading: subject, paragraphs: [`Hello ${sender.name},`, ...paragraphs] });
  await sendMail({ to: sender.email, subject, html, text });
}

export async function appendAuditTx(input: Parameters<typeof appendAudit>[1]) {
  return prisma.$transaction((tx: Tx) => appendAudit(tx, input));
}
