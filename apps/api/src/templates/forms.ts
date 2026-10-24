import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { sendEnvelope } from '../envelopes/service.js';
import { SUPPORTED_LOCALES } from '../i18n/messages.js';
import { logActivity } from '../lib/activity.js';
import { clientInfo, requireAuth, signingToken } from '../lib/auth.js';
import { randomToken } from '../lib/crypto.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { getBranding } from '../organization/branding.js';
import { createEnvelopeFromTemplate, getTemplate } from './service.js';

/**
 * Self-serve signing links ("web forms"): a public URL where anyone can sign
 * their own copy of a single-signer template. Identity is still checked by the
 * normal one-time code before signing.
 */
export async function formRoutes(app: FastifyInstance) {
  // --- Public --------------------------------------------------------------
  app.get('/f/:slug', async (req) => {
    const { slug } = req.params as { slug: string };
    const form = await prisma.signingForm.findUnique({ where: { slug } });
    if (!form || !form.active) throw notFound('Signing form');
    const template = await prisma.template.findUnique({ where: { id: form.templateId }, select: { title: true, message: true } });
    if (!template) throw notFound('Signing form');
    return {
      name: form.name,
      title: template.title,
      message: template.message,
      branding: await getBranding(form.orgId),
      full: form.maxUses !== null && form.uses >= form.maxUses,
    };
  });

  app.post('/f/:slug', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(120),
        email: z.string().trim().toLowerCase().email(),
        locale: z.enum(SUPPORTED_LOCALES as [string, ...string[]]).default('en'),
      }),
      req.body,
    );
    const form = await prisma.signingForm.findUnique({ where: { slug } });
    if (!form || !form.active) throw notFound('Signing form');
    // Atomic use counter so maxUses can't be exceeded by parallel submissions
    const claimed = await prisma.signingForm.updateMany({
      where: { id: form.id, active: true, ...(form.maxUses !== null ? { uses: { lt: form.maxUses } } : {}) },
      data: { uses: { increment: 1 } },
    });
    if (claimed.count === 0) throw conflict('This signing link has reached its limit.');

    const template = await getTemplate(form.orgId, form.templateId);
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: template.createdById } });
    const actor = { kind: 'system' as const };
    const envelopeId = await createEnvelopeFromTemplate(
      template,
      { orgId: form.orgId, userId: owner.id, actor, ...clientInfo(req) },
      { recipients: [{ roleId: template.roles[0].id, name: body.name, email: body.email, locale: body.locale }] },
    );
    await prisma.envelope.update({ where: { id: envelopeId }, data: { formId: form.id } });
    const env = await sendEnvelope(form.orgId, envelopeId, actor, clientInfo(req));
    const signer = env.recipients[0];
    reply.code(201);
    return { signPath: `/sign/${signingToken(signer)}` };
  });

  // --- Management ----------------------------------------------------------
  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);

    r.get('/forms', async (req) => {
      const forms = await prisma.signingForm.findMany({ where: { orgId: req.auth.orgId }, orderBy: { createdAt: 'desc' } });
      const templates = await prisma.template.findMany({ where: { id: { in: forms.map((f) => f.templateId) } }, select: { id: true, name: true } });
      const names = new Map(templates.map((t) => [t.id, t.name]));
      return forms.map((f) => ({ ...f, templateName: names.get(f.templateId) ?? '(deleted template)' }));
    });

    r.post('/forms', async (req, reply) => {
      const body = parse(
        z.object({ templateId: z.string(), name: z.string().trim().min(1).max(120), maxUses: z.number().int().min(1).max(100_000).nullish() }),
        req.body,
      );
      const template = await getTemplate(req.auth.orgId, body.templateId);
      if (template.roles.length !== 1 || template.roles[0].role !== 'SIGNER') {
        throw badRequest('Signing links work with templates that have exactly one signer and no other recipients.');
      }
      const form = await prisma.signingForm.create({
        data: { orgId: req.auth.orgId, templateId: template.id, name: body.name, maxUses: body.maxUses ?? null, slug: randomToken(9) },
      });
      await logActivity(req, 'form.created', { id: form.id, name: form.name });
      reply.code(201);
      return form;
    });

    r.patch('/forms/:id', async (req) => {
      const { id } = req.params as { id: string };
      const body = parse(
        z.object({ name: z.string().trim().min(1).max(120).optional(), active: z.boolean().optional(), maxUses: z.number().int().min(1).nullable().optional() }),
        req.body,
      );
      const res = await prisma.signingForm.updateMany({ where: { id, orgId: req.auth.orgId }, data: body });
      if (res.count === 0) throw notFound('Signing form');
      return prisma.signingForm.findUniqueOrThrow({ where: { id } });
    });

    r.delete('/forms/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const res = await prisma.signingForm.deleteMany({ where: { id, orgId: req.auth.orgId } });
      if (res.count === 0) throw notFound('Signing form');
      reply.code(204);
    });
  });
}
