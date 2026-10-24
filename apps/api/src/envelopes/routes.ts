import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { appendAudit, verifyChain } from '../audit/audit.js';
import { prisma } from '../db.js';
import { MAX_UPLOAD_BYTES } from '../documents/ingest.js';
import { clientInfo, requireAuth } from '../lib/auth.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { getObject, putObject } from '../lib/storage.js';
import { sha256Hex } from '../lib/crypto.js';
import { Prisma } from '@prisma/client';
import { INDIAN_STATES } from '../estamp/provider.js';
import { formulaRefs } from '../lib/formula.js';
import { addDocument } from './documents.js';
import { E164 } from '../messaging/providers.js';
import { config } from '../config.js';
import { parse } from '../lib/validate.js';
import { listDocumentTypes, listJurisdictions, resolvePolicy } from '../policy/engine.js';
import { JURISDICTIONS, DOCUMENT_TYPES } from '../policy/jurisdictions.js';
import { SUPPORTED_LOCALES } from '../i18n/messages.js';
import {
  assertDraft,
  envelopeScope,
  getVisibleEnvelope,
  notifySigners,
  sendEnvelope,
  sendReadinessProblems,
  voidEnvelope,
  type FullEnvelope,
} from './service.js';

const jurisdictionCode = z.string().refine((c) => c in JURISDICTIONS, 'Unknown jurisdiction');
const documentTypeCode = z.string().refine((c) => c in DOCUMENT_TYPES, 'Unknown document type');

const envelopeInput = z.object({
  title: z.string().trim().min(1).max(200),
  message: z.string().max(2000).nullish(),
  jurisdiction: jurisdictionCode.optional(),
  documentType: documentTypeCode.optional(),
  routing: z.enum(['SEQUENTIAL', 'PARALLEL']).optional(),
  reminderDays: z.number().int().min(0).max(30).optional(),
  expiresAt: z.coerce.date().nullish(),
  /** India: buy an e-stamp for this agreement when it is sent */
  estamp: z
    .object({
      state: z.string().refine((s) => s in INDIAN_STATES, 'Unknown state'),
      article: z.string().trim().min(1).max(120),
      dutyAmount: z.number().min(1).max(10_000_000),
      firstParty: z.string().trim().min(1).max(160),
      secondParty: z.string().trim().min(1).max(160),
      purpose: z.string().trim().min(1).max(200),
    })
    .nullish(),
});

const recipientsInput = z
  .array(
    z.object({
      id: z.string().optional(),
      name: z.string().trim().min(1).max(120),
      email: z.string().trim().toLowerCase().email(),
      role: z.enum(['SIGNER', 'APPROVER', 'CC']).default('SIGNER'),
      routingOrder: z.number().int().min(1).max(50).default(1),
      locale: z.enum(SUPPORTED_LOCALES as [string, ...string[]]).default('en'),
      /** Signs on the sender's device, hosted by the current user; no email is sent. */
      inPerson: z.boolean().default(false),
      authMethod: z.enum(['EMAIL_OTP', 'SMS_OTP', 'WHATSAPP_OTP', 'ACCESS_CODE']).default('EMAIL_OTP'),
      signatureMethod: z.enum(['ELECTRONIC', 'AADHAAR_ESIGN', 'DSC']).default('ELECTRONIC'),
      phone: z.string().trim().regex(E164, 'Use international format, e.g. +919876543210').nullish(),
      /** Shared with the signer by the sender out of band; stored hashed. Omit to keep the current code. */
      accessCode: z.string().trim().min(4).max(32).nullish(),
      /** Signs inside your app via an embedded session; no emails are sent. */
      embedded: z.boolean().default(false),
      clientUserId: z.string().max(200).nullish(),
    }),
  )
  .max(50);

const fraction = z.number().min(0).max(1);
const fieldsInput = z
  .array(
    z.object({
      documentId: z.string(),
      recipientId: z.string(),
      type: z.enum(['SIGNATURE', 'INITIALS', 'DATE_SIGNED', 'NAME', 'EMAIL', 'TEXT', 'CHECKBOX', 'DROPDOWN', 'RADIO', 'NUMBER', 'FORMULA', 'ATTACHMENT', 'PAYMENT']),
      page: z.number().int().min(0),
      x: fraction,
      y: fraction,
      width: fraction.refine((v) => v > 0),
      height: fraction.refine((v) => v > 0),
      required: z.boolean().default(true),
      label: z.string().max(100).nullish(),
      options: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
      formula: z.string().max(300).nullish(),
      condition: z.object({ fieldLabel: z.string().min(1).max(100), equals: z.string().max(100) }).nullish(),
      amount: z.number().int().min(1).max(100_000_000).nullish(),
      currency: z.string().regex(/^[A-Z]{3}$/, 'Use an ISO currency code like INR').nullish(),
    }),
  )
  .max(500);

/** Public shape of an envelope: never exposes OTP or session hashes. */
export function serializeEnvelope(env: FullEnvelope) {
  return {
    id: env.id,
    title: env.title,
    message: env.message,
    status: env.status,
    routing: env.routing,
    jurisdiction: env.jurisdiction,
    documentType: env.documentType,
    reminderDays: env.reminderDays,
    expiresAt: env.expiresAt,
    sentAt: env.sentAt,
    completedAt: env.completedAt,
    voidReason: env.voidReason,
    createdAt: env.createdAt,
    updatedAt: env.updatedAt,
    hasCertificate: Boolean(env.certificateKey),
    estamp: env.estamp,
    estampResult: env.estampResult,
    certificateSha256: env.certificateSha256,
    policy: env.status === 'DRAFT' ? resolvePolicy(env.jurisdiction, env.documentType) : env.policy,
    readiness: env.status === 'DRAFT' ? sendReadinessProblems(env) : [],
    documents: env.documents.map((d) => ({
      id: d.id,
      name: d.name,
      order: d.order,
      sha256: d.sha256,
      pageCount: d.pageCount,
      pages: d.pages,
      finalSha256: d.finalSha256,
      completed: Boolean(d.finalKey),
    })),
    recipients: env.recipients.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      routingOrder: r.routingOrder,
      locale: r.locale,
      inPerson: Boolean(r.hostUserId),
      authMethod: r.authMethod,
      phone: r.phone,
      hasAccessCode: Boolean(r.accessCodeHash),
      embedded: r.embedded,
      clientUserId: r.clientUserId,
      signatureMethod: r.signatureMethod,
      status: r.status,
      viewedAt: r.viewedAt,
      verifiedAt: r.verifiedAt,
      signedAt: r.signedAt,
      declinedAt: r.declinedAt,
      declineReason: r.declineReason,
      lastNotifiedAt: r.lastNotifiedAt,
    })),
    fields: env.fields.map((f) => ({
      id: f.id,
      documentId: f.documentId,
      recipientId: f.recipientId,
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
      filled: f.value !== null,
    })),
  };
}

export async function envelopeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/policy/options', async () => ({
    jurisdictions: listJurisdictions(),
    documentTypes: listDocumentTypes(),
    indianStates: Object.entries(INDIAN_STATES).map(([code, name]) => ({ code, name })),
    esign: { aadhaar: config.esign.mode, dsc: true },
  }));

  app.get('/policy/resolve', async (req) => {
    const q = parse(z.object({ jurisdiction: jurisdictionCode, documentType: documentTypeCode }), req.query);
    return resolvePolicy(q.jurisdiction, q.documentType);
  });

  app.get('/stats', async (req) => {
    const groups = await prisma.envelope.groupBy({
      by: ['status'],
      where: envelopeScope(req.auth),
      _count: { _all: true },
    });
    const counts = Object.fromEntries(groups.map((g) => [g.status, g._count._all]));
    const awaitingMe = req.auth.userId
      ? await prisma.recipient.count({
          where: {
            status: { in: ['SENT', 'VIEWED'] },
            envelope: { status: 'SENT' },
            email: (await prisma.user.findUnique({ where: { id: req.auth.userId } }))?.email,
          },
        })
      : 0;
    return { counts, awaitingMe };
  });

  app.get('/envelopes', async (req) => {
    const q = parse(
      z.object({
        status: z.enum(['DRAFT', 'SENT', 'COMPLETED', 'DECLINED', 'VOIDED', 'EXPIRED']).optional(),
        search: z.string().max(100).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        cursor: z.string().optional(),
        /** A folder id, or "none" for agreements not in a folder */
        folderId: z.string().optional(),
        /** "me" limits to agreements I sent */
        sender: z.literal('me').optional(),
      }),
      req.query,
    );
    const items = await prisma.envelope.findMany({
      where: {
        ...envelopeScope(req.auth),
        ...(q.folderId ? { folderId: q.folderId === 'none' ? null : q.folderId } : {}),
        ...(q.sender === 'me' && req.auth.userId ? { createdById: req.auth.userId } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.search
          ? {
              OR: [
                { title: { contains: q.search, mode: 'insensitive' } },
                { recipients: { some: { email: { contains: q.search, mode: 'insensitive' } } } },
                { recipients: { some: { name: { contains: q.search, mode: 'insensitive' } } } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: { recipients: { orderBy: { routingOrder: 'asc' } }, createdBy: { select: { name: true } }, folder: { select: { id: true, name: true } } },
    });
    const hasMore = items.length > q.limit;
    return {
      data: items.slice(0, q.limit).map((e) => ({
        id: e.id,
        title: e.title,
        status: e.status,
        jurisdiction: e.jurisdiction,
        sentAt: e.sentAt,
        completedAt: e.completedAt,
        updatedAt: e.updatedAt,
        sender: e.createdBy.name,
        folder: e.folder,
        recipients: e.recipients.map((r) => ({ name: r.name, email: r.email, role: r.role, status: r.status })),
      })),
      nextCursor: hasMore ? items[q.limit - 1].id : null,
    };
  });

  app.post('/envelopes', async (req, reply) => {
    const body = parse(envelopeInput, req.body);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.auth.orgId } });
    if (!req.auth.userId) throw badRequest('The organisation has no owner to attribute this envelope to.');
    const env = await prisma.$transaction(async (tx) => {
      const created = await tx.envelope.create({
        data: {
          orgId: org.id,
          createdById: req.auth.userId!,
          title: body.title,
          message: body.message ?? null,
          jurisdiction: body.jurisdiction ?? org.jurisdiction,
          documentType: body.documentType ?? 'general',
          routing: body.routing ?? 'SEQUENTIAL',
          reminderDays: body.reminderDays ?? 2,
          expiresAt: body.expiresAt ?? null,
        },
      });
      await appendAudit(tx, {
        envelopeId: created.id,
        type: 'envelope.created',
        actor: req.auth.actor,
        data: { title: created.title },
        ...clientInfo(req),
      });
      return created;
    });
    reply.code(201);
    return serializeEnvelope(await getVisibleEnvelope(req.auth, env.id));
  });

  app.get('/envelopes/:id', async (req) => {
    const { id } = req.params as { id: string };
    return serializeEnvelope(await getVisibleEnvelope(req.auth, id));
  });

  app.patch('/envelopes/:id', async (req) => {
    const { id } = req.params as { id: string };
    const env = await getVisibleEnvelope(req.auth, id);
    assertDraft(env);
    const { estamp, ...body } = parse(envelopeInput.partial(), req.body);
    await prisma.envelope.update({
      where: { id },
      data: { ...body, ...(estamp !== undefined ? { estamp: estamp ?? Prisma.DbNull } : {}) },
    });
    return serializeEnvelope(await getVisibleEnvelope(req.auth, id));
  });

  app.delete('/envelopes/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const env = await getVisibleEnvelope(req.auth, id);
    assertDraft(env);
    await prisma.envelope.delete({ where: { id } });
    reply.code(204);
  });

  app.post('/envelopes/:id/documents', async (req, reply) => {
    const { id } = req.params as { id: string };
    const env = await getVisibleEnvelope(req.auth, id);
    assertDraft(env);
    const file = await req.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
    if (!file) throw badRequest('Attach a file in the "file" field.');
    const data = await file.toBuffer();
    if (file.file.truncated) throw badRequest('The file is larger than 25 MB.');
    reply.code(201);
    return addDocument(env, file.filename, data, req.auth.actor, clientInfo(req));
  });

  app.delete('/envelopes/:id/documents/:docId', async (req, reply) => {
    const { id, docId } = req.params as { id: string; docId: string };
    const env = await getVisibleEnvelope(req.auth, id);
    assertDraft(env);
    const doc = env.documents.find((d) => d.id === docId);
    if (!doc) throw notFound('Document');
    await prisma.$transaction(async (tx) => {
      await tx.document.delete({ where: { id: docId } });
      await appendAudit(tx, {
        envelopeId: id,
        type: 'document.removed',
        actor: req.auth.actor,
        data: { documentId: docId, name: doc.name },
        ...clientInfo(req),
      });
    });
    reply.code(204);
  });

  /** ?version=original|completed (default: completed when available) */
  app.get('/envelopes/:id/documents/:docId/file', async (req, reply) => {
    const { id, docId } = req.params as { id: string; docId: string };
    const { version } = req.query as { version?: string };
    const env = await getVisibleEnvelope(req.auth, id);
    const doc = env.documents.find((d) => d.id === docId);
    if (!doc) throw notFound('Document');
    const useFinal = version !== 'original' && doc.finalKey;
    const buf = await getObject(useFinal ? doc.finalKey! : doc.storageKey);
    const filename = useFinal ? doc.name.replace(/\.pdf$/i, '') + ' (signed).pdf' : doc.name;
    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
    return buf;
  });

  app.get('/envelopes/:id/certificate', async (req, reply) => {
    const { id } = req.params as { id: string };
    const env = await getVisibleEnvelope(req.auth, id);
    if (!env.certificateKey) throw notFound('Certificate');
    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="certificate-${env.id}.pdf"`);
    return getObject(env.certificateKey);
  });

  /** Upserts recipients by id; recipients missing from the list are removed with their fields. */
  app.put('/envelopes/:id/recipients', async (req) => {
    const { id } = req.params as { id: string };
    const env = await getVisibleEnvelope(req.auth, id);
    assertDraft(env);
    const list = parse(recipientsInput, req.body);
    const emails = list.map((r) => `${r.role}:${r.email}`);
    if (new Set(emails).size !== emails.length) throw badRequest('Each recipient email can appear only once per role.');
    const existingIds = new Set(env.recipients.map((r) => r.id));
    await prisma.$transaction(async (tx) => {
      const keep = list.filter((r) => r.id && existingIds.has(r.id)).map((r) => r.id!);
      await tx.recipient.deleteMany({ where: { envelopeId: id, id: { notIn: keep } } });
      for (const r of list) {
        if (r.inPerson && (r.role !== 'SIGNER' || !req.auth.userId)) throw badRequest('Only signers can sign in person, hosted by a user.');
        if ((r.authMethod === 'SMS_OTP' || r.authMethod === 'WHATSAPP_OTP') && !r.phone) {
          throw badRequest(`Add a mobile number for ${r.name} to send codes by ${r.authMethod === 'SMS_OTP' ? 'SMS' : 'WhatsApp'}.`);
        }
        const existing = r.id && existingIds.has(r.id) ? env.recipients.find((x) => x.id === r.id) : undefined;
        if (r.authMethod === 'ACCESS_CODE' && !r.accessCode && !existing?.accessCodeHash) {
          throw badRequest(`Set an access code for ${r.name}.`);
        }
        if (r.embedded && r.inPerson) throw badRequest('A recipient can be embedded or in person, not both.');
        const data = {
          name: r.name,
          email: r.email,
          role: r.role,
          routingOrder: r.routingOrder,
          locale: r.locale,
          hostUserId: r.inPerson ? req.auth.userId : null,
          // Embedded and in-person identity is established by the app or the host
          authMethod: r.embedded || r.inPerson ? ('NONE' as const) : r.authMethod,
          phone: r.phone ?? null,
          embedded: r.embedded,
          clientUserId: r.clientUserId ?? null,
          signatureMethod: r.role === 'SIGNER' ? r.signatureMethod : ('ELECTRONIC' as const),
        };
        const codeHash = (rid: string) => (r.accessCode ? { accessCodeHash: sha256Hex(`${rid}:${r.accessCode}`) } : {});
        if (existing) {
          await tx.recipient.update({ where: { id: existing.id }, data: { ...data, ...codeHash(existing.id) } });
        } else {
          const created = await tx.recipient.create({ data: { ...data, envelopeId: id } });
          if (r.accessCode) await tx.recipient.update({ where: { id: created.id }, data: codeHash(created.id) });
        }
      }
      // CC recipients and approvers don't fill in fields
      await tx.field.deleteMany({ where: { envelopeId: id, recipient: { role: { in: ['CC', 'APPROVER'] } } } });
    });
    return serializeEnvelope(await getVisibleEnvelope(req.auth, id));
  });

  /** Replaces all fields. */
  app.put('/envelopes/:id/fields', async (req) => {
    const { id } = req.params as { id: string };
    const env = await getVisibleEnvelope(req.auth, id);
    assertDraft(env);
    const list = parse(fieldsInput, req.body);
    const docs = new Map(env.documents.map((d) => [d.id, d]));
    const signers = new Set(env.recipients.filter((r) => r.role === 'SIGNER').map((r) => r.id));
    for (const f of list) {
      const doc = docs.get(f.documentId);
      if (!doc) throw badRequest(`Unknown document ${f.documentId}`);
      if (f.page >= doc.pageCount) throw badRequest(`Page ${f.page + 1} does not exist in ${doc.name}`);
      if (!signers.has(f.recipientId)) throw badRequest('Fields can only be assigned to signers of this envelope.');
      if (f.x + f.width > 1.001 || f.y + f.height > 1.001) throw badRequest('A field extends beyond the page.');
      if ((f.type === 'DROPDOWN' || f.type === 'RADIO') && f.options.length < 2) {
        throw badRequest(`${f.label ?? f.type} needs at least two options.`);
      }
      if (f.type === 'FORMULA') {
        if (!f.formula) throw badRequest('Formula fields need a formula.');
        try {
          for (const ref of formulaRefs(f.formula)) {
            if (!list.some((g) => g.type === 'NUMBER' && g.label === ref)) throw new Error(`no number field labelled "${ref}"`);
          }
        } catch (err) {
          throw badRequest(`Formula "${f.formula}": ${(err as Error).message}`);
        }
      }
      if (f.type === 'PAYMENT' && (!f.amount || !f.currency)) throw badRequest('Payment fields need an amount and a currency.');
      if (f.condition && !list.some((g) => g.label === f.condition!.fieldLabel)) {
        throw badRequest(`Condition refers to a field labelled "${f.condition.fieldLabel}" that doesn't exist.`);
      }
    }
    const labels = list.filter((f) => f.label).map((f) => f.label);
    if (new Set(labels).size !== labels.length) throw badRequest('Field labels must be unique so formulas and conditions can refer to them.');
    await prisma.$transaction([
      prisma.field.deleteMany({ where: { envelopeId: id } }),
      prisma.field.createMany({
        data: list.map((f) => ({
          ...f,
          label: f.label ?? null,
          formula: f.type === 'FORMULA' ? f.formula! : null,
          condition: f.condition ?? undefined,
          amount: f.type === 'PAYMENT' ? f.amount! : null,
          currency: f.type === 'PAYMENT' ? f.currency! : null,
          envelopeId: id,
        })),
      }),
    ]);
    return serializeEnvelope(await getVisibleEnvelope(req.auth, id));
  });

  app.post('/envelopes/:id/send', async (req) => {
    const { id } = req.params as { id: string };
    await getVisibleEnvelope(req.auth, id);
    return serializeEnvelope(await sendEnvelope(req.auth.orgId, id, req.auth.actor, clientInfo(req)));
  });

  app.post('/envelopes/:id/void', async (req) => {
    const { id } = req.params as { id: string };
    const { reason } = parse(z.object({ reason: z.string().trim().min(1).max(500) }), req.body);
    await getVisibleEnvelope(req.auth, id);
    return serializeEnvelope(await voidEnvelope(req.auth.orgId, id, reason, req.auth.actor, clientInfo(req)));
  });

  app.post('/envelopes/:id/remind', async (req) => {
    const { id } = req.params as { id: string };
    const env = await getVisibleEnvelope(req.auth, id);
    if (env.status !== 'SENT') throw conflict('Only envelopes that are out for signature can be reminded.');
    const pending = env.recipients.filter((r) => r.role !== 'CC' && (r.status === 'SENT' || r.status === 'VIEWED'));
    await notifySigners(env, pending, 'reminder');
    return { reminded: pending.map((r) => r.email) };
  });

  app.get('/envelopes/:id/audit', async (req) => {
    const { id } = req.params as { id: string };
    await getVisibleEnvelope(req.auth, id);
    const [events, chain] = await Promise.all([
      prisma.auditEvent.findMany({ where: { envelopeId: id }, orderBy: { seq: 'asc' } }),
      verifyChain(id),
    ]);
    return { chain, events };
  });

  /** Duplicate an envelope (documents, recipients, fields) into a new draft. */
  app.post('/envelopes/:id/duplicate', async (req, reply) => {
    const { id } = req.params as { id: string };
    const src = await getVisibleEnvelope(req.auth, id);
    if (!req.auth.userId) throw badRequest('The organisation has no owner to attribute this envelope to.');
    const copy = await prisma.$transaction(async (tx) => {
      const env = await tx.envelope.create({
        data: {
          orgId: src.orgId,
          createdById: req.auth.userId!,
          title: `${src.title} (copy)`,
          message: src.message,
          jurisdiction: src.jurisdiction,
          documentType: src.documentType,
          routing: src.routing,
          reminderDays: src.reminderDays,
        },
      });
      const docMap = new Map<string, string>();
      for (const d of src.documents) {
        const nd = await tx.document.create({
          data: {
            envelopeId: env.id,
            name: d.name,
            order: d.order,
            storageKey: '',
            sha256: d.sha256,
            pageCount: d.pageCount,
            pages: d.pages as object,
          },
        });
        const storageKey = `envelopes/${env.id}/original/${nd.id}.pdf`;
        await putObject(storageKey, await getObject(d.storageKey), 'application/pdf');
        await tx.document.update({ where: { id: nd.id }, data: { storageKey } });
        docMap.set(d.id, nd.id);
      }
      const recMap = new Map<string, string>();
      for (const r of src.recipients) {
        const nr = await tx.recipient.create({
          data: { envelopeId: env.id, name: r.name, email: r.email, role: r.role, routingOrder: r.routingOrder, locale: r.locale, hostUserId: r.hostUserId },
        });
        recMap.set(r.id, nr.id);
      }
      await tx.field.createMany({
        data: src.fields.map((f) => ({
          envelopeId: env.id,
          documentId: docMap.get(f.documentId)!,
          recipientId: recMap.get(f.recipientId)!,
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
          condition: f.condition ?? undefined,
          amount: f.amount,
          currency: f.currency,
        })),
      });
      await appendAudit(tx, {
        envelopeId: env.id,
        type: 'envelope.created',
        actor: req.auth.actor,
        data: { title: env.title, duplicatedFrom: src.id },
        ...clientInfo(req),
      });
      return env;
    }, { timeout: 60_000 });
    reply.code(201);
    return serializeEnvelope(await getVisibleEnvelope(req.auth, copy.id));
  });
}
