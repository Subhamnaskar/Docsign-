import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocSign, DocSignError, verifyWebhook } from '../../../sdks/node/src/index.js';
import { getApp, lastMail, makePdf, registerSender } from './helpers.js';

let app: FastifyInstance;
let baseUrl: string;
beforeAll(async () => {
  app = await getApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await app.close();
});

describe('OpenAPI', () => {
  it('publishes a 3.1 description of the main endpoints', async () => {
    const spec = (await app.inject({ method: 'GET', url: '/api/v1/openapi.json' })).json();
    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(['/envelopes', '/envelopes/{id}/send', '/doc-templates/{id}/generate', '/verify']));
    expect(spec.components.schemas.Field.properties.type.enum).toContain('MANDATE');
  });
});

describe('Node SDK and test mode', () => {
  it('runs a full flow with a test key on a plan without API access, watermarked and unbilled', async () => {
    const { c } = await registerSender(app);
    const orgId = (await c.json('GET', '/auth/me')).organization.id;
    // Starter has no API, but test keys are allowed on every plan
    const { prisma } = await import('../src/db.js');
    await prisma.organization.update({ where: { id: orgId }, data: { plan: 'starter', billingStatus: 'ACTIVE', seats: 1, currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) } });
    expect((await c.call('POST', '/api-keys', { json: { name: 'Live' } })).statusCode).toBe(402);
    const { key } = await c.json('POST', '/api-keys', { json: { name: 'Sandbox', mode: 'test' } });
    expect(key).toMatch(/^dsk_test_/);

    const ds = new DocSign({ apiKey: key, baseUrl });
    expect(ds.testMode).toBe(true);
    let env = await ds.envelopes.create({ title: 'SDK offer' });
    expect(env.testMode).toBe(true);
    const doc = await ds.envelopes.uploadDocument(env.id, await makePdf('SDK'), 'offer.pdf');
    env = await ds.envelopes.setRecipients(env.id, [{ name: 'Priya Shah', email: 'priya.sdk@example.test' }]);
    await ds.envelopes.setFields(env.id, [{ documentId: doc.id, recipientId: env.recipients[0].id, type: 'SIGNATURE', page: 0, x: 0.1, y: 0.1, width: 0.3, height: 0.06 }]);
    expect((await ds.envelopes.send(env.id)).status).toBe('SENT');
    expect(lastMail('priya.sdk@example.test', /^\[TEST\] /)).toBeTruthy();

    const usage = await c.json('GET', '/billing');
    expect(usage.usage.envelopes).toBe(0);
    const original = await ds.envelopes.downloadDocument(env.id, doc.id, { original: true });
    expect(original.subarray(0, 5).toString()).toBe('%PDF-');
    const err = await ds.envelopes.get('missing').catch((e) => e);
    expect(err).toBeInstanceOf(DocSignError);
    expect(err.status).toBe(404);

    // Test keys only see test agreements; sessions see both
    expect((await ds.envelopes.list()).data.map((e) => e.id)).toEqual([env.id]);
    expect((await c.json('GET', '/envelopes')).data.map((e: { id: string }) => e.id)).toContain(env.id);
  });

  it('verifies webhook signatures', () => {
    const body = JSON.stringify({ id: 'd1', event: 'envelope.completed', createdAt: new Date().toISOString(), data: { envelopeId: 'e1' } });
    const ts = Math.floor(Date.now() / 1000);
    const header = `t=${ts},v1=${createHmac('sha256', 'whsec_x').update(`${ts}.${body}`).digest('hex')}`;
    expect(verifyWebhook(body, header, 'whsec_x').data.envelopeId).toBe('e1');
    expect(() => verifyWebhook(body, header, 'whsec_other')).toThrow(DocSignError);
    expect(() => verifyWebhook(body, `t=${ts - 3600},v1=00`, 'whsec_x')).toThrow(/too old/);
  });
});

describe('Python SDK', () => {
  it('creates an agreement against the running API and verifies webhooks', async () => {
    const { c } = await registerSender(app);
    const { key } = await c.json('POST', '/api-keys', { json: { name: 'Py', mode: 'test' } });
    const script = `
import sys, json, hmac, hashlib, time
sys.path.insert(0, sys.argv[1])
from docsign import DocSign, DocSignError, verify_webhook
ds = DocSign(api_key=sys.argv[2], base_url=sys.argv[3])
env = ds.envelopes.create(title="Python agreement")
doc = ds.envelopes.upload_document(env["id"], b"%PDF-1.4\\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\\ntrailer<</Root 1 0 R>>\\n%%EOF", "py.pdf")
try:
    ds.envelopes.get("missing")
    missing = None
except DocSignError as e:
    missing = e.status
body = json.dumps({"event": "envelope.sent", "data": {}})
ts = int(time.time())
sig = hmac.new(b"s", (str(ts) + "." + body).encode(), hashlib.sha256).hexdigest()
ok = verify_webhook(body, "t=%d,v1=%s" % (ts, sig), "s")["event"]
print(json.dumps({"test": ds.test_mode, "pages": doc["pageCount"], "missing": missing, "webhook": ok}))
`;
    let out: string;
    try {
      // Async: the API runs in this process and must keep serving while Python calls it
      out = (await promisify(execFile)('python', ['-I', '-c', script, resolve(__dirname, '../../../sdks/python'), key, baseUrl], { encoding: 'utf8', timeout: 60_000 })).stdout;
    } catch (err) {
      // Python is optional on developer machines and CI
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    expect(JSON.parse(out.trim().split('\n').pop()!)).toEqual({ test: true, pages: 1, missing: 404, webhook: 'envelope.sent' });
  });
});
