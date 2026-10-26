import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { checkPassword } from '../auth/routes.js';
import { checkMfaLogin } from '../auth/security.js';
import { consumeToken, issueToken } from '../auth/tokens.js';
import { appBaseFor } from '../governance/delivery.js';
import { createSession, issueSessionToken, requireAuth, signingUrl } from '../lib/auth.js';
import { forbidden } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { config } from '../config.js';

const platform = z.enum(['ios', 'android']);

/** Only paths on this site (no other hosts, no protocol-relative URLs). */
const safePath = z
  .string()
  .max(500)
  .refine((p) => p.startsWith('/') && !p.startsWith('//') && !p.includes('\\'), 'Must be a path on this site');

/**
 * The mobile app (apps/mobile). It signs in with a session token sent in the
 * `x-session-token` header instead of a cookie; everything else uses the
 * normal API. Screens the app shows as web pages (placing fields, signing)
 * open through a one-time link that signs the web view in.
 */
export async function mobileRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } };
  const label = (p: string) => `Mobile app (${p === 'ios' ? 'iPhone' : 'Android'})`;

  app.post('/mobile/login', strict, async (req) => {
    const { platform: p } = parse(z.object({ platform }), req.body);
    const user = await checkPassword(req, req.body);
    // Password was right; the session token comes after the second factor
    if (user.totpEnabledAt) return { mfaRequired: true, mfaToken: await issueToken(user.id, 'MFA_LOGIN') };
    return { token: await issueSessionToken(req, user.id, label(p), 'mobile') };
  });

  app.post('/mobile/login/mfa', strict, async (req) => {
    const { platform: p } = parse(z.object({ platform }), req.body);
    const user = await checkMfaLogin(req, req.body);
    return { token: await issueSessionToken(req, user.id, label(p), 'mobile') };
  });

  /** Opens the website signed in: redeems a link from POST /mobile/web-session. */
  app.get('/mobile/web-session/:token', strict, async (req, reply) => {
    const { token } = req.params as { token: string };
    const { next } = parse(z.object({ next: safePath.default('/dashboard') }), req.query);
    const user = await consumeToken(token, 'WEB_HANDOFF');
    if (!user) return reply.redirect(`/login?next=${encodeURIComponent(next)}`);
    await createSession(reply, user.id, 'mobile');
    return reply.redirect(next);
  });

  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);
    const me = (userId: string | null) => {
      if (!userId) throw forbidden('Sign in as a user.');
      return prisma.user.findUniqueOrThrow({ where: { id: userId } });
    };

    r.post('/mobile/logout', async (req) => {
      const { pushToken } = parse(z.object({ pushToken: z.string().max(200).optional() }), req.body ?? {});
      if (pushToken) await prisma.pushDevice.deleteMany({ where: { token: pushToken, userId: req.auth.userId ?? '' } });
      if (req.auth.sessionId) await prisma.session.deleteMany({ where: { id: req.auth.sessionId } });
      return { ok: true };
    });

    /** A one-time link (valid 2 minutes) that opens `next` on the website, signed in as this user. */
    r.post('/mobile/web-session', async (req) => {
      const { next } = parse(z.object({ next: safePath }), req.body);
      const user = await me(req.auth.userId);
      if (req.auth.support) throw forbidden('Not available in a support session.');
      const token = await issueToken(user.id, 'WEB_HANDOFF');
      return { url: `${config.appUrl}/api/v1/mobile/web-session/${token}?next=${encodeURIComponent(next)}` };
    });

    /** Registers this phone for push notifications (an Expo push token). */
    r.post('/mobile/push-devices', async (req) => {
      const body = parse(z.object({ token: z.string().regex(/^Expo(nent)?PushToken\[[^\]]+\]$/, 'Not an Expo push token'), platform }), req.body);
      const user = await me(req.auth.userId);
      // A phone belongs to whoever signed in on it last
      await prisma.pushDevice.upsert({
        where: { token: body.token },
        create: { token: body.token, platform: body.platform, userId: user.id },
        update: { userId: user.id, platform: body.platform, lastSeenAt: new Date() },
      });
      return { ok: true };
    });

    /**
     * Agreements waiting for my signature, from any organisation, matched by
     * my confirmed email. Each opens the normal signing page, which still
     * asks for the signer's code where the sender requires one.
     */
    r.get('/mobile/to-sign', async (req) => {
      const user = await me(req.auth.userId);
      if (!user.emailVerifiedAt) return { emailVerified: false, data: [] };
      const recipients = await prisma.recipient.findMany({
        where: {
          email: user.email.toLowerCase(),
          role: { in: ['SIGNER', 'APPROVER'] },
          status: { in: ['SENT', 'VIEWED'] },
          embedded: false,
          hostUserId: null,
          envelope: { status: 'SENT', selfSign: false },
        },
        include: { envelope: { select: { id: true, orgId: true, title: true, sentAt: true, expiresAt: true, testMode: true, org: { select: { name: true } }, createdBy: { select: { name: true } } } } },
        orderBy: { lastNotifiedAt: 'desc' },
        take: 50,
      });
      const data = await Promise.all(
        recipients.map(async (r) => ({
          recipientId: r.id,
          envelopeId: r.envelope.id,
          title: r.envelope.title,
          role: r.role,
          from: r.envelope.createdBy.name,
          organization: r.envelope.org.name,
          sentAt: r.envelope.sentAt,
          expiresAt: r.envelope.expiresAt,
          testMode: r.envelope.testMode,
          signingUrl: signingUrl(r, await appBaseFor(r.envelope.orgId)),
        })),
      );
      return { emailVerified: true, data };
    });
  });
}
