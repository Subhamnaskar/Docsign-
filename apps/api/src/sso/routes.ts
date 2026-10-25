import type { FastifyInstance } from 'fastify';
import * as oidc from 'openid-client';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { logActivity } from '../lib/activity.js';
import { createSession, requireAuth, requireRole } from '../lib/auth.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';
import { badRequest, conflict, HttpError, notFound } from '../lib/errors.js';
import { open, seal } from '../lib/secretbox.js';
import { parse } from '../lib/validate.js';
import { assertFeature, assertSeatAvailable } from '../billing/plans.js';

/**
 * Single sign-on with OpenID Connect (Google Workspace, Microsoft Entra ID,
 * Okta and any other standard provider), with just-in-time user creation.
 */

const FLOW_COOKIE = 'ds_sso_flow';
const FLOW_TTL_MS = 10 * 60 * 1000;
const redirectUri = () => `${config.appUrl}/api/v1/auth/sso/callback`;
const domainOf = (email: string) => email.split('@')[1]?.toLowerCase() ?? '';

async function discover(org: { ssoIssuer: string | null; ssoClientId: string | null; ssoClientSecretEnc: string | null }) {
  if (!org.ssoIssuer || !org.ssoClientId || !org.ssoClientSecretEnc) throw badRequest('Single sign-on is not configured.');
  const issuer = new URL(org.ssoIssuer);
  // Plain-http issuers are only acceptable on localhost (development and tests)
  const insecure = issuer.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(issuer.hostname);
  try {
    return await oidc.discovery(issuer, org.ssoClientId, open(org.ssoClientSecretEnc), undefined, insecure ? { execute: [oidc.allowInsecureRequests] } : undefined);
  } catch {
    throw new HttpError(502, `Could not reach the identity provider at ${org.ssoIssuer}.`, 'sso_unavailable');
  }
}

/** Finds the organisation whose SSO covers this email's domain. */
export async function ssoOrgForEmail(email: string) {
  const domain = domainOf(email);
  if (!domain) return null;
  return prisma.organization.findFirst({ where: { ssoDomains: { has: domain }, ssoIssuer: { not: null } } });
}

export async function ssoRoutes(app: FastifyInstance) {
  /** Does this email sign in with SSO? Used by the login page. */
  app.post('/auth/sso/lookup', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const { email } = parse(z.object({ email: z.string().trim().toLowerCase().email() }), req.body);
    const org = await ssoOrgForEmail(email);
    return { sso: Boolean(org), enforced: Boolean(org?.ssoEnforced) };
  });

  app.post('/auth/sso/start', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { email, next } = parse(z.object({ email: z.string().trim().toLowerCase().email(), next: z.string().optional() }), req.body);
    const org = await ssoOrgForEmail(email);
    if (!org) throw notFound('Single sign-on for this email domain');
    const conf = await discover(org);
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const url = oidc.buildAuthorizationUrl(conf, {
      redirect_uri: redirectUri(),
      scope: 'openid email profile',
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
      nonce,
      login_hint: email,
    });
    // Flow secrets live in a short-lived signed cookie, not the database
    reply.setCookie(FLOW_COOKIE, JSON.stringify({ orgId: org.id, verifier, state, nonce, next: next?.startsWith('/') ? next : '/dashboard' }), {
      path: '/api/v1/auth/sso',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction,
      signed: true,
      maxAge: FLOW_TTL_MS / 1000,
    });
    return { url: url.toString() };
  });

  app.get('/auth/sso/callback', async (req, reply) => {
    const raw = req.cookies[FLOW_COOKIE];
    const unsigned = raw ? req.unsignCookie(raw) : null;
    if (!unsigned?.valid || !unsigned.value) return reply.redirect(`${config.appUrl}/login?sso=expired`, 303);
    const flow = JSON.parse(unsigned.value) as { orgId: string; verifier: string; state: string; nonce: string; next: string };
    reply.clearCookie(FLOW_COOKIE, { path: '/api/v1/auth/sso' });

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: flow.orgId } });
    const conf = await discover(org);
    let claims: oidc.IDToken | undefined;
    try {
      const current = new URL(req.url, redirectUri());
      const callbackUrl = new URL(redirectUri());
      callbackUrl.search = current.search;
      const tokens = await oidc.authorizationCodeGrant(conf, callbackUrl, {
        pkceCodeVerifier: flow.verifier,
        expectedState: flow.state,
        expectedNonce: flow.nonce,
      });
      claims = tokens.claims();
    } catch (err) {
      req.log.warn({ err }, 'sso callback failed');
      return reply.redirect(`${config.appUrl}/login?sso=failed`, 303);
    }
    const email = String(claims?.email ?? '').toLowerCase();
    if (!email || claims?.email_verified === false) return reply.redirect(`${config.appUrl}/login?sso=no_email`, 303);
    if (!org.ssoDomains.includes(domainOf(email))) return reply.redirect(`${config.appUrl}/login?sso=wrong_domain`, 303);

    let user = await prisma.user.findUnique({ where: { email } });
    if (user && user.orgId !== org.id) return reply.redirect(`${config.appUrl}/login?sso=other_org`, 303);
    if (user?.disabledAt) return reply.redirect(`${config.appUrl}/login?sso=deactivated`, 303);
    if (!user) {
      try {
        await assertSeatAvailable(org.id);
      } catch {
        return reply.redirect(`${config.appUrl}/login?sso=no_seats`, 303);
      }
      // Just-in-time provisioning; no usable password
      user = await prisma.user.create({
        data: {
          email,
          name: String(claims?.name ?? email.split('@')[0]),
          passwordHash: `sso:${randomToken(24)}`,
          role: org.ssoDefaultRole,
          orgId: org.id,
          ssoSubject: claims?.sub,
          emailVerifiedAt: new Date(),
        },
      });
      await prisma.activityLog.create({
        data: { orgId: org.id, type: 'user.joined', actor: { kind: 'user', id: user.id, name: user.name, email }, data: { via: 'sso', role: user.role }, ip: req.ip },
      });
    } else if (!user.ssoSubject && claims?.sub) {
      await prisma.user.update({ where: { id: user.id }, data: { ssoSubject: claims.sub } });
    }
    await createSession(reply, user.id);
    return reply.redirect(`${config.appUrl}${flow.next}`, 303);
  });

  // --- Configuration (admins) --------------------------------------------------
  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);
    r.addHook('preHandler', requireRole('OWNER', 'ADMIN'));

    r.get('/organization/sso', async (req) => {
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.auth.orgId } });
      return {
        issuer: org.ssoIssuer,
        clientId: org.ssoClientId,
        hasClientSecret: Boolean(org.ssoClientSecretEnc),
        domains: org.ssoDomains,
        enforced: org.ssoEnforced,
        defaultRole: org.ssoDefaultRole,
        redirectUri: redirectUri(),
        scimEnabled: Boolean(org.scimTokenHash),
        scimBaseUrl: `${config.appUrl}/api/v1/scim/v2`,
      };
    });

    r.put('/organization/sso', async (req) => {
      await assertFeature(req.auth.orgId, 'sso');
      const body = parse(
        z.object({
          issuer: z.string().url(),
          clientId: z.string().trim().min(1).max(300),
          clientSecret: z.string().min(1).max(2000).optional(),
          domains: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'Use a domain like example.com')).min(1).max(20),
          enforced: z.boolean().default(false),
          defaultRole: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'),
        }),
        req.body,
      );
      const current = await prisma.organization.findUniqueOrThrow({ where: { id: req.auth.orgId } });
      const secretEnc = body.clientSecret ? seal(body.clientSecret) : current.ssoClientSecretEnc;
      if (!secretEnc) throw badRequest('Enter the client secret.');
      for (const d of body.domains) {
        const taken = await prisma.organization.findFirst({ where: { id: { not: req.auth.orgId }, ssoDomains: { has: d } } });
        if (taken) throw conflict(`${d} already uses single sign-on with another organisation.`);
      }
      // Fail fast if the provider can't be discovered with these settings
      await discover({ ssoIssuer: body.issuer, ssoClientId: body.clientId, ssoClientSecretEnc: secretEnc });
      await prisma.organization.update({
        where: { id: req.auth.orgId },
        data: {
          ssoIssuer: body.issuer,
          ssoClientId: body.clientId,
          ssoClientSecretEnc: secretEnc,
          ssoDomains: body.domains,
          ssoEnforced: body.enforced,
          ssoDefaultRole: body.defaultRole,
        },
      });
      await logActivity(req, 'sso.updated', { issuer: body.issuer, domains: body.domains, enforced: body.enforced });
      return { ok: true };
    });

    r.delete('/organization/sso', async (req, reply) => {
      await prisma.organization.update({
        where: { id: req.auth.orgId },
        data: { ssoIssuer: null, ssoClientId: null, ssoClientSecretEnc: null, ssoDomains: [], ssoEnforced: false },
      });
      await logActivity(req, 'sso.updated', { removed: true });
      reply.code(204);
    });

    /** Creates (or rotates) the SCIM bearer token; shown once. */
    r.post('/organization/scim-token', async (req) => {
      await assertFeature(req.auth.orgId, 'sso');
      const token = `scim_${randomToken(32)}`;
      await prisma.organization.update({ where: { id: req.auth.orgId }, data: { scimTokenHash: sha256Hex(token) } });
      await logActivity(req, 'scim.token_rotated');
      return { token, baseUrl: `${config.appUrl}/api/v1/scim/v2` };
    });

    r.delete('/organization/scim-token', async (req, reply) => {
      await prisma.organization.update({ where: { id: req.auth.orgId }, data: { scimTokenHash: null } });
      await logActivity(req, 'scim.token_revoked');
      reply.code(204);
    });
  });
}
