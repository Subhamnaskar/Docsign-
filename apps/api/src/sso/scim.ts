import type { User } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../db.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';

/**
 * SCIM 2.0 user provisioning (RFC 7643/7644), the subset identity providers
 * such as Okta and Microsoft Entra ID use: create, read, filter by userName,
 * replace, patch "active", and delete (deactivate).
 */

const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';

declare module 'fastify' {
  interface FastifyRequest {
    scimOrgId: string;
  }
}

function scimError(reply: FastifyReply, status: number, detail: string) {
  return reply.code(status).type('application/scim+json').send({ schemas: [ERROR_SCHEMA], status: String(status), detail });
}

function toScim(u: User, base: string) {
  const [givenName, ...rest] = u.name.split(' ');
  return {
    schemas: [USER_SCHEMA],
    id: u.id,
    externalId: u.externalId ?? undefined,
    userName: u.email,
    name: { givenName, familyName: rest.join(' ') || undefined, formatted: u.name },
    displayName: u.name,
    emails: [{ value: u.email, primary: true, type: 'work' }],
    active: !u.disabledAt,
    meta: { resourceType: 'User', created: u.createdAt.toISOString(), location: `${base}/Users/${u.id}` },
  };
}

interface ScimUserBody {
  userName?: string;
  externalId?: string;
  displayName?: string;
  name?: { givenName?: string; familyName?: string; formatted?: string };
  emails?: { value: string; primary?: boolean }[];
  active?: boolean;
}

const displayName = (b: ScimUserBody) =>
  b.displayName || b.name?.formatted || [b.name?.givenName, b.name?.familyName].filter(Boolean).join(' ') || b.userName?.split('@')[0] || 'User';

export async function scimRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/scim+json', { parseAs: 'string' }, (_req, body, done) => {
    // IdPs send the SCIM content type on bodiless DELETEs too
    if (!(body as string).trim()) return done(null, {});
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(Object.assign(new Error('Invalid JSON'), { statusCode: 400 }), undefined);
    }
  });

  app.addHook('preHandler', async (req: FastifyRequest, reply) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const org = token ? await prisma.organization.findUnique({ where: { scimTokenHash: sha256Hex(token) } }) : null;
    if (!org) return scimError(reply, 401, 'Invalid SCIM token');
    req.scimOrgId = org.id;
  });

  const base = (req: FastifyRequest) => `${req.protocol}://${req.headers.host}/api/v1/scim/v2`;

  app.get('/scim/v2/ServiceProviderConfig', async () => ({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{ type: 'oauthbearertoken', name: 'Bearer token', description: 'Token from Settings → Single sign-on' }],
  }));

  app.get('/scim/v2/Users', async (req, reply) => {
    const q = req.query as { filter?: string; startIndex?: string; count?: string };
    const where: { orgId: string; email?: string } = { orgId: req.scimOrgId };
    if (q.filter) {
      const m = /^userName eq "([^"]+)"$/i.exec(q.filter.trim());
      if (!m) return scimError(reply, 400, 'Only filter=userName eq "…" is supported');
      where.email = m[1].toLowerCase();
    }
    const startIndex = Math.max(1, Number(q.startIndex ?? 1));
    const count = Math.min(200, Math.max(0, Number(q.count ?? 100)));
    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({ where, orderBy: { createdAt: 'asc' }, skip: startIndex - 1, take: count }),
    ]);
    reply.type('application/scim+json');
    return { schemas: [LIST_SCHEMA], totalResults: total, startIndex, itemsPerPage: users.length, Resources: users.map((u) => toScim(u, base(req))) };
  });

  app.get('/scim/v2/Users/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const u = await prisma.user.findFirst({ where: { id, orgId: req.scimOrgId } });
    if (!u) return scimError(reply, 404, 'User not found');
    reply.type('application/scim+json');
    return toScim(u, base(req));
  });

  app.post('/scim/v2/Users', async (req, reply) => {
    const body = req.body as ScimUserBody;
    const email = (body.emails?.find((e) => e.primary)?.value ?? body.emails?.[0]?.value ?? body.userName ?? '').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return scimError(reply, 400, 'userName must be an email address');
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return scimError(reply, 409, 'User already exists');
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.scimOrgId } });
    const u = await prisma.user.create({
      data: {
        email,
        name: displayName(body),
        passwordHash: `sso:${randomToken(24)}`,
        role: org.ssoDefaultRole,
        orgId: org.id,
        externalId: body.externalId ?? null,
        disabledAt: body.active === false ? new Date() : null,
      },
    });
    await prisma.activityLog.create({ data: { orgId: org.id, type: 'user.joined', actor: { kind: 'system' }, data: { via: 'scim', email } } });
    reply.code(201).type('application/scim+json');
    return toScim(u, base(req));
  });

  async function setActive(userId: string, active: boolean) {
    await prisma.user.update({ where: { id: userId }, data: { disabledAt: active ? null : new Date() } });
    if (!active) await prisma.session.deleteMany({ where: { userId } });
  }

  app.put('/scim/v2/Users/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as ScimUserBody;
    const u = await prisma.user.findFirst({ where: { id, orgId: req.scimOrgId } });
    if (!u) return scimError(reply, 404, 'User not found');
    await prisma.user.update({ where: { id }, data: { name: displayName(body), externalId: body.externalId ?? u.externalId } });
    if (body.active !== undefined) await setActive(id, body.active);
    reply.type('application/scim+json');
    return toScim(await prisma.user.findUniqueOrThrow({ where: { id } }), base(req));
  });

  app.patch('/scim/v2/Users/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { Operations?: { op: string; path?: string; value?: unknown }[] };
    const u = await prisma.user.findFirst({ where: { id, orgId: req.scimOrgId } });
    if (!u) return scimError(reply, 404, 'User not found');
    for (const op of body.Operations ?? []) {
      if (op.op.toLowerCase() !== 'replace') continue;
      const value = op.value as Record<string, unknown> | boolean | string;
      // Entra sends {path:"active", value:"False"}; Okta sends {value:{active:false}}
      const active = op.path === 'active' ? value : typeof value === 'object' ? (value as Record<string, unknown>).active : undefined;
      if (active !== undefined) await setActive(id, active === true || String(active).toLowerCase() === 'true');
      const name = op.path === 'displayName' ? value : typeof value === 'object' ? (value as Record<string, unknown>).displayName : undefined;
      if (typeof name === 'string' && name.trim()) await prisma.user.update({ where: { id }, data: { name: name.trim() } });
    }
    reply.type('application/scim+json');
    return toScim(await prisma.user.findUniqueOrThrow({ where: { id } }), base(req));
  });

  /** SCIM delete deactivates: agreements must stay attributable to their sender. */
  app.delete('/scim/v2/Users/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const u = await prisma.user.findFirst({ where: { id, orgId: req.scimOrgId } });
    if (!u) return scimError(reply, 404, 'User not found');
    if (u.role === 'OWNER') return scimError(reply, 400, 'Owners cannot be removed through SCIM');
    await setActive(id, false);
    reply.code(204);
  });
}
