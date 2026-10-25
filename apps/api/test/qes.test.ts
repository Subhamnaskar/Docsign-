import type { FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { getObject } from '../src/lib/storage.js';
import { verifyPdfSignatures } from '../src/trust/verify.js';
import { client, getApp, lastMail, makePdf, multipart, outbox, registerSender, signaturePng, uid, waitFor } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await getApp();
});

type Client = ReturnType<typeof client>;
const path = (absolute: string) => {
  const u = new URL(absolute);
  return u.pathname + u.search;
};
const formPost = (url: string, fields: Record<string, string>) =>
  app.inject({ method: 'POST', url, payload: new URLSearchParams(fields).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });

async function signerSession(email: string) {
  // The next signer is notified asynchronously after the previous one signs
  await waitFor(
    async () => outbox().some((m) => m.to === email && /Please sign/.test(m.subject)),
    (found) => found,
  );
  const link = lastMail(email, /Please sign/).text.match(/\/sign\/([\w.-]+)/)![1];
  const s = client(app);
  await s.json('POST', `/signing/${link}/otp/send`);
  await s.json('POST', `/signing/${link}/otp/verify`, { json: { code: lastMail(email, /\d{6}/).subject.match(/\d{6}/)![0] } });
  return { s, link };
}

async function draft(c: Client, title: string, recipients: Record<string, unknown>[]) {
  let env = await c.json('POST', '/envelopes', { json: { title, jurisdiction: 'EU' } });
  const { payload, headers } = multipart('q.pdf', await makePdf(title));
  const doc = await c.json('POST', `/envelopes/${env.id}/documents`, { payload, headers });
  env = await c.json('PUT', `/envelopes/${env.id}/recipients`, { json: recipients });
  await c.json('PUT', `/envelopes/${env.id}/fields`, {
    json: env.recipients.map((r: { id: string }, i: number) => ({ documentId: doc.id, recipientId: r.id, type: 'SIGNATURE', page: 0, x: 0.1, y: 0.1 + i * 0.12, width: 0.3, height: 0.08 })),
  });
  return env;
}

describe('qualified signatures (CSC API, sandbox trust service)', () => {
  it('signs through both authorisations, refuses a wrong PIN and seals a document that verifies', async () => {
    const { c } = await registerSender(app);
    const email = `qes-${uid()}@example.test`;
    const env = await draft(c, 'Share purchase agreement', [{ name: 'Lena Fischer', email, signatureMethod: 'QES' }]);
    expect((await c.json('POST', `/envelopes/${env.id}/send`)).status).toBe('SENT');
    const { s, link } = await signerSession(email);

    // Service sign-in: choose the certificate
    const start = async () => {
      const { url } = await s.json('POST', `/signing/${link}/qes/start`, { json: { consent: true, values: {} } });
      const q = Object.fromEntries(new URL(url).searchParams);
      expect(q).toMatchObject({ scope: 'service', login_hint: email });
      expect((await app.inject({ method: 'GET', url: path(url) })).body).toContain('Sign in to your trust service');
      const signedIn = await formPost('/api/v1/dev/csc/oauth2/authorize', { ...q, name: 'Lena Fischer', email });
      const afterService = await app.inject({ method: 'GET', url: path(signedIn.headers.location as string) });
      // Then authorise exactly the document hashes
      const credUrl = afterService.headers.location as string;
      const cq = Object.fromEntries(new URL(credUrl).searchParams);
      expect(cq).toMatchObject({ scope: 'credential', numSignatures: '1' });
      return cq;
    };

    const wrong = await start();
    const denied = await formPost('/api/v1/dev/csc/oauth2/authorize', { ...wrong, pin: '000000' });
    const cancelled = await app.inject({ method: 'GET', url: path(denied.headers.location as string) });
    expect(cancelled.headers.location).toMatch(/\?qes=cancelled$/);

    const cq = await start();
    const approved = await formPost('/api/v1/dev/csc/oauth2/authorize', { ...cq, pin: '482913' });
    const done = await app.inject({ method: 'GET', url: path(approved.headers.location as string) });
    expect(done.headers.location).toMatch(/\?qes=signed$/);
    await waitFor(() => c.json('GET', `/envelopes/${env.id}`), (e) => e.status === 'COMPLETED');

    const doc = await prisma.document.findFirstOrThrow({ where: { envelopeId: env.id } });
    const reports = await verifyPdfSignatures(await getObject(doc.finalKey!));
    const signatures = reports.filter((r) => r.kind === 'signature');
    expect(signatures.map((r) => r.signerName)).toEqual(['Lena Fischer', 'DocSign Platform Seal']);
    expect(signatures.every((r) => r.integrityValid && r.coversWholeDocument)).toBe(true);
    expect(signatures[0].issuerName).toBe('DocSign Sandbox QTSP (not qualified)');

    const audit = await c.json('GET', `/envelopes/${env.id}/audit`);
    const signed = audit.events.find((e: { type: string }) => e.type === 'recipient.signed');
    expect(signed.data).toMatchObject({ method: 'csc', sandbox: true });
    expect(audit.events.some((e: { type: string }) => e.type === 'recipient.esign_failed')).toBe(true);
  });
});

describe('witness signing', () => {
  it('orders the witness after the signer and records the attestation', async () => {
    const { c } = await registerSender(app);
    const signerEmail = `principal-${uid()}@example.test`;
    const witnessEmail = `witness-${uid()}@example.test`;
    const people = (witnessOrder: number) => [
      { name: 'Arjun Rao', email: signerEmail, routingOrder: 1 },
      { name: 'Kavya Nair', email: witnessEmail, routingOrder: witnessOrder, witnessFor: signerEmail },
    ];
    let env = await draft(c, 'Will codicil', people(1));
    expect(env.readiness).toContain('Kavya Nair must sign after Arjun Rao, whose signature they witness.');
    expect((await c.call('PUT', `/envelopes/${env.id}/recipients`, { json: [{ name: 'Self', email: signerEmail, witnessFor: signerEmail }] })).statusCode).toBe(400);
    env = await c.json('PUT', `/envelopes/${env.id}/recipients`, { json: people(2).map((p, i) => ({ ...p, id: env.recipients[i].id })) });
    expect(env.readiness).toEqual([]);
    await c.json('POST', `/envelopes/${env.id}/send`);

    const a = await signerSession(signerEmail);
    let session = await a.s.json('GET', `/signing/${a.link}`);
    await a.s.json('POST', `/signing/${a.link}/complete`, { json: { consent: true, values: { [session.fields[0].id]: signaturePng() } } });

    const w = await signerSession(witnessEmail);
    session = await w.s.json('GET', `/signing/${w.link}`);
    expect(session.recipient.witness).toMatchObject({ name: 'Arjun Rao', signed: true });
    const values = { [session.fields[0].id]: signaturePng() };
    expect((await w.s.call('POST', `/signing/${w.link}/complete`, { json: { consent: true, values } })).statusCode).toBe(400);
    await w.s.json('POST', `/signing/${w.link}/complete`, { json: { consent: true, values, attest: true } });
    await waitFor(() => c.json('GET', `/envelopes/${env.id}`), (e) => e.status === 'COMPLETED');

    const audit = await c.json('GET', `/envelopes/${env.id}/audit`);
    const witnessed = audit.events.filter((e: { type: string }) => e.type === 'recipient.signed')[1];
    expect(witnessed.data.witnessFor).toMatchObject({ name: 'Arjun Rao', email: signerEmail });
    expect(witnessed.data.attestation).toContain('signed this document in my presence');
  });
});
