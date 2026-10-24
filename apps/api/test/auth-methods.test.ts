import type { FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';
import { client, getApp, lastMail, makePdf, multipart, outbox, registerSender, signaturePng, uid, waitFor } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await getApp();
});

type C = ReturnType<typeof client>;

async function draft(c: C, recipient: Record<string, unknown>) {
  let env = await c.json('POST', '/envelopes', { json: { title: `Auth ${uid()}` } });
  const { payload, headers } = multipart('a.pdf', await makePdf());
  const doc = await c.json('POST', `/envelopes/${env.id}/documents`, { payload, headers });
  env = await c.json('PUT', `/envelopes/${env.id}/recipients`, { json: [{ name: 'Signer', email: `s-${uid()}@example.test`, ...recipient }] });
  await c.json('PUT', `/envelopes/${env.id}/fields`, {
    json: [{ documentId: doc.id, recipientId: env.recipients[0].id, type: 'SIGNATURE', page: 0, x: 0.1, y: 0.1, width: 0.3, height: 0.06 }],
  });
  return c.json('POST', `/envelopes/${env.id}/send`);
}

const linkFor = (email: string) => lastMail(email, /Please sign/).text.match(/\/sign\/([\w.-]+)/)![1];

describe('SMS and WhatsApp codes', () => {
  it.each([
    ['SMS_OTP', 'sms'],
    ['WHATSAPP_OTP', 'whatsapp'],
  ])('%s sends the code to the phone, not the email', async (authMethod, channel) => {
    const { c } = await registerSender(app);
    const phone = `+9198${String(Date.now()).slice(-8)}`;
    const env = await draft(c, { authMethod, phone });
    const email = env.recipients[0].email;
    const link = linkFor(email);
    const s = client(app);
    const sent = await s.json('POST', `/signing/${link}/otp/send`);
    expect(sent.channel).toBe(channel);
    expect(sent.sentTo).toBe(`•••• ${phone.slice(-4)}`);
    const sms = lastMail(`${channel}-${phone.slice(1)}@sms.local`, /\d{6}/);
    expect(() => lastMail(email, /verification code/)).toThrow();
    await s.json('POST', `/signing/${link}/otp/verify`, { json: { code: sms.text.match(/\d{6}/)![0] } });
    expect((await s.json('GET', `/signing/${link}`)).verified).toBe(true);
  });

  it('requires a phone number', async () => {
    const { c } = await registerSender(app);
    const env = await c.json('POST', '/envelopes', { json: { title: 'x' } });
    const res = await c.call('PUT', `/envelopes/${env.id}/recipients`, { json: [{ name: 'A', email: 'a@x.test', authMethod: 'SMS_OTP' }] });
    expect(res.statusCode).toBe(400);
  });
});

describe('access codes', () => {
  it('verifies with the shared code and locks after repeated failures', async () => {
    const { c } = await registerSender(app);
    const env = await draft(c, { authMethod: 'ACCESS_CODE', accessCode: 'BLUE-7731' });
    expect(env.recipients[0].hasAccessCode).toBe(true);
    const link = linkFor(env.recipients[0].email);
    const s = client(app);
    expect((await s.call('POST', `/signing/${link}/otp/send`)).statusCode).toBe(400);
    await s.json('POST', `/signing/${link}/otp/verify`, { json: { code: 'BLUE-7731' } });
    expect((await s.json('GET', `/signing/${link}`)).verified).toBe(true);

    const env2 = await draft(c, { authMethod: 'ACCESS_CODE', accessCode: 'RED-1' });
    const link2 = linkFor(env2.recipients[0].email);
    const t = client(app);
    for (let i = 0; i < 5; i++) await t.call('POST', `/signing/${link2}/otp/verify`, { json: { code: 'WRONG' } });
    expect((await t.call('POST', `/signing/${link2}/otp/verify`, { json: { code: 'RED-1' } })).statusCode).toBe(403);
  });
});

describe('embedded signing', () => {
  it('issues one-time tickets, works without cookies and restricts return URLs and framing', async () => {
    const { c } = await registerSender(app);
    await c.json('PATCH', '/organization', { json: { embedOrigins: ['https://app.partner.test'] } });
    const before = outbox().length;
    const env = await draft(c, { embedded: true, clientUserId: 'user-42' });
    const r = env.recipients[0];
    expect(r.embedded).toBe(true);
    expect(outbox().slice(before).some((m) => m.to === r.email)).toBe(false); // no invitation email

    const bad = await c.call('POST', `/envelopes/${env.id}/recipients/${r.id}/embedded-session`, { json: { returnUrl: 'https://evil.test/back' } });
    expect(bad.statusCode).toBe(400);
    const { url } = await c.json('POST', `/envelopes/${env.id}/recipients/${r.id}/embedded-session`, { json: { returnUrl: 'https://app.partner.test/done' } });
    const ticket = url.split('/').pop();

    const anon = client(app);
    expect((await anon.json('GET', `/frame-origins?ticket=${ticket}`)).origins).toEqual(['https://app.partner.test']);
    const started = await anon.json('POST', `/embed-sessions/${ticket}`);
    expect(started.returnUrl).toBe('https://app.partner.test/done');
    // Single use
    expect((await anon.call('POST', `/embed-sessions/${ticket}`)).statusCode).toBe(404);

    // A fresh client with no cookies signs using the header session
    const token = started.signPath.split('/').pop();
    const iframe = client(app);
    const header = { 'x-signer-session': started.sessionToken };
    const session = await iframe.json('GET', `/signing/${token}`, { headers: header });
    expect(session.verified).toBe(true);
    expect((await iframe.json('GET', `/frame-origins?token=${token}`)).origins).toEqual(['https://app.partner.test']);
    await iframe.json('POST', `/signing/${token}/complete`, { headers: header, json: { consent: true, values: { [session.fields[0].id]: signaturePng() } } });
    await waitFor(() => c.json('GET', `/envelopes/${env.id}`), (e) => e.status === 'COMPLETED');

    const audit = await c.json('GET', `/envelopes/${env.id}/audit`);
    expect(audit.events.find((e: { type: string }) => e.type === 'recipient.verified').data).toMatchObject({ method: 'embedded', clientUserId: 'user-42' });
  });

  it('does not allow framing ordinary signing links', async () => {
    const { c } = await registerSender(app);
    await c.json('PATCH', '/organization', { json: { embedOrigins: ['https://app.partner.test'] } });
    const env = await draft(c, {});
    const link = linkFor(env.recipients[0].email);
    expect((await client(app).json('GET', `/frame-origins?token=${link}`)).origins).toEqual([]);
  });
});
