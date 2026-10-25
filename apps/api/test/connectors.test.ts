import type { FastifyInstance } from 'fastify';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/db.js';
import { deliverPendingWebhooks, renderDelivery } from '../src/webhooks/dispatcher.js';
import { getApp, makePdf, multipart, registerSender, uid } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await getApp();
});
afterEach(() => vi.restoreAllMocks());

const realFetch = globalThis.fetch;
/** Answers selected hosts in-process and passes everything else through. */
function stubFetch(handler: (url: string, init?: RequestInit) => Response | undefined) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const res = handler(url, init);
    if (res) {
      calls.push({ url, init });
      return res;
    }
    return realFetch(input, init);
  });
  return calls;
}

describe('Slack and Teams notifications', () => {
  it('posts a formatted message to Slack when an agreement is sent', async () => {
    const { c } = await registerSender(app);
    expect((await c.call('POST', '/notifications/chat', { json: { format: 'slack', url: 'https://evil.example.com/hook' } })).statusCode).toBe(400);
    const hook = `https://hooks.slack.com/services/T000/B000/${uid()}`;
    await c.json('POST', '/notifications/chat', { json: { format: 'slack', url: hook, events: ['envelope.sent'] } });

    let env = await c.json('POST', '/envelopes', { json: { title: 'Vendor agreement' } });
    const { payload, headers } = multipart('v.pdf', await makePdf('Vendor'));
    const doc = await c.json('POST', `/envelopes/${env.id}/documents`, { payload, headers });
    env = await c.json('PUT', `/envelopes/${env.id}/recipients`, { json: [{ name: 'Vendor', email: `v-${uid()}@example.test` }] });
    await c.json('PUT', `/envelopes/${env.id}/fields`, {
      json: [{ documentId: doc.id, recipientId: env.recipients[0].id, type: 'SIGNATURE', page: 0, x: 0.1, y: 0.1, width: 0.3, height: 0.06 }],
    });

    const calls = stubFetch((url) => (url === hook ? new Response('ok') : undefined));
    await c.json('POST', `/envelopes/${env.id}/send`);
    await deliverPendingWebhooks(100);
    const sent = calls.find((x) => x.url === hook)!;
    const body = JSON.parse(sent.init!.body as string);
    expect(body.text).toContain('"Vendor agreement" was sent for signature');
    expect(body.blocks[1].elements[0]).toMatchObject({ text: { text: 'Open agreement' }, url: expect.stringContaining(`/envelopes/${env.id}`) });
    // Chat hooks get no signature headers
    expect((sent.init!.headers as Record<string, string>)['X-DocSign-Signature']).toBeUndefined();
    const delivery = await prisma.webhookDelivery.findFirst({ where: { endpoint: { url: hook } } });
    expect(delivery?.status).toBe('DELIVERED');
  });

  it('formats Teams messages as Adaptive Cards', async () => {
    const { body } = await renderDelivery({ format: 'teams', secret: 'x' }, 'd1', 'envelope.expired', { data: { envelopeId: 'missing', title: 'Lease' } });
    const card = JSON.parse(body).attachments[0];
    expect(card.contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(card.content.body[0].text).toContain('"Lease" expired');
  });
});

describe('cloud storage imports', () => {
  it('imports a Google Doc exported as PDF with the picker token', async () => {
    const { c } = await registerSender(app);
    const env = await c.json('POST', '/envelopes', { json: { title: 'From Drive' } });
    const pdf = await makePdf('Drive');
    const fileId = '1AbCdEfGhIjKlMnOp';
    const calls = stubFetch((url) => {
      if (url.startsWith(`https://www.googleapis.com/drive/v3/files/${fileId}?fields`)) {
        return Response.json({ name: 'Master services agreement', mimeType: 'application/vnd.google-apps.document' });
      }
      if (url.startsWith(`https://www.googleapis.com/drive/v3/files/${fileId}/export`)) return new Response(new Uint8Array(pdf));
      return undefined;
    });
    const doc = await c.json('POST', `/envelopes/${env.id}/documents/cloud`, { json: { provider: 'google', fileId, accessToken: 'ya29.test-token-value' } });
    expect(doc.name).toBe('Master services agreement.pdf');
    expect(calls.every((x) => (x.init?.headers as Record<string, string>).Authorization === 'Bearer ya29.test-token-value')).toBe(true);
    expect(calls[1].url).toContain('mimeType=application%2Fpdf');
  });

  it('refuses links that are not from the chosen provider', async () => {
    const { c } = await registerSender(app);
    const env = await c.json('POST', '/envelopes', { json: { title: 'Links' } });
    for (const [provider, url] of [
      ['dropbox', 'https://example.com/file.pdf'],
      ['onedrive', 'https://dl.dropboxusercontent.com/s/abc/file.pdf'],
    ]) {
      const res = await c.call('POST', `/envelopes/${env.id}/documents/cloud`, { json: { provider, url } });
      expect(res.statusCode).toBe(400);
    }
    expect(await c.json('GET', '/integrations/config')).toEqual({ google: null, dropbox: null, onedrive: null });
  });
});
