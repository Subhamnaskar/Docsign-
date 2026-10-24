import type { FastifyRequest } from 'fastify';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

/** Records an organisation-level admin action (users, keys, settings). Never throws. */
export async function logActivity(req: FastifyRequest, type: string, data: Record<string, unknown> = {}) {
  await prisma.activityLog
    .create({
      data: {
        orgId: req.auth.orgId,
        type,
        actor: req.auth.actor as Prisma.JsonObject,
        data: data as Prisma.JsonObject,
        ip: req.ip,
      },
    })
    .catch((err) => req.log.error({ err }, 'activity log write failed'));
}
