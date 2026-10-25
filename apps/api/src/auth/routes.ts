import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { logActivity } from '../lib/activity.js';
import { createSession, requireAuth, requireRole, SESSION_COOKIE } from '../lib/auth.js';
import { sha256Hex } from '../lib/crypto.js';
import { type LoginFailure, recordLogin } from '../lib/logins.js';
import { badRequest, conflict, forbidden, unauthorized } from '../lib/errors.js';
import { ssoOrgForEmail } from '../sso/routes.js';
import { parse } from '../lib/validate.js';
import { JURISDICTIONS } from '../policy/jurisdictions.js';
import { billingBrief } from '../billing/routes.js';
import { TRIAL } from '../billing/plans.js';
import { platformRole } from '../platform/access.js';
import { isSsoOnly, passwordSchema } from './security.js';
import { issueToken, sendVerificationEmail } from './tokens.js';

const password = passwordSchema;
/** Languages the sender app is available in */
const APP_LOCALES = ['en', 'hi'] as const;
// Compared against when the user doesn't exist, so response timing doesn't reveal registered emails
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

export async function authRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } };

  app.post('/auth/register', strict, async (req, reply) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(120),
        email: z.string().trim().toLowerCase().email(),
        password,
        organizationName: z.string().trim().min(1).max(120),
        jurisdiction: z.string().refine((c) => c in JURISDICTIONS, 'Unknown jurisdiction').default('US'),
        locale: z.enum(APP_LOCALES).default('en'),
      }),
      req.body,
    );
    if (await prisma.user.findUnique({ where: { email: body.email } })) {
      throw conflict('An account with this email already exists.');
    }
    if (await ssoOrgForEmail(body.email)) {
      throw conflict('Your company signs in with single sign-on. Use "Sign in with SSO" instead.');
    }
    const user = await prisma.user.create({
      data: {
        name: body.name,
        email: body.email,
        passwordHash: await bcrypt.hash(body.password, 12),
        role: 'OWNER',
        locale: body.locale,
        org: {
          create: { name: body.organizationName, jurisdiction: body.jurisdiction, dataRegion: config.cellRegion, trialEndsAt: new Date(Date.now() + TRIAL.days * 86_400_000) },
        },
      },
    });
    await createSession(reply, user.id, 'register');
    await sendVerificationEmail(user);
    reply.code(201);
    return { id: user.id, name: user.name, email: user.email };
  });

  app.post('/auth/login', strict, async (req, reply) => {
    const body = parse(z.object({ email: z.string().trim().toLowerCase(), password: z.string() }), req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    const ok = await bcrypt.compare(body.password, user?.passwordHash ?? DUMMY_HASH);
    const failed = (reason: LoginFailure) => recordLogin(req, { email: body.email, method: 'password', success: false, userId: user?.id, orgId: user?.orgId, reason });
    if (!user || !ok) {
      await failed(user ? 'bad_password' : 'unknown_user');
      throw unauthorized('Incorrect email or password.');
    }
    const sso = await ssoOrgForEmail(body.email);
    // Owners keep password access so a broken identity provider can't lock everyone out
    if (sso?.ssoEnforced && sso.id === user.orgId && user.role !== 'OWNER') {
      await failed('sso_required');
      throw forbidden('Your organisation requires single sign-on. Use "Sign in with SSO".');
    }
    if (user.disabledAt) {
      await failed('deactivated');
      throw unauthorized('This account has been deactivated.');
    }
    if (user.totpEnabledAt) {
      // Password was right; the session is only created after the second factor
      return { mfaRequired: true, mfaToken: await issueToken(user.id, 'MFA_LOGIN') };
    }
    await createSession(reply, user.id);
    return { id: user.id, name: user.name, email: user.email };
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await prisma.session.deleteMany({ where: { tokenHash: sha256Hex(token) } });
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: requireAuth }, async (req) => {
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.auth.orgId } });
    const user = req.auth.userId ? await prisma.user.findUnique({ where: { id: req.auth.userId } }) : null;
    return {
      user: user && {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        emailVerified: Boolean(user.emailVerifiedAt),
        locale: user.locale,
        twoFactor: Boolean(user.totpEnabledAt),
        // The organisation requires two-factor and this password user hasn't set it up
        mfaSetupRequired: org.require2fa && !user.totpEnabledAt && !isSsoOnly(user),
        // NuronixAI staff: show the platform console link (never inside a support session)
        platformAdmin: Boolean(req.auth.sessionId && !req.auth.support && (await platformRole(user))),
      },
      organization: {
        id: org.id,
        name: org.name,
        jurisdiction: org.jurisdiction,
        dataRegion: org.dataRegion,
        brandColor: org.brandColor,
        embedOrigins: org.embedOrigins,
        aiEnabled: org.aiEnabled,
        require2fa: org.require2fa,
        approvalPolicy: org.approvalPolicy,
        approverIds: org.approverIds,
      },
      // Read-only NuronixAI support session: the app shows a banner with a way out
      support: req.auth.support ? { by: req.auth.support.email, endsAt: (await prisma.session.findUnique({ where: { id: req.auth.sessionId! } }))?.expiresAt ?? null } : null,
      cell: config.cellRegion,
      features: { ai: config.ai.enabled, aadhaarEsign: config.esign.mode },
      billing: billingBrief(org),
    };
  });

  /** The signed-in user's name and app language. */
  app.patch('/auth/profile', { preHandler: requireAuth }, async (req) => {
    const body = parse(z.object({ name: z.string().trim().min(1).max(120).optional(), locale: z.enum(APP_LOCALES).optional() }), req.body);
    if (!req.auth.userId) throw forbidden('Sign in as a user to change your profile.');
    const user = await prisma.user.update({ where: { id: req.auth.userId }, data: body });
    return { name: user.name, locale: user.locale };
  });

  app.patch('/organization', { preHandler: [requireAuth, requireRole('OWNER', 'ADMIN')] }, async (req) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(120).optional(),
        jurisdiction: z.string().refine((c) => c in JURISDICTIONS, 'Unknown jurisdiction').optional(),
        brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #9a6f08').nullable().optional(),
        aiEnabled: z.boolean().optional(),
        require2fa: z.boolean().optional(),
        approvalPolicy: z.enum(['off', 'members', 'all']).optional(),
        approverIds: z.array(z.string()).max(50).optional(),
        embedOrigins: z.array(z.string().url().refine((u) => /^https?:\/\/[^/]+$/.test(u), 'Use an origin like https://app.example.com')).max(20).optional(),
      }),
      req.body,
    );
    if (body.require2fa && req.auth.userId) {
      // Turning the policy on would otherwise lock the admin out mid-session
      const admin = await prisma.user.findUniqueOrThrow({ where: { id: req.auth.userId } });
      if (!admin.totpEnabledAt && !isSsoOnly(admin)) throw badRequest('Turn on two-factor authentication for your own account first (Settings → Security).');
    }
    if (body.approverIds?.length) {
      const found = await prisma.user.count({ where: { id: { in: body.approverIds }, orgId: req.auth.orgId, disabledAt: null } });
      if (found !== new Set(body.approverIds).size) throw badRequest('Approvers must be active members of this organisation.');
    }
    const org = await prisma.organization.update({ where: { id: req.auth.orgId }, data: body });
    await logActivity(req, 'organization.updated', body);
    return {
      id: org.id,
      name: org.name,
      jurisdiction: org.jurisdiction,
      dataRegion: org.dataRegion,
      brandColor: org.brandColor,
      embedOrigins: org.embedOrigins,
      aiEnabled: org.aiEnabled,
      require2fa: org.require2fa,
      approvalPolicy: org.approvalPolicy,
      approverIds: org.approverIds,
    };
  });
}
