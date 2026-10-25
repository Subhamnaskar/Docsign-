import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { logActivity } from '../lib/activity.js';
import { createSession, requireAuth, requireRole } from '../lib/auth.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { layout, sendMail } from '../lib/mailer.js';
import { parse } from '../lib/validate.js';
import { assertSeatAvailable } from '../billing/plans.js';

const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;
const role = z.enum(['OWNER', 'ADMIN', 'MEMBER']);

export async function teamRoutes(app: FastifyInstance) {
  // --- Public: accepting an invitation -------------------------------------
  app.get('/invitations/:token', async (req) => {
    const { token } = req.params as { token: string };
    const inv = await prisma.invitation.findUnique({ where: { tokenHash: sha256Hex(token) }, include: { org: true } });
    if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) throw notFound('Invitation');
    return { email: inv.email, organization: inv.org.name, role: inv.role };
  });

  app.post('/invitations/:token/accept', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const { token } = req.params as { token: string };
    const body = parse(z.object({ name: z.string().trim().min(1).max(120), password: z.string().min(10).max(200) }), req.body);
    const inv = await prisma.invitation.findUnique({ where: { tokenHash: sha256Hex(token) } });
    if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) throw notFound('Invitation');
    if (await prisma.user.findUnique({ where: { email: inv.email } })) throw conflict('An account with this email already exists.');
    const user = await prisma.$transaction(async (tx) => {
      await tx.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
      return tx.user.create({
        data: { email: inv.email, name: body.name, passwordHash: await bcrypt.hash(body.password, 12), role: inv.role, orgId: inv.orgId },
      });
    });
    await prisma.activityLog.create({
      data: { orgId: inv.orgId, type: 'user.joined', actor: { kind: 'user', id: user.id, name: user.name, email: user.email }, data: { role: user.role }, ip: req.ip },
    });
    await createSession(reply, user.id);
    reply.code(201);
    return { id: user.id, name: user.name, email: user.email };
  });

  // --- Authenticated team management ---------------------------------------
  await app.register(async (admin) => {
    admin.addHook('preHandler', requireAuth);

    admin.get('/team', async (req) => {
      const [users, invitations] = await Promise.all([
        prisma.user.findMany({
          where: { orgId: req.auth.orgId },
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true, email: true, role: true, disabledAt: true, createdAt: true },
        }),
        prisma.invitation.findMany({
          where: { orgId: req.auth.orgId, acceptedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: 'desc' },
          select: { id: true, email: true, role: true, createdAt: true, expiresAt: true },
        }),
      ]);
      return { users, invitations };
    });

    admin.post('/team/invitations', { preHandler: requireRole('OWNER', 'ADMIN') }, async (req, reply) => {
      const body = parse(z.object({ email: z.string().trim().toLowerCase().email(), role: role.default('MEMBER') }), req.body);
      if (body.role === 'OWNER' && req.auth.role !== 'OWNER') throw forbidden('Only owners can invite owners.');
      if (await prisma.user.findUnique({ where: { email: body.email } })) throw conflict('That person already has an account.');
      // Re-inviting replaces the open invitation, so it doesn't need another seat
      const reinvite = await prisma.invitation.findFirst({ where: { orgId: req.auth.orgId, email: body.email, acceptedAt: null, expiresAt: { gt: new Date() } } });
      if (!reinvite) await assertSeatAvailable(req.auth.orgId);
      const token = randomToken();
      await prisma.invitation.deleteMany({ where: { orgId: req.auth.orgId, email: body.email, acceptedAt: null } });
      const inv = await prisma.invitation.create({
        data: {
          orgId: req.auth.orgId,
          email: body.email,
          role: body.role,
          tokenHash: sha256Hex(token),
          invitedById: req.auth.userId ?? '',
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        },
        include: { org: true },
      });
      const inviter = req.auth.actor.kind === 'user' ? req.auth.actor.name : inv.org.name;
      const { html, text } = layout({
        heading: `${inviter} invited you to ${inv.org.name}`,
        paragraphs: [`You've been invited to join ${inv.org.name} on DocSign as ${body.role.toLowerCase()}.`, 'The invitation expires in 7 days.'],
        button: { label: 'Accept invitation', url: `${config.appUrl}/invite/${token}` },
      });
      await sendMail({ to: body.email, subject: `Join ${inv.org.name} on DocSign`, html, text });
      await logActivity(req, 'user.invited', { email: body.email, role: body.role });
      reply.code(201);
      return { id: inv.id, email: inv.email, role: inv.role, expiresAt: inv.expiresAt };
    });

    admin.delete('/team/invitations/:id', { preHandler: requireRole('OWNER', 'ADMIN') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const res = await prisma.invitation.deleteMany({ where: { id, orgId: req.auth.orgId, acceptedAt: null } });
      if (res.count === 0) throw notFound('Invitation');
      await logActivity(req, 'invitation.revoked', { invitationId: id });
      reply.code(204);
    });

    /** Change role or (de)activate. Admins manage members; owners manage everyone. */
    admin.patch('/team/users/:id', { preHandler: requireRole('OWNER', 'ADMIN') }, async (req) => {
      const { id } = req.params as { id: string };
      const body = parse(z.object({ role: role.optional(), active: z.boolean().optional() }), req.body);
      const user = await prisma.user.findFirst({ where: { id, orgId: req.auth.orgId } });
      if (!user) throw notFound('User');
      if (req.auth.role === 'ADMIN' && (user.role !== 'MEMBER' || body.role === 'OWNER' || body.role === 'ADMIN')) {
        throw forbidden('Admins can only manage members.');
      }
      if (id === req.auth.userId && (body.active === false || (body.role && body.role !== user.role))) {
        throw badRequest('You cannot change your own role or deactivate yourself.');
      }
      const losingOwner = user.role === 'OWNER' && ((body.role && body.role !== 'OWNER') || body.active === false);
      if (losingOwner) {
        const owners = await prisma.user.count({ where: { orgId: req.auth.orgId, role: 'OWNER', disabledAt: null } });
        if (owners <= 1) throw badRequest('An organisation needs at least one active owner.');
      }
      if (body.active === true && user.disabledAt) await assertSeatAvailable(req.auth.orgId);
      const updated = await prisma.user.update({
        where: { id },
        data: {
          ...(body.role ? { role: body.role } : {}),
          ...(body.active === undefined ? {} : { disabledAt: body.active ? null : new Date() }),
        },
        select: { id: true, name: true, email: true, role: true, disabledAt: true, createdAt: true },
      });
      // Deactivation ends all of the user's sessions immediately
      if (body.active === false) await prisma.session.deleteMany({ where: { userId: id } });
      await logActivity(req, 'user.updated', { userId: id, email: user.email, ...body });
      return updated;
    });

    admin.get('/activity', { preHandler: requireRole('OWNER', 'ADMIN') }, async (req) => {
      const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) }), req.query);
      return prisma.activityLog.findMany({ where: { orgId: req.auth.orgId }, orderBy: { createdAt: 'desc' }, take: q.limit });
    });
  });
}
