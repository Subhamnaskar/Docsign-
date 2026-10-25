import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { envelopeScope } from '../envelopes/service.js';
import { requireAuth } from '../lib/auth.js';

const DAY_MS = 86_400_000;

/** Home page overview: what needs attention, upcoming renewals and recent activity. */
export async function homeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/home', async (req) => {
    const scope = envelopeScope(req.auth);
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const me = req.auth.userId ? await prisma.user.findUnique({ where: { id: req.auth.userId }, select: { name: true, email: true } }) : null;
    const summary = { select: { id: true, title: true, status: true, sentAt: true, expiresAt: true, updatedAt: true } } as const;

    const [drafts, awaitingOthers, completedThisMonth, toSign, expiring, declined, inReview, awaitingApproval, renewals, activity, workflows, failedRuns] = await Promise.all([
      prisma.envelope.count({ where: { ...scope, status: 'DRAFT' } }),
      prisma.envelope.count({ where: { ...scope, status: 'SENT' } }),
      prisma.envelope.count({ where: { ...scope, status: 'COMPLETED', completedAt: { gte: monthStart } } }),
      me
        ? prisma.envelope.findMany({
            where: { orgId: req.auth.orgId, status: 'SENT', recipients: { some: { email: me.email.toLowerCase(), status: { in: ['SENT', 'VIEWED'] } } } },
            ...summary,
            take: 5,
          })
        : [],
      prisma.envelope.findMany({ where: { ...scope, status: 'SENT', expiresAt: { gte: now, lte: new Date(now.getTime() + 7 * DAY_MS) } }, ...summary, orderBy: { expiresAt: 'asc' }, take: 5 }),
      prisma.envelope.findMany({ where: { ...scope, status: 'DECLINED', updatedAt: { gte: new Date(now.getTime() - 14 * DAY_MS) } }, ...summary, orderBy: { updatedAt: 'desc' }, take: 5 }),
      prisma.envelope.findMany({ where: { ...scope, status: 'SENT', comments: { some: { resolvedAt: null, parentId: null } } }, ...summary, take: 5 }),
      prisma.envelope.findMany({ where: { ...scope, status: 'DRAFT', approvalStatus: 'PENDING' }, ...summary, take: 5 }),
      prisma.contractMeta.findMany({
        where: {
          envelope: scope,
          OR: [{ renewalDate: { gte: now, lte: new Date(now.getTime() + 60 * DAY_MS) } }, { expiryDate: { gte: now, lte: new Date(now.getTime() + 60 * DAY_MS) } }],
        },
        include: { envelope: { select: { id: true, title: true } } },
        orderBy: [{ renewalDate: 'asc' }, { expiryDate: 'asc' }],
        take: 6,
      }),
      prisma.auditEvent.findMany({
        where: { envelope: scope, type: { in: ['envelope.sent', 'recipient.viewed', 'recipient.signed', 'recipient.declined', 'envelope.completed', 'envelope.voided'] } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, type: true, actor: true, createdAt: true, envelope: { select: { id: true, title: true } } },
      }),
      prisma.workflow.count({ where: { orgId: req.auth.orgId, enabled: true } }),
      prisma.workflowRun.count({ where: { orgId: req.auth.orgId, status: 'FAILED', createdAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } } }),
    ]);

    return {
      name: me?.name ?? null,
      counts: { drafts, awaitingOthers, completedThisMonth, toSign: toSign.length },
      attention: { toSign, expiring, declined, inReview, awaitingApproval },
      renewals: renewals.map((r) => ({
        envelope: r.envelope,
        counterparty: r.counterparty,
        date: r.renewalDate ?? r.expiryDate,
        kind: r.renewalDate ? 'renewal' : 'expiry',
        autoRenews: r.autoRenews,
        noticeDays: r.noticeDays,
      })),
      activity: activity.map((a) => ({ id: a.id, type: a.type, actor: a.actor, createdAt: a.createdAt, envelope: a.envelope })),
      workflows: { enabled: workflows, failedThisWeek: failedRuns },
    };
  });
}
