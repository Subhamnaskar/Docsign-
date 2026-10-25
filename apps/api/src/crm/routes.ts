import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { logActivity } from '../lib/activity.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { hmacSha256Hex, randomToken, safeEqualHex } from '../lib/crypto.js';
import { badRequest, HttpError, notFound } from '../lib/errors.js';
import { seal } from '../lib/secretbox.js';
import { parse } from '../lib/validate.js';
import { describeEvent } from '../webhooks/chat.js';
import { CRM_PROVIDERS, signedFiles } from './providers.js';

const SYNCED_EVENTS = new Set(['envelope.sent', 'recipient.signed', 'recipient.declined', 'envelope.completed', 'envelope.voided']);
const MAX_ATTEMPTS = 8;

type Tx = Prisma.TransactionClient;

/** Called with the webhook outbox, in the same transaction: queues the event for each CRM the org connected. */
export async function enqueueCrmEvents(tx: Tx, orgId: string, event: string, data: Record<string, unknown>) {
  if (!SYNCED_EVENTS.has(event) || typeof data.envelopeId !== 'string') return;
  const conns = await tx.crmConnection.findMany({ where: { orgId }, select: { id: true } });
  if (!conns.length) return;
  await tx.crmEvent.createMany({ data: conns.map((c) => ({ connectionId: c.id, event, envelopeId: data.envelopeId as string, payload: data as Prisma.JsonObject })) });
}

/** Worker: pushes queued events to the CRMs with exponential backoff. */
export async function deliverCrmEvents(limit = 10) {
  const due = await prisma.crmEvent.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
    include: { connection: true },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
  });
  for (const ev of due) {
    const attempts = ev.attempts + 1;
    try {
      const env = await prisma.envelope.findUnique({ where: { id: ev.envelopeId }, include: { recipients: { orderBy: { routingOrder: 'asc' } } } });
      if (!env) {
        await prisma.crmEvent.update({ where: { id: ev.id }, data: { status: 'FAILED', attempts, lastError: 'Agreement no longer exists' } });
        continue;
      }
      const msg = await describeEvent(ev.event, ev.payload as Record<string, unknown>);
      // Reloaded per event: an earlier event in this batch may have refreshed the tokens
      const conn = await prisma.crmConnection.findUniqueOrThrow({ where: { id: ev.connectionId } });
      await CRM_PROVIDERS[conn.provider].sync(conn, {
        event: ev.event,
        envelope: { id: env.id, title: env.title, externalRefs: (env.externalRefs as Record<string, string> | null) ?? null },
        recipients: env.recipients.map((r) => ({ name: r.name, email: r.email, role: r.role, status: r.status })),
        text: msg.text.replace(/^\S+\s/, ''),
        url: msg.url ?? `${config.appUrl}/envelopes/${env.id}`,
        files: () => signedFiles(env.id),
      });
      await prisma.$transaction([
        prisma.crmEvent.update({ where: { id: ev.id }, data: { status: 'DELIVERED', attempts, lastError: null } }),
        prisma.crmConnection.update({ where: { id: ev.connectionId }, data: { lastSyncAt: new Date(), lastError: null } }),
      ]);
    } catch (err) {
      const message = (err as Error).message.slice(0, 500);
      await prisma.$transaction([
        prisma.crmEvent.update({
          where: { id: ev.id },
          data: { status: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING', attempts, lastError: message, nextAttemptAt: new Date(Date.now() + Math.min(30_000 * 2 ** (attempts - 1), 3_600_000)) },
        }),
        prisma.crmConnection.update({ where: { id: ev.connectionId }, data: { lastError: message } }),
      ]);
    }
  }
  return due.length;
}

const sfRedirect = () => `${config.appUrl}/api/v1/integrations/salesforce/callback`;
/** OAuth state: org and user, signed so the callback can trust it */
const signState = (orgId: string, nonce: string) => `${orgId}.${nonce}.${hmacSha256Hex(config.appSecret, `sf:${orgId}:${nonce}`)}`;

export async function crmRoutes(app: FastifyInstance) {
  /** Salesforce sends the admin back here after they approve the connection. */
  app.get('/integrations/salesforce/callback', async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    const back = (outcome: string) => reply.redirect(`${config.appUrl}/settings?tab=integrations&salesforce=${outcome}`, 303);
    const [orgId, nonce, mac] = (q.state ?? '').split('.');
    if (!orgId || !nonce || !mac || !safeEqualHex(mac, hmacSha256Hex(config.appSecret, `sf:${orgId}:${nonce}`))) return back('invalid');
    if (q.error || !q.code) return back('cancelled');
    const res = await fetch(`${config.crm.salesforceLoginUrl}/services/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: q.code, client_id: config.crm.salesforceClientId, client_secret: config.crm.salesforceClientSecret, redirect_uri: sfRedirect() }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return back('failed');
    const t = (await res.json()) as { access_token: string; refresh_token?: string; instance_url: string };
    if (!t.refresh_token) return back('no_refresh_token');
    const credentialsEnc = seal(JSON.stringify({ accessToken: t.access_token, refreshToken: t.refresh_token, instanceUrl: t.instance_url }));
    await prisma.crmConnection.upsert({
      where: { orgId_provider: { orgId, provider: 'salesforce' } },
      create: { orgId, provider: 'salesforce', credentialsEnc, accountLabel: new URL(t.instance_url).hostname, settings: { attachPdf: true } },
      update: { credentialsEnc, accountLabel: new URL(t.instance_url).hostname, lastError: null },
    });
    await prisma.activityLog.create({ data: { orgId, type: 'crm.connected', actor: { kind: 'system' }, data: { provider: 'salesforce' } } });
    return back('connected');
  });

  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);
    r.addHook('preHandler', requireRole('OWNER', 'ADMIN'));

    r.get('/integrations/crm', async (req) => {
      const conns = await prisma.crmConnection.findMany({ where: { orgId: req.auth.orgId } });
      return {
        salesforceAvailable: Boolean(config.crm.salesforceClientId),
        connections: conns.map((c) => ({ provider: c.provider, accountLabel: c.accountLabel, settings: c.settings, lastSyncAt: c.lastSyncAt, lastError: c.lastError, createdAt: c.createdAt })),
      };
    });

    /** HubSpot: paste a private app token with crm.objects.contacts, crm.objects.deals and files scopes. */
    r.put('/integrations/hubspot', async (req) => {
      const body = parse(z.object({ token: z.string().trim().min(20).max(500), attachPdf: z.boolean().default(true) }), req.body);
      const check = await fetch('https://api.hubapi.com/account-info/v3/details', { headers: { Authorization: `Bearer ${body.token}` }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
      if (!check?.ok) throw badRequest('HubSpot did not accept that token. Check it is a private app token with the contacts, deals and files scopes.');
      const info = (await check.json()) as { portalId?: number; uiDomain?: string };
      const data = { credentialsEnc: seal(JSON.stringify({ token: body.token })), settings: { attachPdf: body.attachPdf }, accountLabel: info.portalId ? `Portal ${info.portalId}` : 'HubSpot', lastError: null };
      await prisma.crmConnection.upsert({ where: { orgId_provider: { orgId: req.auth.orgId, provider: 'hubspot' } }, create: { orgId: req.auth.orgId, provider: 'hubspot', ...data }, update: data });
      await logActivity(req, 'crm.connected', { provider: 'hubspot' });
      return { connected: true, accountLabel: data.accountLabel };
    });

    r.post('/integrations/salesforce/connect', async (req) => {
      if (!config.crm.salesforceClientId) throw new HttpError(503, 'Salesforce is not set up on this server.', 'crm_unavailable');
      const q = new URLSearchParams({ response_type: 'code', client_id: config.crm.salesforceClientId, redirect_uri: sfRedirect(), scope: 'api refresh_token', state: signState(req.auth.orgId, randomToken(12)), prompt: 'consent' });
      return { url: `${config.crm.salesforceLoginUrl}/services/oauth2/authorize?${q}` };
    });

    r.patch('/integrations/:provider', async (req) => {
      const { provider } = req.params as { provider: string };
      const { attachPdf } = parse(z.object({ attachPdf: z.boolean() }), req.body);
      const res = await prisma.crmConnection.updateMany({ where: { orgId: req.auth.orgId, provider }, data: { settings: { attachPdf } } });
      if (!res.count) throw notFound('Connection');
      return { attachPdf };
    });

    r.delete('/integrations/:provider', async (req, reply) => {
      const { provider } = req.params as { provider: string };
      const res = await prisma.crmConnection.deleteMany({ where: { orgId: req.auth.orgId, provider } });
      if (!res.count) throw notFound('Connection');
      await logActivity(req, 'crm.disconnected', { provider });
      reply.code(204);
    });
  });
}
