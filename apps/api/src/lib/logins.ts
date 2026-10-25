import type { FastifyRequest } from 'fastify';
import { prisma } from '../db.js';
import { notifyPlatform } from '../platform/access.js';

/** Failed sign-ins from one IP, or against one account, within the window that trigger a console alert. */
export const ATTACK_THRESHOLD = 10;
const ATTACK_WINDOW_MS = 15 * 60_000;

export type LoginMethod = 'password' | 'mfa' | 'sso' | 'invite' | 'register' | 'office';
export type LoginFailure = 'bad_password' | 'unknown_user' | 'deactivated' | 'sso_required' | 'bad_code' | 'suspended';

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
    if (!input.success) await watchForAttack(input.email.toLowerCase(), request.ip);
  } catch (err) {
    request.log.error({ err }, 'login event write failed');
  }
}

/** Counts the user as active today. Fire-and-forget; repeat calls the same day are no-ops. */
export function markActive(userId: string, orgId: string) {
  const day = new Date(new Date().toISOString().slice(0, 10));
  prisma.activeDay.createMany({ data: [{ userId, orgId, day }], skipDuplicates: true }).catch(() => {});
}

/** Alerts the console team once when failures from one IP, or against one account, reach the threshold. */
async function watchForAttack(email: string, ip: string) {
  const since = new Date(Date.now() - ATTACK_WINDOW_MS);
  const [byIp, byEmail] = await Promise.all([
    prisma.loginEvent.count({ where: { success: false, ip, createdAt: { gte: since } } }),
    prisma.loginEvent.count({ where: { success: false, email, createdAt: { gte: since } } }),
  ]);
  if (byIp === ATTACK_THRESHOLD) {
    await notifyPlatform(`${ATTACK_THRESHOLD} failed sign-ins from ${ip}`, [`${ATTACK_THRESHOLD} failed sign-in attempts came from ${ip} in the last 15 minutes. This can be password guessing.`, `Latest attempt: ${email}.`], { label: 'Open sign-ins', path: '/admin?tab=logins' });
  }
  if (byEmail === ATTACK_THRESHOLD) {
    await notifyPlatform(`${ATTACK_THRESHOLD} failed sign-ins for ${email}`, [`Someone failed to sign in as ${email} ${ATTACK_THRESHOLD} times in the last 15 minutes.`, 'Consider resetting the password or deactivating the user from the console.'], { label: 'Open sign-ins', path: '/admin?tab=logins' });
  }
}
