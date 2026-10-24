import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { serializeEnvelope } from '../envelopes/routes.js';
import { getEnvelope, sendEnvelope } from '../envelopes/service.js';
import { SUPPORTED_LOCALES } from '../i18n/messages.js';
import { clientInfo, requireAuth } from '../lib/auth.js';
import { badRequest, notFound, unprocessable } from '../lib/errors.js';
import { getObject } from '../lib/storage.js';
import { parse } from '../lib/validate.js';
import {
  checkAssignments,
  createEnvelopeFromTemplate,
  createTemplateFromEnvelope,
  getTemplate,
  type FullTemplate,
} from './service.js';

export const MAX_BULK_ROWS = 100;

const assignment = z.object({
  roleId: z.string(),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  locale: z.enum(SUPPORTED_LOCALES as [string, ...string[]]).optional(),
});

function serializeTemplate(t: FullTemplate) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    title: t.title,
    message: t.message,
    jurisdiction: t.jurisdiction,
    documentType: t.documentType,
    routing: t.routing,
    reminderDays: t.reminderDays,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    documents: t.documents.map((d) => ({ id: d.id, name: d.name, order: d.order, pageCount: d.pageCount, pages: d.pages, sha256: d.sha256 })),
    roles: t.roles.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      routingOrder: r.routingOrder,
      fieldCount: t.fields.filter((f) => f.roleId === r.id).length,
    })),
    fields: t.fields.map((f) => ({
      id: f.id,
      documentId: f.documentId,
      roleId: f.roleId,
      type: f.type,
      page: f.page,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      required: f.required,
      label: f.label,
    })),
  };
}

export async function templateRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/templates', async (req) => {
    const list = await prisma.template.findMany({
      where: { orgId: req.auth.orgId },
      orderBy: { updatedAt: 'desc' },
      include: { roles: { orderBy: { routingOrder: 'asc' } }, _count: { select: { documents: true } } },
    });
    return list.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      jurisdiction: t.jurisdiction,
      updatedAt: t.updatedAt,
      documentCount: t._count.documents,
      roles: t.roles.map((r) => ({ id: r.id, name: r.name, role: r.role })),
    }));
  });

  app.get('/templates/:id', async (req) => {
    const { id } = req.params as { id: string };
    return serializeTemplate(await getTemplate(req.auth.orgId, id));
  });

  app.get('/templates/:id/documents/:docId/file', async (req, reply) => {
    const { id, docId } = req.params as { id: string; docId: string };
    const t = await getTemplate(req.auth.orgId, id);
    const doc = t.documents.find((d) => d.id === docId);
    if (!doc) throw notFound('Document');
    reply.header('Content-Type', 'application/pdf');
    return getObject(doc.storageKey);
  });

  app.post('/envelopes/:id/save-as-template', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(500).nullish(),
        /** recipientId → role name, e.g. { "rcp_1": "Employee" } */
        roleNames: z.record(z.string(), z.string().max(60)).optional(),
      }),
      req.body,
    );
    if (!req.auth.userId) throw badRequest('The organisation has no owner to attribute this template to.');
    reply.code(201);
    return serializeTemplate(await createTemplateFromEnvelope(req.auth.orgId, req.auth.userId, id, body));
  });

  app.patch('/templates/:id', async (req) => {
    const { id } = req.params as { id: string };
    const t = await getTemplate(req.auth.orgId, id);
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(120).optional(),
        description: z.string().trim().max(500).nullish(),
        title: z.string().trim().min(1).max(200).optional(),
        message: z.string().max(2000).nullish(),
        roles: z.array(z.object({ id: z.string(), name: z.string().trim().min(1).max(60) })).optional(),
      }),
      req.body,
    );
    const { roles, ...data } = body;
    await prisma.$transaction(async (tx) => {
      await tx.template.update({ where: { id }, data });
      for (const r of roles ?? []) {
        if (!t.roles.some((x) => x.id === r.id)) throw badRequest(`Unknown role ${r.id}`);
        await tx.templateRole.update({ where: { id: r.id }, data: { name: r.name } });
      }
    });
    return serializeTemplate(await getTemplate(req.auth.orgId, id));
  });

  app.delete('/templates/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await getTemplate(req.auth.orgId, id);
    await prisma.template.delete({ where: { id } });
    reply.code(204);
  });

  /** Create an envelope from a template; `send: true` sends it immediately. */
  app.post('/templates/:id/envelopes', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parse(
      z.object({
        title: z.string().trim().max(200).optional(),
        message: z.string().max(2000).nullish(),
        recipients: z.array(assignment).max(50),
        send: z.boolean().default(false),
      }),
      req.body,
    );
    if (!req.auth.userId) throw badRequest('The organisation has no owner to attribute this envelope to.');
    const t = await getTemplate(req.auth.orgId, id);
    const problems = checkAssignments(t, body.recipients);
    if (problems.length) throw unprocessable('The recipients do not match the template roles.', { problems });
    const ctx = { orgId: req.auth.orgId, userId: req.auth.userId, actor: req.auth.actor, ...clientInfo(req) };
    const envelopeId = await createEnvelopeFromTemplate(t, ctx, body);
    const env = body.send
      ? await sendEnvelope(req.auth.orgId, envelopeId, req.auth.actor, clientInfo(req))
      : await getEnvelope(req.auth.orgId, envelopeId);
    reply.code(201);
    return serializeEnvelope(env);
  });

  /**
   * Bulk send: one envelope per row, each sent immediately. Rows are processed
   * independently, so one bad row doesn't stop the rest.
   */
  app.post('/templates/:id/bulk-send', async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(
      z.object({
        rows: z
          .array(z.object({ title: z.string().trim().max(200).optional(), recipients: z.array(assignment.extend({ name: z.string().max(120), email: z.string().max(254) })) }))
          .min(1)
          .max(MAX_BULK_ROWS, `Bulk send is limited to ${MAX_BULK_ROWS} rows per batch.`),
      }),
      req.body,
    );
    if (!req.auth.userId) throw badRequest('The organisation has no owner to attribute these envelopes to.');
    const t = await getTemplate(req.auth.orgId, id);
    // Load template documents once for the whole batch
    const documentBuffers = await Promise.all(t.documents.map((d) => getObject(d.storageKey)));
    const ctx = { orgId: req.auth.orgId, userId: req.auth.userId, actor: req.auth.actor, ...clientInfo(req) };

    const results: { row: number; envelopeId?: string; error?: string; problems?: string[] }[] = [];
    for (const [i, row] of body.rows.entries()) {
      const problems = checkAssignments(t, row.recipients);
      if (problems.length) {
        results.push({ row: i + 1, error: 'Invalid recipients', problems });
        continue;
      }
      try {
        const envelopeId = await createEnvelopeFromTemplate(t, ctx, { title: row.title, recipients: row.recipients, documentBuffers });
        await sendEnvelope(req.auth.orgId, envelopeId, req.auth.actor, clientInfo(req));
        results.push({ row: i + 1, envelopeId });
      } catch (err) {
        const e = err as Error & { details?: { problems?: string[] } };
        results.push({ row: i + 1, error: e.message, problems: e.details?.problems });
      }
    }
    return {
      sent: results.filter((r) => r.envelopeId).length,
      failed: results.filter((r) => r.error).length,
      results,
    };
  });
}
