import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { logActivity } from '../lib/activity.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { getTemplate } from '../templates/service.js';
import { ACTION_NAMES, actionSchema, CONDITION_FIELDS, conditionSchema, type Action, TRIGGERS } from './engine.js';

const workflowInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullish(),
  enabled: z.boolean().default(true),
  trigger: z.enum(Object.keys(TRIGGERS) as [keyof typeof TRIGGERS, ...(keyof typeof TRIGGERS)[]]),
  conditions: z.array(conditionSchema).max(10).default([]),
  actions: z.array(actionSchema).min(1, 'Add at least one action').max(10),
});

/** Checks that folders and templates named in actions belong to the organisation. */
async function checkActions(orgId: string, actions: Action[]) {
  for (const a of actions) {
    if (a.type === 'move_to_folder' && !(await prisma.folder.findFirst({ where: { id: a.folderId, orgId } }))) throw badRequest('Choose one of your folders.');
    if (a.type === 'send_template') await getTemplate(orgId, a.templateId);
  }
}

/** Automation rules. Admins manage them; everyone can see them. */
export async function workflowRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  const admin = { preHandler: requireRole('OWNER', 'ADMIN') };

  /** What the builder offers: triggers, condition fields, actions, and the org's templates and folders. */
  app.get('/workflows/options', async (req) => {
    const [templates, folders, departments] = await Promise.all([
      prisma.template.findMany({ where: { orgId: req.auth.orgId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.folder.findMany({ where: { orgId: req.auth.orgId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.department.findMany({ where: { orgId: req.auth.orgId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    return {
      triggers: Object.entries(TRIGGERS).map(([id, name]) => ({ id, name })),
      conditionFields: Object.entries(CONDITION_FIELDS).map(([id, name]) => ({ id, name })),
      actions: Object.entries(ACTION_NAMES).map(([id, name]) => ({ id, name })),
      templates,
      folders,
      departments,
    };
  });

  app.get('/workflows', async (req) => {
    const workflows = await prisma.workflow.findMany({ where: { orgId: req.auth.orgId }, orderBy: { createdAt: 'desc' } });
    const failing = await prisma.workflowRun.groupBy({ by: ['workflowId'], where: { orgId: req.auth.orgId, status: 'FAILED', createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, _count: true });
    return { workflows: workflows.map((w) => ({ ...w, failedThisWeek: failing.find((f) => f.workflowId === w.id)?._count ?? 0 })) };
  });

  app.get('/workflows/:id', async (req) => {
    const w = await prisma.workflow.findFirst({ where: { id: (req.params as { id: string }).id, orgId: req.auth.orgId } });
    if (!w) throw notFound('Workflow');
    const runs = await prisma.workflowRun.findMany({ where: { workflowId: w.id }, orderBy: { createdAt: 'desc' }, take: 50 });
    const titles = await prisma.envelope.findMany({ where: { id: { in: runs.map((r) => r.envelopeId).filter((x): x is string => Boolean(x)) } }, select: { id: true, title: true } });
    return {
      ...w,
      runs: runs.map((r) => ({
        id: r.id,
        event: r.event,
        status: r.status,
        attempts: r.attempts,
        results: r.results,
        error: r.error,
        createdAt: r.createdAt,
        finishedAt: r.finishedAt,
        envelope: r.envelopeId ? { id: r.envelopeId, title: titles.find((t) => t.id === r.envelopeId)?.title ?? 'Deleted agreement' } : null,
      })),
    };
  });

  app.post('/workflows', admin, async (req, reply) => {
    const body = parse(workflowInput, req.body);
    await checkActions(req.auth.orgId, body.actions);
    const w = await prisma.workflow.create({
      data: { ...body, conditions: body.conditions as Prisma.JsonArray, actions: body.actions as Prisma.JsonArray, orgId: req.auth.orgId, createdById: req.auth.userId },
    });
    await logActivity(req, 'workflow.created', { id: w.id, name: w.name });
    reply.code(201);
    return w;
  });

  app.put('/workflows/:id', admin, async (req) => {
    const id = (req.params as { id: string }).id;
    if (!(await prisma.workflow.findFirst({ where: { id, orgId: req.auth.orgId } }))) throw notFound('Workflow');
    const body = parse(workflowInput, req.body);
    await checkActions(req.auth.orgId, body.actions);
    const w = await prisma.workflow.update({ where: { id }, data: { ...body, conditions: body.conditions as Prisma.JsonArray, actions: body.actions as Prisma.JsonArray } });
    await logActivity(req, 'workflow.updated', { id, name: w.name });
    return w;
  });

  app.patch('/workflows/:id', admin, async (req) => {
    const id = (req.params as { id: string }).id;
    const { enabled } = parse(z.object({ enabled: z.boolean() }), req.body);
    const { count } = await prisma.workflow.updateMany({ where: { id, orgId: req.auth.orgId }, data: { enabled } });
    if (!count) throw notFound('Workflow');
    await logActivity(req, enabled ? 'workflow.enabled' : 'workflow.disabled', { id });
    return { enabled };
  });

  app.delete('/workflows/:id', admin, async (req) => {
    const id = (req.params as { id: string }).id;
    const { count } = await prisma.workflow.deleteMany({ where: { id, orgId: req.auth.orgId } });
    if (!count) throw notFound('Workflow');
    await logActivity(req, 'workflow.deleted', { id });
    return { ok: true };
  });

  /** Runs a workflow now against an agreement (ignores trigger and conditions) to check the actions. */
  app.post('/workflows/:id/test', admin, async (req) => {
    const id = (req.params as { id: string }).id;
    const { envelopeId } = parse(z.object({ envelopeId: z.string() }), req.body);
    const w = await prisma.workflow.findFirst({ where: { id, orgId: req.auth.orgId } });
    if (!w) throw notFound('Workflow');
    const env = await prisma.envelope.findFirst({ where: { id: envelopeId, orgId: req.auth.orgId }, select: { id: true, title: true } });
    if (!env) throw notFound('Agreement');
    const run = await prisma.workflowRun.create({ data: { workflowId: w.id, orgId: req.auth.orgId, envelopeId: env.id, event: w.trigger, data: { envelopeId: env.id, title: env.title, test: true } } });
    return { runId: run.id };
  });
}
