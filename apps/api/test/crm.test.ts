import type { FastifyInstance } from 'fastify';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { deliverCrmEvents } from '../src/crm/routes.js';
import { prisma } from '../src/db.js';
import { client, getApp, lastMail, makePdf, multipart, registerSender, signaturePng, uid, waitFor } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await getApp();
});
afterEach(() => vi.restoreAllMocks());

type Client = ReturnType<typeof client>;
const realFetch = globalThis.fetch;
type Call = { url: string; method: string; body: unknown; auth?: string };

function stub(handler: (url: string, method: string) => Response | undefined) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    const res = handler(url, method);
    if (!res) return realFetch(input, init);
    const raw = init?.body;
    const body = typeof raw === 'string' ? (raw.startsWith('{') ? JSON.parse(raw) : raw) : raw instanceof FormData ? 'form-data' : raw instanceof URLSearchParams ? Object.fromEntries(raw) : null;
    calls.push({ url, method, body, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
    return res;
  });
  return calls;
}

/** Sends and completes an agreement for one signer. */
async function completeAgreement(c: Client, extra: Record<string, unknown>) {
  const email = `crm-${uid()}@example.test`;
  let env = await c.json('POST', '/envelopes', { json: { title: 'Annual contract', ...extra } });
  const { payload, headers } = multipart('c.pdf', await makePdf('Contract'));
  const doc = await c.json('POST', `/envelopes/${env.id}/documents`, { payload, headers });
  env = await c.json('PUT', `/envelopes/${env.id}/recipients`, { json: [{ name: 'Meera Iyer', email }] });
  await c.json('PUT', `/envelopes/${env.id}/fields`, { json: [{ documentId: doc.id, recipientId: env.recipients[0].id, type: 'SIGNATURE', page: 0, x: 0.1, y: 0.1, width: 0.3, height: 0.06 }] });
  await c.json('POST', `/envelopes/${env.id}/send`);
  const link = lastMail(email, /Please sign/).text.match(/\/sign\/([\w.-]+)/)![1];
  const s = client(app);
  await s.json('POST', `/signing/${link}/otp/send`);
  await s.json('POST', `/signing/${link}/otp/verify`, { json: { code: lastMail(email, /\d{6}/).subject.match(/\d{6}/)![0] } });
  const session = await s.json('GET', `/signing/${link}`);
  await s.json('POST', `/signing/${link}/complete`, { json: { consent: true, values: { [session.fields[0].id]: signaturePng() } } });
  await waitFor(() => c.json('GET', `/envelopes/${env.id}`), (e) => e.status === 'COMPLETED');
  return { id: env.id as string, email };
}

describe('HubSpot', () => {
  it('logs notes on the contact and linked deal and attaches the signed PDF', async () => {
    const { c } = await registerSender(app);
    stub((url) => (url.includes('/account-info/v3/details') ? (url ? Response.json({ portalId: 4242 }) : undefined) : undefined));
    expect((await c.json('PUT', '/integrations/hubspot', { json: { token: 'pat-na1-0000000000000000000000' } })).accountLabel).toBe('Portal 4242');
    vi.restoreAllMocks();

    const { id, email } = await completeAgreement(c, { externalRefs: { hubspotDealId: '987' } });
    expect((await c.json('GET', `/envelopes/${id}`)).externalRefs).toEqual({ hubspotDealId: '987' });
    const calls = stub((url) => {
      if (url.endsWith('/crm/v3/objects/contacts/search')) return Response.json({ results: [] });
      if (url.endsWith('/crm/v3/objects/contacts')) return Response.json({ id: 'contact-1' });
      if (url.endsWith('/files/v3/files')) return Response.json({ id: 'file-9' });
      if (url.endsWith('/crm/v3/objects/notes')) return Response.json({ id: 'note' });
      return undefined;
    });
    // sent, signed and completed are queued in order
    await deliverCrmEvents(50);
    const notes = calls.filter((x) => x.url.endsWith('/crm/v3/objects/notes'));
    expect(notes.length).toBe(3);
    expect(calls.every((x) => x.auth === 'Bearer pat-na1-0000000000000000000000')).toBe(true);
    const created = calls.find((x) => x.url.endsWith('/crm/v3/objects/contacts'))!.body as { properties: Record<string, string> };
    expect(created.properties).toMatchObject({ email, firstname: 'Meera', lastname: 'Iyer' });
    const last = notes[2].body as { properties: Record<string, string>; associations: { to: { id: string }; types: { associationTypeId: number }[] }[] };
    expect(last.properties.hs_note_body).toContain('is complete');
    expect(last.properties.hs_attachment_ids).toBe('file-9');
    expect(last.associations.map((a) => [a.to.id, a.types[0].associationTypeId])).toEqual([['contact-1', 202], ['987', 214]]);
    const conns = await c.json('GET', '/integrations/crm');
    expect(conns.connections[0]).toMatchObject({ provider: 'hubspot', lastError: null });
  });
});

describe('Salesforce', () => {
  it('connects with OAuth, creates tasks, refreshes expired tokens and uploads the PDF to the linked record', async () => {
    config.crm.salesforceClientId = 'sf-client';
    config.crm.salesforceClientSecret = 'sf-secret';
    try {
      const { c } = await registerSender(app);
      const { url } = await c.json('POST', '/integrations/salesforce/connect');
      const state = new URL(url).searchParams.get('state')!;
      expect(url).toContain('client_id=sf-client');
      expect((await app.inject({ method: 'GET', url: `/api/v1/integrations/salesforce/callback?code=x&state=forged.state.00` })).headers.location).toMatch(/salesforce=invalid/);

      stub((u) => (u.endsWith('/services/oauth2/token') ? Response.json({ access_token: 'at-1', refresh_token: 'rt-1', instance_url: 'https://acme.my.salesforce.com' }) : undefined));
      const cb = await app.inject({ method: 'GET', url: `/api/v1/integrations/salesforce/callback?code=auth-code&state=${encodeURIComponent(state)}` });
      expect(cb.headers.location).toMatch(/salesforce=connected/);
      vi.restoreAllMocks();

      const { id } = await completeAgreement(c, { externalRefs: { salesforceRecordId: '006A000000XyZ' } });
      let first = true;
      const calls = stub((u, method) => {
        if (u.endsWith('/services/oauth2/token')) return Response.json({ access_token: 'at-2' });
        if (!u.startsWith('https://acme.my.salesforce.com/')) return undefined;
        // The first API call finds the token expired
        if (first) {
          first = false;
          return new Response('expired', { status: 401 });
        }
        if (u.includes('/query?')) return Response.json({ records: [{ Id: '003CONTACT' }] });
        if (method === 'POST') return Response.json({ id: 'x', success: true });
        return undefined;
      });
      await deliverCrmEvents(50);
      const refresh = calls.find((x) => x.url.endsWith('/services/oauth2/token'))!;
      expect(refresh.body).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'rt-1' });
      const tasks = calls.filter((x) => x.url.endsWith('/sobjects/Task'));
      expect(tasks).toHaveLength(3);
      expect(tasks[0].body).toMatchObject({ WhoId: '003CONTACT', WhatId: '006A000000XyZ', Status: 'Completed' });
      expect(calls.filter((x) => x.url.includes('/sobjects/')).every((x) => x.auth === 'Bearer at-2')).toBe(true);
      const file = calls.find((x) => x.url.endsWith('/sobjects/ContentVersion'))!.body as Record<string, string>;
      expect(file).toMatchObject({ FirstPublishLocationId: '006A000000XyZ', PathOnClient: 'c.pdf' });
      expect(Buffer.from(file.VersionData, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
      expect(await prisma.crmEvent.count({ where: { envelopeId: id, status: 'DELIVERED' } })).toBe(3);
    } finally {
      config.crm.salesforceClientId = '';
      config.crm.salesforceClientSecret = '';
    }
  });
});
