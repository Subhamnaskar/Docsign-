import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { logActivity } from '../lib/activity.js';
import { type AuthContext, requireAuth, requireRole } from '../lib/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';

/**
 * Departments (workspaces) group users inside an organisation. Agreements can
 * belong to a department; its managers see all of them, members see their own.
 * Templates can be shared with one department instead of the whole organisation.
 */

/** Departments a user belongs to (any role). */
export async function departmentIdsOf(userId: string | null): Promise<string[]> {
  if (!userId) return [];
  return (await prisma.departmentMember.findMany({ where: { userId }, select: { departmentId: true } })).map((d) => d.departmentId);
}

/** Checks a department can be used by this user (admins: any in the org; members: their own). */
export async function assertDepartmentUsable(auth: AuthContext, departmentId: string) {
  const dept = await prisma.department.findFirst({ where: { id: departmentId, orgId: auth.orgId } });
  if (!dept) throw badRequest('Unknown department.');
  if (auth.role === 'MEMBER' && !(await departmentIdsOf(auth.userId)).includes(departmentId)) throw forbidden('You are not in that department.');
}

export async function departmentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/departments', async (req) => {
    const mine = req.auth.role === 'MEMBER' ? await departmentIdsOf(req.auth.userId) : null;
    const list = await prisma.department.findMany({
      where: { orgId: req.auth.orgId, ...(mine ? { id: { in: mine } } : {}) },
      orderBy: { name: 'asc' },
      include: { members: { include: { user: { select: { id: true, name: true, email: true } } } }, _count: { select: { envelopes: true } } },
    });
    return list.map((d) => ({
      id: d.id,
      name: d.name,
      agreements: d._count.envelopes,
      members: d.members.map((m) => ({ userId: m.userId, name: m.user.name, email: m.user.email, role: m.role })),
    }));
  });

  await app.register(async (admin) => {
    admin.addHook('preHandler', requireRole('OWNER', 'ADMIN'));

    admin.post('/departments', async (req, reply) => {
      const { name } = parse(z.object({ name: z.string().trim().min(1).max(80) }), req.body);
      if (await prisma.department.findFirst({ where: { orgId: req.auth.orgId, name } })) throw conflict('A department with that name exists.');
      const d = await prisma.department.create({ data: { orgId: req.auth.orgId, name } });
      await logActivity(req, 'department.created', { id: d.id, name });
      reply.code(201);
      return { id: d.id, name: d.name, agreements: 0, members: [] };
    });

    admin.patch('/departments/:id', async (req) => {
      const { id } = req.params as { id: string };
      const { name } = parse(z.object({ name: z.string().trim().min(1).max(80) }), req.body);
      const res = await prisma.department.updateMany({ where: { id, orgId: req.auth.orgId }, data: { name } });
      if (!res.count) throw notFound('Department');
      return { id, name };
    });

    admin.delete('/departments/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const res = await prisma.department.deleteMany({ where: { id, orgId: req.auth.orgId } });
      if (!res.count) throw notFound('Department');
      await logActivity(req, 'department.deleted', { id });
      reply.code(204);
    });

    /** Replaces the member list. */
    admin.put('/departments/:id/members', async (req) => {
      const { id } = req.params as { id: string };
      const members = parse(z.array(z.object({ userId: z.string(), role: z.enum(['member', 'manager']).default('member') })).max(500), req.body);
      const dept = await prisma.department.findFirst({ where: { id, orgId: req.auth.orgId } });
      if (!dept) throw notFound('Department');
      const ids = [...new Set(members.map((m) => m.userId))];
      if ((await prisma.user.count({ where: { id: { in: ids }, orgId: req.auth.orgId } })) !== ids.length) throw badRequest('Members must belong to this organisation.');
      await prisma.$transaction([
        prisma.departmentMember.deleteMany({ where: { departmentId: id } }),
        prisma.departmentMember.createMany({ data: members.map((m) => ({ departmentId: id, userId: m.userId, role: m.role })), skipDuplicates: true }),
      ]);
      await logActivity(req, 'department.members_updated', { id, count: ids.length });
      return { id, members: members.length };
    });
  });
}
