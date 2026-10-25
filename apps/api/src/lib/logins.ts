import type { FastifyRequest } from 'fastify';
import { prisma } from '../db.js';

export type LoginMethod = 'password' | 'mfa' | 'sso' | 'invite' | 'register' | 'office';
export type LoginFailure = 'bad_password' | 'unknown_user' | 'deactivated' | 'sso_required' | 'bad_code';

/**
 * Records a sign-in attempt for the platform console. Successful sign-ins also
 * stamp the user's lastLoginAt. Never throws: a failed write must not block sign-in.
 */
export async function recordLogin(
  request: FastifyRequest,
  input: {
    email: string;
    method: LoginMethod;
    success: boolean;
    userId?: string | null;
    orgId?: string | null;
    reason?: LoginFailure;
  },
) {
  const ua = request.headers['user-agent'];
  try {
    await prisma.loginEvent.create({
      data: {
        email: input.email.toLowerCase(),
        method: input.method,
        success: input.success,
        reason: input.reason ?? null,
        userId: input.userId ?? null,
        orgId: input.orgId ?? null,
        ip: request.ip,
        userAgent: typeof ua === 'string' ? ua.slice(0, 300) : null,
      },
    });
    if (input.success && input.userId) {
      await prisma.user.update({
        where: { id: input.userId },
        data: { lastLoginAt: new Date() },
      });
      if (input.orgId) markActive(input.userId, input.orgId);
    }
  } catch (err) {
    request.log.error({ err }, 'login event write failed');
  }
}

/** Counts the user as active today. Fire-and-forget; repeat calls the same day are no-ops. */
export function markActive(userId: string, orgId: string) {
  const day = new Date(new Date().toISOString().slice(0, 10));
  prisma.activeDay.createMany({ data: [{ userId, orgId, day }], skipDuplicates: true }).catch(() => {});
}
