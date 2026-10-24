import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { logActivity } from '../lib/activity.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { randomToken } from '../lib/crypto.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { normalizeSignaturePng } from '../lib/image.js';
import { getObject, putObject } from '../lib/storage.js';
import { parse } from '../lib/validate.js';
import { getBranding } from './branding.js';

const MAX_LOGO_BYTES = 512 * 1024;

export async function organizationRoutes(app: FastifyInstance) {
  // Public: logos appear in emails and on the signing page
  app.get('/branding/:orgId/logo', async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { logoKey: true } });
    if (!org?.logoKey) throw notFound('Logo');
    reply
      .header('Content-Type', org.logoKey.endsWith('.jpg') ? 'image/jpeg' : 'image/png')
      .header('Cache-Control', 'public, max-age=86400, immutable');
    return getObject(org.logoKey);
  });

  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);

    r.get('/organization/branding', async (req) => getBranding(req.auth.orgId));

    r.post('/organization/logo', { preHandler: requireRole('OWNER', 'ADMIN') }, async (req) => {
      const file = await req.file({ limits: { fileSize: MAX_LOGO_BYTES } });
      if (!file) throw badRequest('Attach an image in the "file" field.');
      let data = await file.toBuffer();
      if (file.file.truncated) throw badRequest('Logos are limited to 512 KB.');
      let ext: 'png' | 'jpg';
      if (data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
        ext = 'jpg';
      } else {
        // Re-encode PNGs so only well-formed images are ever served
        const png = normalizeSignaturePng(`data:image/png;base64,${data.toString('base64')}`);
        data = Buffer.from(png.split(',')[1], 'base64');
        ext = 'png';
      }
      const key = `branding/${req.auth.orgId}/logo-${randomToken(8)}.${ext}`;
      await putObject(key, data, ext === 'jpg' ? 'image/jpeg' : 'image/png');
      await prisma.organization.update({ where: { id: req.auth.orgId }, data: { logoKey: key } });
      await logActivity(req, 'branding.logo_updated');
      return getBranding(req.auth.orgId);
    });

    r.delete('/organization/logo', { preHandler: requireRole('OWNER', 'ADMIN') }, async (req) => {
      await prisma.organization.update({ where: { id: req.auth.orgId }, data: { logoKey: null } });
      await logActivity(req, 'branding.logo_removed');
      return getBranding(req.auth.orgId);
    });

    // --- Folders -----------------------------------------------------------
    r.get('/folders', async (req) => {
      const folders = await prisma.folder.findMany({
        where: { orgId: req.auth.orgId },
        orderBy: { name: 'asc' },
        include: { _count: { select: { envelopes: true } } },
      });
      return folders.map((f) => ({ id: f.id, name: f.name, count: f._count.envelopes }));
    });

    r.post('/folders', async (req, reply) => {
      const { name } = parse(z.object({ name: z.string().trim().min(1).max(80) }), req.body);
      if (await prisma.folder.findFirst({ where: { orgId: req.auth.orgId, name } })) throw conflict('A folder with that name exists.');
      reply.code(201);
      return prisma.folder.create({ data: { orgId: req.auth.orgId, name } });
    });

    r.patch('/folders/:id', async (req) => {
      const { id } = req.params as { id: string };
      const { name } = parse(z.object({ name: z.string().trim().min(1).max(80) }), req.body);
      const res = await prisma.folder.updateMany({ where: { id, orgId: req.auth.orgId }, data: { name } });
      if (res.count === 0) throw notFound('Folder');
      return { id, name };
    });

    /** Deleting a folder keeps its agreements; they become unfiled. */
    r.delete('/folders/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const res = await prisma.folder.deleteMany({ where: { id, orgId: req.auth.orgId } });
      if (res.count === 0) throw notFound('Folder');
      reply.code(204);
    });
  });
}
