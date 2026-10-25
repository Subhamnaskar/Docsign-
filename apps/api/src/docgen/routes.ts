import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { appendAudit } from '../audit/audit.js';
import { prisma } from '../db.js';
import { addDocument } from '../envelopes/documents.js';
import { assertDraft, getVisibleEnvelope } from '../envelopes/service.js';
import { logActivity } from '../lib/activity.js';
import { clientInfo, requireAuth } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { assertClean } from '../lib/malware.js';
import { getObject, putObject } from '../lib/storage.js';
import { parse } from '../lib/validate.js';
import { fillTemplate, templateVariables } from './engine.js';

const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;

export async function docgenRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/doc-templates', async (req) =>
    prisma.docTemplate.findMany({ where: { orgId: req.auth.orgId }, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, variables: true, createdAt: true } }),
  );

  /** Upload a .docx containing {{placeholders}}. */
  app.post('/doc-templates', async (req, reply) => {
    const file = await req.file({ limits: { fileSize: MAX_TEMPLATE_BYTES } });
    if (!file) throw badRequest('Attach a .docx file in the "file" field.');
    const data = await file.toBuffer();
    if (file.file.truncated) throw badRequest('Templates are limited to 10 MB.');
    if (!/\.docx$/i.test(file.filename)) throw badRequest('Upload a Word document (.docx).');
    await assertClean(file.filename, data);
    const variables = templateVariables(data);
    if (!variables.length) throw badRequest('No {{placeholders}} found. Add fields like {{Client name}} to the document.');
    const fields = (file.fields as Record<string, { value?: string }>) ?? {};
    const name = (fields.name?.value || file.filename.replace(/\.docx$/i, '')).slice(0, 120);
    const tpl = await prisma.docTemplate.create({ data: { orgId: req.auth.orgId, name, storageKey: '', variables, createdById: req.auth.userId ?? '' } });
    const storageKey = `doc-templates/${req.auth.orgId}/${tpl.id}.docx`;
    await putObject(storageKey, data, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    await prisma.docTemplate.update({ where: { id: tpl.id }, data: { storageKey } });
    await logActivity(req, 'doc_template.created', { id: tpl.id, name });
    reply.code(201);
    return { id: tpl.id, name, variables, createdAt: tpl.createdAt };
  });

  app.delete('/doc-templates/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const res = await prisma.docTemplate.deleteMany({ where: { id, orgId: req.auth.orgId } });
    if (!res.count) throw notFound('Template');
    reply.code(204);
  });

  /** Download the original Word file (to edit and upload again). */
  app.get('/doc-templates/:id/file', async (req, reply) => {
    const { id } = req.params as { id: string };
    const tpl = await prisma.docTemplate.findFirst({ where: { id, orgId: req.auth.orgId } });
    if (!tpl) throw notFound('Template');
    reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('Content-Disposition', `attachment; filename="${tpl.name.replace(/[^\w .-]/g, '_')}.docx"`);
    return getObject(tpl.storageKey);
  });

  /**
   * Fills the template and adds the result (as PDF) to a draft agreement,
   * creating one when no envelopeId is given.
   */
  app.post('/doc-templates/:id/generate', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parse(
      z.object({
        data: z.record(z.string(), z.union([z.string().max(5000), z.number(), z.boolean(), z.array(z.record(z.string(), z.any())).max(500)])),
        envelopeId: z.string().optional(),
        title: z.string().trim().min(1).max(200).optional(),
        filename: z.string().trim().min(1).max(120).optional(),
      }),
      req.body,
    );
    const tpl = await prisma.docTemplate.findFirst({ where: { id, orgId: req.auth.orgId } });
    if (!tpl) throw notFound('Template');
    const filled = fillTemplate(await getObject(tpl.storageKey), body.data);

    let envelopeId = body.envelopeId;
    if (!envelopeId) {
      if (!req.auth.userId) throw badRequest('The organisation has no owner to attribute this agreement to.');
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.auth.orgId } });
      const created = await prisma.$transaction(async (tx) => {
        const env = await tx.envelope.create({
          data: { orgId: org.id, createdById: req.auth.userId!, title: body.title ?? tpl.name, jurisdiction: org.jurisdiction },
        });
        await appendAudit(tx, { envelopeId: env.id, type: 'envelope.created', actor: req.auth.actor, data: { title: env.title, fromDocTemplate: tpl.id }, ...clientInfo(req) });
        return env;
      });
      envelopeId = created.id;
    }
    const env = await getVisibleEnvelope(req.auth, envelopeId);
    assertDraft(env);
    const doc = await addDocument(env, `${body.filename ?? tpl.name}.docx`, filled, req.auth.actor, clientInfo(req), { generatedFrom: { templateId: tpl.id, name: tpl.name } });
    reply.code(201);
    return { envelopeId: env.id, document: { id: doc.id, name: doc.name, pageCount: doc.pageCount, sha256: doc.sha256 } };
  });
}
