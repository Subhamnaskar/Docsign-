import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { MAX_UPLOAD_BYTES } from '../documents/ingest.js';
import { addDocument } from '../envelopes/documents.js';
import { assertDraft, getVisibleEnvelope } from '../envelopes/service.js';
import { logActivity } from '../lib/activity.js';
import { clientInfo, requireAuth, requireRole } from '../lib/auth.js';
import { randomToken } from '../lib/crypto.js';
import { badRequest, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { WEBHOOK_EVENTS } from '../webhooks/dispatcher.js';
import { cloudConfig, fetchFromGoogleDrive, fetchFromLink } from './cloud.js';
import { fetchExternalFile } from './fetch.js';
import { isChatWebhookUrl } from '../webhooks/chat.js';
import { assertFeature } from '../billing/plans.js';

/** Example payloads for Zapier/Make field mapping (what each event's `data` looks like). */
const SAMPLES: Record<string, Record<string, unknown>> = {
  'envelope.sent': { envelopeId: 'cm_example', title: 'Offer letter' },
  'recipient.viewed': { envelopeId: 'cm_example', recipientId: 'cm_recipient' },
  'recipient.signed': { envelopeId: 'cm_example', recipientId: 'cm_recipient', email: 'signer@example.com' },
  'recipient.declined': { envelopeId: 'cm_example', recipientId: 'cm_recipient', reason: 'Wrong amount' },
  'envelope.completed': { envelopeId: 'cm_example', title: 'Offer letter', documents: [{ id: 'cm_doc', name: 'offer.pdf', sha256: '…' }] },
  'envelope.voided': { envelopeId: 'cm_example', reason: 'Replaced by a new version' },
  'envelope.expired': { envelopeId: 'cm_example' },
};

export async function integrationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  /** Which cloud pickers the web app can offer. */
  app.get('/integrations/config', async () => cloudConfig());

  /** Import a file picked in Google Drive, Dropbox or OneDrive. */
  app.post('/envelopes/:id/documents/cloud', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parse(
      z.discriminatedUnion('provider', [
        z.object({ provider: z.literal('google'), fileId: z.string().min(10).max(200), accessToken: z.string().min(10).max(4000) }),
        z.object({ provider: z.enum(['dropbox', 'onedrive']), url: z.string().url().max(4000), name: z.string().trim().min(1).max(200).optional() }),
      ]),
      req.body,
    );
    const env = await getVisibleEnvelope(req.auth, id);
    assertDraft(env);
    const file =
      body.provider === 'google'
        ? await fetchFromGoogleDrive(body.fileId, body.accessToken, MAX_UPLOAD_BYTES)
        : await fetchFromLink(body.provider, body.url, body.name, MAX_UPLOAD_BYTES);
    const label = { google: 'Google Drive', dropbox: 'Dropbox', onedrive: 'OneDrive' }[body.provider];
    const doc = await addDocument(env, file.filename, file.data, req.auth.actor, clientInfo(req), { importedFrom: label });
    reply.code(201);
    return doc;
  });

  /** Import a document from a share link (Google Drive/Docs, Dropbox, OneDrive, SharePoint, any https URL). */
  app.post('/envelopes/:id/documents/import', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { url } = parse(z.object({ url: z.string().url().max(2000) }), req.body);
    const env = await getVisibleEnvelope(req.auth, id);
    assertDraft(env);
    const file = await fetchExternalFile(url, MAX_UPLOAD_BYTES);
    const doc = await addDocument(env, file.filename, file.data, req.auth.actor, clientInfo(req), { importedFrom: new URL(url).hostname });
    reply.code(201);
    return doc;
  });

  // --- REST hooks (Zapier, Make, Power Automate) -------------------------------
  // These platforms subscribe and unsubscribe programmatically when a user turns
  // a workflow on or off; deliveries use the normal signed webhook pipeline.
  await app.register(async (r) => {
    r.addHook('preHandler', requireRole('OWNER', 'ADMIN'));

    /** Slack or Microsoft Teams channel notifications (incoming-webhook URL). */
    r.post('/notifications/chat', async (req, reply) => {
      const body = parse(
        z.object({ format: z.enum(['slack', 'teams']), url: z.string().url().max(2000), events: z.array(z.enum(WEBHOOK_EVENTS)).default([]) }),
        req.body,
      );
      if (!isChatWebhookUrl(body.format, body.url)) {
        throw badRequest(body.format === 'slack' ? 'Use a Slack incoming-webhook URL (https://hooks.slack.com/...).' : 'Use a Teams Workflows webhook URL.');
      }
      const endpoint = await prisma.webhookEndpoint.create({
        data: { orgId: req.auth.orgId, url: body.url, events: body.events, format: body.format, secret: `whsec_${randomToken(24)}` },
      });
      await logActivity(req, 'notification.created', { id: endpoint.id, format: body.format });
      reply.code(201);
      return { id: endpoint.id, format: endpoint.format, events: endpoint.events, createdAt: endpoint.createdAt };
    });

    r.post('/hooks', async (req, reply) => {
      await assertFeature(req.auth.orgId, 'api');
      const body = parse(
        z.object({ target_url: z.string().url().refine((u) => u.startsWith('https://'), 'Use an https URL'), event: z.enum(WEBHOOK_EVENTS) }),
        req.body,
      );
      const endpoint = await prisma.webhookEndpoint.create({
        data: { orgId: req.auth.orgId, url: body.target_url, events: [body.event], secret: `whsec_${randomToken(24)}` },
      });
      await logActivity(req, 'webhook.created', { id: endpoint.id, url: body.target_url, via: 'rest-hook' });
      reply.code(201);
      return { id: endpoint.id, event: body.event, target_url: body.target_url };
    });

    r.delete('/hooks/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const res = await prisma.webhookEndpoint.deleteMany({ where: { id, orgId: req.auth.orgId } });
      if (res.count === 0) throw notFound('Hook');
      reply.code(204);
    });

    r.get('/hooks/sample/:event', async (req) => {
      const { event } = req.params as { event: string };
      if (!SAMPLES[event]) throw notFound('Event');
      return [{ id: 'sample', event, createdAt: new Date().toISOString(), data: SAMPLES[event] }];
    });
  });
}
