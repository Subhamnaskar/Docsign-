import type { FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { client, getApp, lastMail, makePdf, multipart, outbox, registerSender, signaturePng, uid, waitFor } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await getApp();
});

type Client = ReturnType<typeof client>;

/** Upload a document into a new self-sign draft and place my signature and date. */
async function prepare(c: Client, title = 'Joining letter') {
  const env = await c.json('POST', '/self-sign', { json: { title } });
  expect(env.recipients).toHaveLength(1);
  const { payload, headers } = multipart('joining-letter.pdf', await makePdf('Joining letter'));
  const doc = await c.json('POST', `/envelopes/${env.id}/documents`, { payload, headers });
  const me = env.recipients[0];
  await c.json('PUT', `/envelopes/${env.id}/fields`, {
    json: [
      { documentId: doc.id, recipientId: me.id, type: 'SIGNATURE', page: 0, x: 0.1, y: 0.7, width: 0.3, height: 0.06 },
      { documentId: doc.id, recipientId: me.id, type: 'DATE_SIGNED', page: 0, x: 0.5, y: 0.7, width: 0.2, height: 0.03 },
    ],
  });
  return { id: env.id as string, docId: doc.id as string };
}

/** Starts signing in this browser and completes it, the way the signing page does. */
async function signNow(c: Client, id: string) {
  const { signPath } = await c.json('POST', `/self-sign/${id}/start`);
  const token = signPath.split('/').pop()!;
  const session = await c.json('GET', `/signing/${token}`);
  expect(session).toMatchObject({ state: 'ready', verified: true, envelope: { selfSign: true } });
  const values = Object.fromEntries(session.fields.map((f: { id: string; type: string }) => [f.id, f.type === 'SIGNATURE' ? signaturePng() : '']));
  await c.json('POST', `/signing/${token}/complete`, { json: { consent: true, values } });
  await waitFor(() => c.json('GET', `/signing/${token}`), (s) => s.state === 'completed');
  return token;
}

describe('sign it yourself', () => {
  it('signs, downloads the sealed PDF and certificate, and sends it back', async () => {
    const { c, email } = await registerSender(app, 'IN');
    const { id, docId } = await prepare(c);
    const before = outbox().length;
    const token = await signNow(c, id);
    // Nobody was invited: the signer signed in their own browser
    expect(outbox().slice(before).some((m) => /Please sign/.test(m.subject))).toBe(false);

    const pdf = await c.call('GET', `/signing/${token}/documents/${docId}/file`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    const env = await prisma.envelope.findUniqueOrThrow({ where: { id }, include: { documents: true } });
    expect(env.status).toBe('COMPLETED');
    expect(env.documents[0].finalSha256).toBeTruthy();
    expect((await c.call('GET', `/signing/${token}/certificate`)).statusCode).toBe(200);

    const shared = await c.json('POST', `/signing/${token}/share`, { json: { to: ['hr@acme.test'], message: 'Please find my signed joining letter.' } });
    expect(shared.sent).toBe(1);
    const mail = lastMail('hr@acme.test', /Signed: Joining letter/);
    expect(mail.text).toContain('Please find my signed joining letter.');
    expect(mail.attachments?.map((a) => a.filename)).toEqual(['joining-letter (signed).pdf', 'Certificate of Completion.pdf']);
    const audit = await prisma.auditEvent.findFirst({ where: { envelopeId: id, type: 'envelope.shared' } });
    expect(audit?.data).toMatchObject({ to: ['hr@acme.test'] });
    // The signer also gets the completed copy by email
    expect(() => lastMail(email, /complete/i)).not.toThrow();
  });

  it('is free: works after the trial ends and does not use the allowance', async () => {
    const { c } = await registerSender(app);
    const orgId = (await c.json('GET', '/auth/me')).organization.id;
    await prisma.organization.update({ where: { id: orgId }, data: { trialEndsAt: new Date(Date.now() - 1000) } });
    const { id } = await prepare(c, 'Rental agreement');
    await signNow(c, id);
    await prisma.organization.update({ where: { id: orgId }, data: { trialEndsAt: new Date(Date.now() + 86_400_000) } });
    expect((await c.json('GET', '/billing')).usage.envelopes).toBe(0);
  });

  it('needs a signature field, and only the creator can start or share', async () => {
    const { c } = await registerSender(app);
    const env = await c.json('POST', '/self-sign', { json: {} });
    const { payload, headers } = multipart('x.pdf', await makePdf('X'));
    await c.json('POST', `/envelopes/${env.id}/documents`, { payload, headers });
    expect((await c.call('POST', `/self-sign/${env.id}/start`)).statusCode).toBe(400);

    const { id } = await prepare(c);
    const { signPath } = await c.json('POST', `/self-sign/${id}/start`);
    const token = signPath.split('/').pop();
    expect((await c.call('POST', `/signing/${token}/share`, { json: { to: ['hr@acme.test'] } })).statusCode).toBe(409);
    expect((await client(app).call('POST', `/signing/${token}/share`, { json: { to: ['hr@acme.test'] } })).statusCode).toBe(401);
  });

  it('works without an account: email code, personal account, keep it with a password', async () => {
    const email = `joiner-${uid()}@gmail.test`;
    const g = client(app);
    expect((await g.call('GET', '/auth/me')).statusCode).toBe(401);
    await g.json('POST', '/self-sign/guest/code', { json: { email, name: 'Priya Nair' } });
    const code = lastMail(email, /signing code/).subject.match(/\d{6}/)![0];
    expect((await g.call('POST', '/self-sign/guest/verify', { json: { email, name: 'Priya Nair', code: code === '000000' ? '111111' : '000000' } })).statusCode).toBe(401);
    await g.json('POST', '/self-sign/guest/verify', { json: { email, name: 'Priya Nair', code } });

    const me = await g.json('GET', '/auth/me');
    expect(me.user).toMatchObject({ email, guest: true, emailVerified: true });
    expect(me.organization.name).toBe('Priya Nair (personal)');
    const { id } = await prepare(g);
    await signNow(g, id);

    // A password login is impossible until they set one through "forgot password"
    expect((await client(app).call('POST', '/auth/login', { json: { email, password: 'anything-at-all' } })).statusCode).toBe(401);
    await client(app).json('POST', '/auth/password/forgot', { json: { email } });
    const resetToken = lastMail(email, /Reset your password/).text.match(/reset-password\/([\w-]+)/)![1];
    await client(app).json('POST', '/auth/password/reset', { json: { token: resetToken, password: 'my-new-password-123' } });
    const back = client(app);
    await back.json('POST', '/auth/login', { json: { email, password: 'my-new-password-123' } });
    expect((await back.json('GET', '/auth/me')).user.guest).toBe(false);

    // Real accounts must sign in normally
    const { email: real } = await registerSender(app);
    expect((await client(app).call('POST', '/self-sign/guest/code', { json: { email: real, name: 'X' } })).statusCode).toBe(409);
  });
});
