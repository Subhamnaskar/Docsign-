import type { FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';
import { finalizeEnvelope } from '../src/envelopes/service.js';
import { client, getApp, lastMail, makePdf, multipart, registerSender, signaturePng, uid, waitFor } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await getApp();
});

type Sender = Awaited<ReturnType<typeof registerSender>>['c'];

/** Builds a ready-to-send envelope with one document and the given signers. */
async function draftEnvelope(c: Sender, signers: { name: string; email: string; locale?: string; routingOrder?: number }[], extra: object = {}) {
  let env = await c.json('POST', '/envelopes', { json: { title: `Agreement ${uid()}`, documentType: 'nda', ...extra } });
  const { payload, headers } = multipart('contract.pdf', await makePdf('Contract', 2));
  const doc = await c.json('POST', `/envelopes/${env.id}/documents`, { payload, headers });
  env = await c.json('PUT', `/envelopes/${env.id}/recipients`, {
    json: signers.map((s, i) => ({ role: 'SIGNER', routingOrder: s.routingOrder ?? i + 1, ...s })),
  });
  env = await c.json('PUT', `/envelopes/${env.id}/fields`, {
    json: env.recipients.flatMap((r: { id: string }, i: number) => [
      { documentId: doc.id, recipientId: r.id, type: 'SIGNATURE', page: 1, x: 0.1, y: 0.1 + i * 0.2, width: 0.3, height: 0.06 },
      { documentId: doc.id, recipientId: r.id, type: 'DATE_SIGNED', page: 1, x: 0.5, y: 0.1 + i * 0.2, width: 0.2, height: 0.03 },
    ]),
  });
  return { env, doc };
}

/** Signs as a recipient the way the web app does: open link, OTP, complete. */
async function signAs(email: string, opts: { values?: (f: { id: string; type: string }) => string } = {}) {
  const link = lastMail(email, /./).text.match(/\/sign\/([\w.-]+)/)?.[1];
  if (!link) throw new Error('no signing link');
  const s = client(app);
  await s.json('GET', `/signing/${link}`);
  await s.json('POST', `/signing/${link}/otp/send`);
  const code = lastMail(email, /\d{6}/).subject.match(/\d{6}/)![0];
  await s.json('POST', `/signing/${link}/otp/verify`, { json: { code } });
  const session = await s.json('GET', `/signing/${link}`);
  const values = Object.fromEntries(
    session.fields.map((f: { id: string; type: string }) => [f.id, opts.values?.(f) ?? (f.type === 'SIGNATURE' ? signaturePng() : '')]),
  );
  await s.json('POST', `/signing/${link}/complete`, { json: { consent: true, values } });
  return { link, session };
}

describe('sequential signing flow', () => {
  it('routes in order, seals the documents and verifies publicly', async () => {
    const { c } = await registerSender(app);
    const bob = `bob-${uid()}@example.test`;
    const ana = `ana-${uid()}@example.test`;
    const { env, doc } = await draftEnvelope(c, [
      { name: 'Bob', email: bob },
      { name: 'Ana', email: ana, locale: 'es' },
    ]);

    const sent = await c.json('POST', `/envelopes/${env.id}/send`);
    expect(sent.status).toBe('SENT');
    expect(sent.recipients.map((r: { status: string }) => r.status)).toEqual(['SENT', 'CREATED']);
    expect(() => lastMail(ana, /./)).toThrow(); // not her turn yet

    await signAs(bob);
    // Spanish signer gets a Spanish invitation once Bob is done
    const invite = await waitFor(async () => { try { return lastMail(ana, /Firme/); } catch { return null; } }, (m) => m !== null);
    expect(invite!.html).toContain('lang="es"');

    await signAs(ana);
    const done = await waitFor(() => c.json('GET', `/envelopes/${env.id}`), (e) => e.status === 'COMPLETED');
    expect(done.hasCertificate).toBe(true);

    const audit = await c.json('GET', `/envelopes/${env.id}/audit`);
    expect(audit.chain.valid).toBe(true);
    expect(audit.events.map((e: { type: string }) => e.type)).toEqual(
      expect.arrayContaining(['envelope.sent', 'recipient.verified', 'recipient.consented', 'recipient.signed', 'document.sealed', 'envelope.completed']),
    );

    const signed = await c.call('GET', `/envelopes/${env.id}/documents/${doc.id}/file`);
    const { payload, headers } = multipart('signed.pdf', signed.rawPayload);
    const v = await client(app).json('POST', '/verify', { payload, headers });
    expect(v.match.envelopeId).toBe(env.id);
    expect(v.match.auditTrail.valid).toBe(true);
    expect(v.signatures[0]).toMatchObject({ integrityValid: true, coversWholeDocument: true });

    // Completion emails reach both signers and the sender, with attachments
    expect(lastMail(bob, /Completed/).attachments).toHaveLength(2);
    expect(lastMail(ana, /Completado/).subject).toContain(env.title);
  });

  it('is idempotent when finalisation runs twice', async () => {
    const { c } = await registerSender(app);
    const email = `solo-${uid()}@example.test`;
    const { env } = await draftEnvelope(c, [{ name: 'Solo', email }]);
    await c.json('POST', `/envelopes/${env.id}/send`);
    await signAs(email);
    await waitFor(() => c.json('GET', `/envelopes/${env.id}`), (e) => e.status === 'COMPLETED');
    await finalizeEnvelope(env.id);
    const audit = await c.json('GET', `/envelopes/${env.id}/audit`);
    expect(audit.events.filter((e: { type: string }) => e.type === 'envelope.completed')).toHaveLength(1);
  });
});

describe('guardrails', () => {
  it('refuses to send without signature fields or when the policy blocks it', async () => {
    const { c } = await registerSender(app);
    const env = await c.json('POST', '/envelopes', { json: { title: 'Empty' } });
    const res = await c.call('POST', `/envelopes/${env.id}/send`);
    expect(res.statusCode).toBe(422);

    const { env: will } = await draftEnvelope(c, [{ name: 'X', email: `x-${uid()}@example.test` }], { documentType: 'will' });
    const blocked = await c.call('POST', `/envelopes/${will.id}/send`);
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().error.details.problems[0]).toMatch(/Wills/);
  });

  it('isolates organisations from each other', async () => {
    const a = await registerSender(app);
    const b = await registerSender(app);
    const env = await a.c.json('POST', '/envelopes', { json: { title: 'Private' } });
    expect((await b.c.call('GET', `/envelopes/${env.id}`)).statusCode).toBe(404);
    expect((await b.c.call('GET', `/envelopes/${env.id}/audit`)).statusCode).toBe(404);
    const list = await b.c.json('GET', '/envelopes');
    expect(list.data.find((e: { id: string }) => e.id === env.id)).toBeUndefined();
  });

  it('rejects forged signing links and signing without OTP', async () => {
    const { c } = await registerSender(app);
    const email = `v-${uid()}@example.test`;
    const { env } = await draftEnvelope(c, [{ name: 'V', email }]);
    await c.json('POST', `/envelopes/${env.id}/send`);
    const link = lastMail(email, /./).text.match(/\/sign\/([\w.-]+)/)![1];
    const [id, mac] = link.split('.');

    const anon = client(app);
    expect((await anon.call('GET', `/signing/${id}.${'0'.repeat(mac.length)}`)).statusCode).toBe(404);
    expect((await anon.call('POST', `/signing/${link}/complete`, { json: { consent: true, values: {} } })).statusCode).toBe(401);
    expect((await anon.call('GET', `/signing/${link}/documents/${env.documents[0].id}/file`)).statusCode).toBe(401);

    // Five wrong codes lock the code
    await anon.json('POST', `/signing/${link}/otp/send`);
    for (let i = 0; i < 5; i++) await anon.call('POST', `/signing/${link}/otp/verify`, { json: { code: '000000' } });
    const code = lastMail(email, /\d{6}/).subject.match(/\d{6}/)![0];
    expect((await anon.call('POST', `/signing/${link}/otp/verify`, { json: { code } })).statusCode).toBe(403);
  });

  it('accepts API keys and rejects revoked ones', async () => {
    const { c } = await registerSender(app);
    const { key, id } = await c.json('POST', '/api-keys', { json: { name: 'CI' } });
    const api = client(app);
    const auth = { authorization: `Bearer ${key}` };
    expect((await api.call('GET', '/envelopes', { headers: auth })).statusCode).toBe(200);
    await c.call('DELETE', `/api-keys/${id}`);
    expect((await api.call('GET', '/envelopes', { headers: auth })).statusCode).toBe(401);
  });

  it('declining closes the envelope and notifies the sender', async () => {
    const { c, email: senderEmail } = await registerSender(app);
    const email = `d-${uid()}@example.test`;
    const { env } = await draftEnvelope(c, [{ name: 'D', email }]);
    await c.json('POST', `/envelopes/${env.id}/send`);
    const link = lastMail(email, /./).text.match(/\/sign\/([\w.-]+)/)![1];
    const s = client(app);
    await s.json('POST', `/signing/${link}/otp/send`);
    await s.json('POST', `/signing/${link}/otp/verify`, { json: { code: lastMail(email, /\d{6}/).subject.match(/\d{6}/)![0] } });
    await s.json('POST', `/signing/${link}/decline`, { json: { reason: 'Wrong amount' } });
    expect((await c.json('GET', `/envelopes/${env.id}`)).status).toBe('DECLINED');
    expect(lastMail(senderEmail, /Declined/).text).toContain('Wrong amount');
  });
});

describe('templates and bulk send', () => {
  it('saves a template, creates envelopes from it and bulk sends with per-row errors', async () => {
    const { c } = await registerSender(app);
    const { env } = await draftEnvelope(c, [{ name: 'Template signer', email: `t-${uid()}@example.test` }]);
    const recipientId = env.recipients[0].id;
    const tpl = await c.json('POST', `/envelopes/${env.id}/save-as-template`, {
      json: { name: 'Offer letter', roleNames: { [recipientId]: 'Candidate' } },
    });
    expect(tpl.roles).toMatchObject([{ name: 'Candidate', role: 'SIGNER', fieldCount: 2 }]);
    const roleId = tpl.roles[0].id;

    const one = await c.json('POST', `/templates/${tpl.id}/envelopes`, {
      json: { recipients: [{ roleId, name: 'Priya', email: `priya-${uid()}@example.test`, locale: 'hi' }], send: true },
    });
    expect(one.status).toBe('SENT');
    expect(one.fields).toHaveLength(2);
    expect(one.recipients[0].locale).toBe('hi');

    const mismatch = await c.call('POST', `/templates/${tpl.id}/envelopes`, { json: { recipients: [] } });
    expect(mismatch.statusCode).toBe(422);

    const bulk = await c.json('POST', `/templates/${tpl.id}/bulk-send`, {
      json: {
        rows: [
          { recipients: [{ roleId, name: 'A', email: `a-${uid()}@example.test` }] },
          { recipients: [{ roleId, name: 'B', email: 'not-an-email' }] },
          { recipients: [{ roleId, name: 'C', email: `c-${uid()}@example.test` }], title: 'Custom title' },
        ],
      },
    });
    expect(bulk).toMatchObject({ sent: 2, failed: 1 });
    expect(bulk.results[1].problems[0]).toMatch(/not a valid email/);
    const custom = await c.json('GET', `/envelopes/${bulk.results[2].envelopeId}`);
    expect(custom.title).toBe('Custom title');
  });
});
