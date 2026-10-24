import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { logActivity } from '../lib/activity.js';
import { createSession, requireAuth, requireRole, SESSION_COOKIE } from '../lib/auth.js';
import { sha256Hex } from '../lib/crypto.js';
import { conflict, unauthorized } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { JURISDICTIONS } from '../policy/jurisdictions.js';

const password = z.string().min(10, 'Use at least 10 characters').max(200);
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
      }),
      req.body,
    );
    if (await prisma.user.findUnique({ where: { email: body.email } })) {
      throw conflict('An account with this email already exists.');
    }
    const user = await prisma.user.create({
      data: {
        name: body.name,
        email: body.email,
        passwordHash: await bcrypt.hash(body.password, 12),
        role: 'OWNER',
        org: {
          create: { name: body.organizationName, jurisdiction: body.jurisdiction, dataRegion: config.cellRegion },
        },
      },
    });
    await createSession(reply, user.id);
    reply.code(201);
    return { id: user.id, name: user.name, email: user.email };
  });

  app.post('/auth/login', strict, async (req, reply) => {
    const body = parse(z.object({ email: z.string().trim().toLowerCase(), password: z.string() }), req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    const ok = await bcrypt.compare(body.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw unauthorized('Incorrect email or password.');
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
      user: user && { id: user.id, name: user.name, email: user.email, role: user.role },
      organization: {
        id: org.id,
        name: org.name,
        jurisdiction: org.jurisdiction,
        dataRegion: org.dataRegion,
        brandColor: org.brandColor,
        embedOrigins: org.embedOrigins,
      },
      cell: config.cellRegion,
    };
  });

  app.patch('/organization', { preHandler: [requireAuth, requireRole('OWNER', 'ADMIN')] }, async (req) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(120).optional(),
        jurisdiction: z.string().refine((c) => c in JURISDICTIONS, 'Unknown jurisdiction').optional(),
        brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #4f46e5').nullable().optional(),
        embedOrigins: z.array(z.string().url().refine((u) => /^https?:\/\/[^/]+$/.test(u), 'Use an origin like https://app.example.com')).max(20).optional(),
      }),
      req.body,
    );
    const org = await prisma.organization.update({ where: { id: req.auth.orgId }, data: body });
    await logActivity(req, 'organization.updated', body);
    return { id: org.id, name: org.name, jurisdiction: org.jurisdiction, dataRegion: org.dataRegion, brandColor: org.brandColor, embedOrigins: org.embedOrigins };
  });
}
