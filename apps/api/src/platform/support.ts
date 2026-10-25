import type { Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { logActivity } from '../lib/activity.js';
import { requireAuth, requireRole, SESSION_COOKIE, SESSION_TTL_MS, setSessionCookie } from '../lib/auth.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { layout, sendMail } from '../lib/mailer.js';
import { parse } from '../lib/validate.js';

/**
 * Support access: an organisation's admin lets NuronixAI support look at the
 * account for a limited time. Staff then open a read-only support session as
 * one of its users from the platform console.
 */

export const SUPPORT_SESSION_MS = 60 * 60_000;
const GRANT_HOURS = [24, 72, 168] as const;

/** Session row without a login record: support sessions and the return to staff's own account. */
async function newSession(req: FastifyRequest, data: { userId: string; expiresAt: Date; impersonatorUserId?: string; impersonatorEmail?: string }) {
  const token = randomToken();
  const ua = req.headers['user-agent'];
  await prisma.session.create({
    data: { ...data, tokenHash: sha256Hex(token), ip: req.ip, userAgent: typeof ua === 'string' ? ua.slice(0, 300) : null },
  });
  return token;
}

/** Starts a read-only support session as `targetUserId` in the staff member's browser. */
export async function startSupportSession(req: FastifyRequest, reply: FastifyReply, orgId: string, targetUserId?: string) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
  if (!org.supportAccessUntil || org.supportAccessUntil <= new Date()) {
    throw forbidden(`${org.name} has not granted NuronixAI support access. Ask an admin there to turn it on under Settings → Security.`);
  }
  if (org.suspendedAt) throw badRequest('This organisation is suspended. Reactivate it before opening a support session.');
  const target = await prisma.user.findFirst({
    where: { orgId, disabledAt: null, ...(targetUserId ? { id: targetUserId } : { role: 'OWNER' }) },
    orderBy: { createdAt: 'asc' },
  });
  if (!target) throw badRequest('No active user to view the account as.');
  const staff = req.auth.actor.kind === 'user' ? req.auth.actor : null;
  if (!staff) throw forbidden();

  const expiresAt = new Date(Math.min(Date.now() + SUPPORT_SESSION_MS, org.supportAccessUntil.getTime()));
  setSessionCookie(reply, await newSession(req, { userId: target.id, expiresAt, impersonatorUserId: staff.id, impersonatorEmail: staff.email }));
  await prisma.activityLog.create({
    data: {
      orgId,
      type: 'platform.support_session_started',
      actor: staff as Prisma.JsonObject,
      data: { viewingAs: target.email, until: expiresAt.toISOString(), via: 'platform console' },
      ip: req.ip,
    },
  });
  const admins = await prisma.user.findMany({ where: { orgId, disabledAt: null, role: { in: ['OWNER', 'ADMIN'] } }, select: { email: true, name: true } });
  for (const a of admins) {
    const { html, text } = layout({
      heading: 'NuronixAI support is viewing your account',
      paragraphs: [
        `Hi ${a.name}, ${staff.name} (${staff.email}) from NuronixAI support opened a read-only session in ${org.name} as ${target.email}, until ${expiresAt.toUTCString()}.`,
        'Support sessions can look but not change anything. You can withdraw support access at any time, which ends the session.',
      ],
      button: { label: 'Manage support access', url: `${config.appUrl}/settings?tab=security` },
    });
    await sendMail({ to: a.email, subject: 'NuronixAI support opened your account', html, text }).catch(() => {});
  }
  return { viewingAs: target.email, until: expiresAt };
}

export async function supportRoutes(app: FastifyInstance) {
  const admin = { preHandler: [requireAuth, requireRole('OWNER', 'ADMIN')] };

  app.get('/organization/support-access', admin, async (req) => {
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.auth.orgId }, select: { supportAccessUntil: true } });
    const active = org.supportAccessUntil && org.supportAccessUntil > new Date() ? org.supportAccessUntil : null;
    const sessions = active
      ? await prisma.session.findMany({
          where: { user: { orgId: req.auth.orgId }, impersonatorUserId: { not: null }, expiresAt: { gt: new Date() } },
          select: { impersonatorEmail: true, expiresAt: true, user: { select: { email: true } } },
        })
      : [];
    return { until: active, sessions: sessions.map((s) => ({ by: s.impersonatorEmail, viewingAs: s.user.email, until: s.expiresAt })) };
  });

  app.post('/organization/support-access', admin, async (req) => {
    const { hours } = parse(z.object({ hours: z.coerce.number().refine((h) => (GRANT_HOURS as readonly number[]).includes(h), 'Choose 24, 72 or 168 hours') }), req.body);
    const until = new Date(Date.now() + hours * 3600_000);
    await prisma.organization.update({ where: { id: req.auth.orgId }, data: { supportAccessUntil: until } });
    await logActivity(req, 'support_access.granted', { hours, until });
    return { until };
  });

  /** Withdraws access and ends any open support session. */
  app.delete('/organization/support-access', admin, async (req) => {
    await prisma.organization.update({ where: { id: req.auth.orgId }, data: { supportAccessUntil: null } });
    const ended = await prisma.session.deleteMany({ where: { user: { orgId: req.auth.orgId }, impersonatorUserId: { not: null } } });
    await logActivity(req, 'support_access.revoked', { endedSessions: ended.count });
    return { ok: true };
  });

  /** Ends the support session and returns staff to their own account and the console. */
  app.post('/auth/support/end', { preHandler: requireAuth }, async (req, reply) => {
    const support = req.auth.support;
    if (!support || !req.auth.sessionId) throw badRequest('This is not a support session.');
    await prisma.session.delete({ where: { id: req.auth.sessionId } });
    await prisma.activityLog.create({
      data: {
        orgId: req.auth.orgId,
        type: 'platform.support_session_ended',
        actor: { kind: 'user', id: support.userId, name: support.email, email: support.email },
        data: { via: 'platform console' },
        ip: req.ip,
      },
    });
    const staff = await prisma.user.findUnique({ where: { id: support.userId } });
    if (!staff || staff.disabledAt) {
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return { redirect: '/login' };
    }
    setSessionCookie(reply, await newSession(req, { userId: staff.id, expiresAt: new Date(Date.now() + SESSION_TTL_MS) }));
    return { redirect: `/admin/orgs/${req.auth.orgId}` };
  });
}
