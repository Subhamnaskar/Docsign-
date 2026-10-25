import type { Comment } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { appendAudit } from '../audit/audit.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { ingestDocument, MAX_UPLOAD_BYTES } from '../documents/ingest.js';
import { isIncremental } from '../esign/service.js';
import { getVisibleEnvelope } from '../envelopes/service.js';
import { clientInfo, requireAuth, signingUrl } from '../lib/auth.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { layout, sendMail } from '../lib/mailer.js';
import { getObject, putObject } from '../lib/storage.js';
import { parse } from '../lib/validate.js';
import { actorOf, loadByToken, requireSession } from '../signing/routes.js';

/**
 * Negotiation before signing: comments pinned to a document page, and
 * revised versions of a document uploaded by the sender while nobody has
 * signed yet. Every comment and revision is part of the audit trail.
 */

const commentInput = z.object({
  body: z.string().trim().min(1).max(4000),
  documentId: z.string().optional(),
  page: z.number().int().min(0).optional(),
  x: z.number().min(0).max(1).optional(),
  y: z.number().min(0).max(1).optional(),
  parentId: z.string().optional(),
});

const serialize = (c: Comment) => ({
  id: c.id,
  documentId: c.documentId,
  page: c.page,
  x: c.x,
  y: c.y,
  authorKind: c.authorKind,
  authorName: c.authorName,
  body: c.body,
  parentId: c.parentId,
  resolved: Boolean(c.resolvedAt),
  createdAt: c.createdAt,
});

const OPEN_STATUSES = ['DRAFT', 'SENT'];

async function addComment(
  envelopeId: string,
  author: { kind: 'user' | 'recipient'; id: string; name: string },
  input: z.infer<typeof commentInput>,
  actor: Parameters<typeof appendAudit>[1]['actor'],
  client: { ip?: string | null; userAgent?: string | null },
) {
  if (input.documentId && !(await prisma.document.findFirst({ where: { id: input.documentId, envelopeId } }))) throw badRequest('Unknown document.');
  if (input.parentId && !(await prisma.comment.findFirst({ where: { id: input.parentId, envelopeId } }))) throw badRequest('Unknown comment.');
  return prisma.$transaction(async (tx) => {
    const c = await tx.comment.create({
      data: { envelopeId, authorKind: author.kind, authorId: author.id, authorName: author.name, body: input.body, documentId: input.documentId, page: input.page, x: input.x, y: input.y, parentId: input.parentId },
    });
    await appendAudit(tx, {
      envelopeId,
      type: 'comment.added',
      actor,
      data: { commentId: c.id, documentId: input.documentId ?? null, page: input.page ?? null, excerpt: input.body.slice(0, 200) },
      ...client,
    });
    return c;
  });
}

export async function negotiationRoutes(app: FastifyInstance) {
  // --- Signers ------------------------------------------------------------------

  app.get('/signing/:token/comments', async (req) => {
    const { token } = req.params as { token: string };
    const r = await loadByToken(token);
    requireSession(req, r);
    const rows = await prisma.comment.findMany({ where: { envelopeId: r.envelopeId }, orderBy: { createdAt: 'asc' } });
    return rows.map(serialize);
  });

  app.post('/signing/:token/comments', { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const { token } = req.params as { token: string };
    const body = parse(commentInput, req.body);
    const r = await loadByToken(token);
    requireSession(req, r);
    if (!OPEN_STATUSES.includes(r.envelope.status) || r.status === 'SIGNED') throw conflict('Comments are closed for this agreement.');
    const c = await addComment(r.envelopeId, { kind: 'recipient', id: r.id, name: r.name }, body, actorOf(r), clientInfo(req));
    const { html, text } = layout({
      heading: `${r.name} commented on "${r.envelope.title}"`,
      paragraphs: [`"${body.body.slice(0, 500)}"`, 'Reply in the agreement, or upload a revised document if changes are needed.'],
      button: { label: 'View comments', url: `${config.appUrl}/envelopes/${r.envelopeId}` },
    });
    await sendMail({ to: r.envelope.createdBy.email, subject: `New comment on ${r.envelope.title}`, html, text }).catch(() => {});
    reply.code(201);
    return serialize(c);
  });

  // --- Senders ------------------------------------------------------------------

  await app.register(async (s) => {
    s.addHook('preHandler', requireAuth);

    s.get('/envelopes/:id/comments', async (req) => {
      const { id } = req.params as { id: string };
      const env = await getVisibleEnvelope(req.auth, id);
      const rows = await prisma.comment.findMany({ where: { envelopeId: env.id }, orderBy: { createdAt: 'asc' } });
      return rows.map(serialize);
    });

    s.post('/envelopes/:id/comments', async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = parse(commentInput, req.body);
      const env = await getVisibleEnvelope(req.auth, id);
      if (!OPEN_STATUSES.includes(env.status)) throw conflict('Comments are closed for this agreement.');
      const actor = req.auth.actor;
      const name = actor.kind === 'user' ? actor.name : actor.kind === 'api_key' ? actor.name : 'Sender';
      const c = await addComment(env.id, { kind: 'user', id: req.auth.userId ?? 'api', name }, body, actor, clientInfo(req));
      // A reply to a signer's comment goes to that signer
      const parent = body.parentId ? await prisma.comment.findUnique({ where: { id: body.parentId } }) : null;
      const signer = parent?.authorKind === 'recipient' ? env.recipients.find((x) => x.id === parent.authorId) : null;
      if (signer && !signer.embedded) {
        const { html, text } = layout({
          heading: `${name} replied to your comment`,
          paragraphs: [`"${body.body.slice(0, 500)}"`],
          button: { label: 'Open the agreement', url: signingUrl(signer) },
        });
        await sendMail({ to: signer.email, subject: `Reply on ${env.title}`, html, text }).catch(() => {});
      }
      reply.code(201);
      return serialize(c);
    });

    s.patch('/envelopes/:id/comments/:commentId', async (req) => {
      const { id, commentId } = req.params as { id: string; commentId: string };
      const { resolved } = parse(z.object({ resolved: z.boolean() }), req.body);
      const env = await getVisibleEnvelope(req.auth, id);
      const res = await prisma.comment.updateMany({ where: { id: commentId, envelopeId: env.id }, data: { resolvedAt: resolved ? new Date() : null } });
      if (!res.count) throw notFound('Comment');
      return serialize(await prisma.comment.findUniqueOrThrow({ where: { id: commentId } }));
    });

    /**
     * Replaces a document with a revised version while the agreement is out
     * for signature and nobody has signed yet. Signers are told to review it again.
     */
    s.post('/envelopes/:id/documents/:docId/revise', async (req) => {
      const { id, docId } = req.params as { id: string; docId: string };
      const env = await getVisibleEnvelope(req.auth, id);
      if (env.status !== 'SENT') throw conflict('Only agreements out for signature can be revised. Edit drafts directly.');
      if (env.recipients.some((r) => r.status === 'SIGNED')) throw conflict('Someone has already signed. Void the agreement and send a new one instead.');
      if (isIncremental(env.recipients)) throw conflict('Agreements signed with Aadhaar eSign or DSC cannot be revised in place. Void and send a new one.');
      const doc = env.documents.find((d) => d.id === docId);
      if (!doc) throw notFound('Document');

      const file = await req.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
      if (!file) throw badRequest('Attach the revised file in the "file" field.');
      const data = await file.toBuffer();
      if (file.file.truncated) throw badRequest('Files are limited to 25 MB.');
      const reasonField = (file.fields as Record<string, { value?: string }>).reason?.value?.slice(0, 500) ?? null;
      const ingested = await ingestDocument(file.filename, data);
      const lost = env.fields.filter((f) => f.documentId === doc.id && f.page >= ingested.pageCount);
      if (lost.length) throw badRequest(`The revised document has ${ingested.pageCount} pages, but fields are placed on page ${lost[0].page + 1}. Keep the page count or edit the fields first.`);

      const version = doc.version + 1;
      const storageKey = `envelopes/${env.id}/original/${doc.id}-v${version}.pdf`;
      await putObject(storageKey, ingested.pdf, 'application/pdf');
      await prisma.$transaction(async (tx) => {
        await tx.documentVersion.create({ data: { documentId: doc.id, version: doc.version, storageKey: doc.storageKey, sha256: doc.sha256, pageCount: doc.pageCount } });
        await tx.document.update({ where: { id: doc.id }, data: { storageKey, sha256: ingested.sha256, pageCount: ingested.pageCount, pages: ingested.pages, version } });
        await appendAudit(tx, {
          envelopeId: env.id,
          type: 'document.revised',
          actor: req.auth.actor,
          data: { documentId: doc.id, version, previousSha256: doc.sha256, sha256: ingested.sha256, pages: ingested.pageCount, reason: reasonField },
          ...clientInfo(req),
        });
      });

      // Everyone who can still act is asked to look again
      const notify = env.recipients.filter((r) => r.role !== 'CC' && (r.status === 'SENT' || r.status === 'VIEWED') && !r.embedded);
      for (const r of notify) {
        const { html, text } = layout({
          heading: `"${env.title}" was updated`,
          paragraphs: [`The sender uploaded a revised version of ${doc.name}.${reasonField ? ` Note: ${reasonField}` : ''}`, 'Please review the new version before signing.'],
          button: { label: 'Review and sign', url: signingUrl(r) },
        });
        await sendMail({ to: r.email, subject: `Updated: ${env.title}`, html, text }).catch(() => {});
      }
      return { id: doc.id, version, sha256: ingested.sha256, pageCount: ingested.pageCount, notified: notify.length };
    });

    s.get('/envelopes/:id/documents/:docId/versions', async (req) => {
      const { id, docId } = req.params as { id: string; docId: string };
      const env = await getVisibleEnvelope(req.auth, id);
      const doc = env.documents.find((d) => d.id === docId);
      if (!doc) throw notFound('Document');
      const older = await prisma.documentVersion.findMany({ where: { documentId: doc.id }, orderBy: { version: 'asc' } });
      return [
        ...older.map((v) => ({ version: v.version, sha256: v.sha256, pageCount: v.pageCount, createdAt: v.createdAt, current: false })),
        { version: doc.version, sha256: doc.sha256, pageCount: doc.pageCount, createdAt: null, current: true },
      ];
    });

    s.get('/envelopes/:id/documents/:docId/versions/:version/file', async (req, reply) => {
      const { id, docId, version } = req.params as { id: string; docId: string; version: string };
      const env = await getVisibleEnvelope(req.auth, id);
      const doc = env.documents.find((d) => d.id === docId);
      if (!doc) throw notFound('Document');
      const v = Number(version) === doc.version ? doc : await prisma.documentVersion.findFirst({ where: { documentId: doc.id, version: Number(version) } });
      if (!v) throw notFound('Version');
      reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename="${doc.name.replace(/\.pdf$/i, '')}-v${version}.pdf"`);
      return getObject(v.storageKey);
    });
  });
}
