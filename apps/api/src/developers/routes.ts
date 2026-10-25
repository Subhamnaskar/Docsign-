import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { logActivity } from '../lib/activity.js';
import { API_KEY_PREFIX, requireAuth, requireRole, TEST_KEY_PREFIX } from '../lib/auth.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';
import { notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { listAdapters } from '../adapters/registry.js';
import { renderDelivery, WEBHOOK_EVENTS } from '../webhooks/dispatcher.js';
import { assertFeature } from '../billing/plans.js';

export async function developerRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  // Keys and webhooks grant access to every agreement in the organisation
  app.addHook('preHandler', requireRole('OWNER', 'ADMIN'));

  app.get('/api-keys', async (req) => {
    const keys = await prisma.apiKey.findMany({
      where: { orgId: req.auth.orgId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return keys.map(({ keyHash: _, ...k }) => k);
  });

  /** The full key is returned once, at creation. */
  app.post('/api-keys', async (req, reply) => {
    const { name, mode } = parse(z.object({ name: z.string().trim().min(1).max(80), mode: z.enum(['live', 'test']).default('live') }), req.body);
    if (mode === 'live') await assertFeature(req.auth.orgId, 'api');
    const key = `${mode === 'test' ? TEST_KEY_PREFIX : API_KEY_PREFIX}${randomToken(24)}`;
    const created = await prisma.apiKey.create({
      data: { orgId: req.auth.orgId, name, mode, prefix: key.slice(0, mode === 'test' ? 16 : 12), keyHash: sha256Hex(key) },
    });
    await logActivity(req, 'api_key.created', { id: created.id, name, prefix: created.prefix, mode });
    reply.code(201);
    return { id: created.id, name: created.name, mode: created.mode, prefix: created.prefix, createdAt: created.createdAt, key };
  });

  app.delete('/api-keys/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const res = await prisma.apiKey.updateMany({
      where: { id, orgId: req.auth.orgId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (res.count === 0) throw notFound('API key');
    await logActivity(req, 'api_key.revoked', { id });
    reply.code(204);
  });

  app.get('/webhooks', async (req) => {
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { orgId: req.auth.orgId },
      orderBy: { createdAt: 'desc' },
      include: { deliveries: { orderBy: { createdAt: 'desc' }, take: 10 } },
    });
    return { events: WEBHOOK_EVENTS, endpoints };
  });

  app.post('/webhooks', async (req, reply) => {
    await assertFeature(req.auth.orgId, 'api');
    const body = parse(
      z.object({
        url: z.string().url().refine((u) => /^https?:\/\//.test(u), 'Use an http(s) URL'),
        events: z.array(z.enum(WEBHOOK_EVENTS)).default([]),
      }),
      req.body,
    );
    const endpoint = await prisma.webhookEndpoint.create({
      data: { orgId: req.auth.orgId, url: body.url, events: body.events, secret: `whsec_${randomToken(24)}` },
    });
    await logActivity(req, 'webhook.created', { id: endpoint.id, url: body.url });
    reply.code(201);
    return endpoint;
  });

  app.delete('/webhooks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const res = await prisma.webhookEndpoint.deleteMany({ where: { id, orgId: req.auth.orgId } });
    if (res.count === 0) throw notFound('Webhook endpoint');
    await logActivity(req, 'webhook.deleted', { id });
    reply.code(204);
  });

  /** Sends a synchronous test event so users can check their receiver. */
  app.post('/webhooks/:id/test', async (req) => {
    const { id } = req.params as { id: string };
    const endpoint = await prisma.webhookEndpoint.findFirst({ where: { id, orgId: req.auth.orgId } });
    if (!endpoint) throw notFound('Webhook endpoint');
    try {
      const { body, headers } = await renderDelivery(endpoint, 'test', 'ping', { event: 'ping', createdAt: new Date().toISOString(), data: {} });
      const res = await fetch(endpoint.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) });
      return { ok: res.ok, status: res.status };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  app.get('/adapters', async () => listAdapters());
}
