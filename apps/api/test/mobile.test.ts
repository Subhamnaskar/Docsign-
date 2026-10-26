import type { FastifyInstance } from 'fastify';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/db.js';
import { pushForEvent } from '../src/lib/push.js';
import { client, getApp, makePdf, multipart, registerSender, uid, waitFor } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await getApp();
});

/** Captures messages sent to the Expo push service instead of calling it. */
function capturePushes() {
  const sent: { to: string; title: string; body: string; data: Record<string, string> }[] = [];
  const real = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input).startsWith('https://exp.host/')) {
      const batch = JSON.parse(String(init!.body));
      sent.push(...batch);
      return new Response(JSON.stringify({ data: batch.map(() => ({ status: 'ok' })) }), { status: 200 });
    }
    return real(input, init);
  });
  return sent;
}
afterEach(() => vi.restoreAllMocks());

/** Signs in the way the app does: password, then a token in the x-session-token header. */
async function mobileLogin(email: string) {
  const res = await app.inject({ method: 'POST', url: '/api/v1/mobile/login', payload: { email, password: 'correct-horse-battery', platform: 'android' } });
  expect(res.statusCode).toBe(200);
  const { token } = res.json();
  const call = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
    app.inject({ method, url: `/api/v1${url}`, headers: { 'x-session-token': token }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { token, call };
}

async function sendTo(c: ReturnType<typeof client>, email: string) {
  let env = await c.json('POST', '/envelopes', { json: { title: `Offer ${uid()}` } });
  const { payload, headers } = multipart('offer.pdf', await makePdf());
  const doc = await c.json('POST', `/envelopes/${env.id}/documents`, { payload, headers });
  env = await c.json('PUT', `/envelopes/${env.id}/recipients`, { json: [{ name: 'Mira Signer', email }] });
  await c.json('PUT', `/envelopes/${env.id}/fields`, {
    json: [{ documentId: doc.id, recipientId: env.recipients[0].id, type: 'SIGNATURE', page: 0, x: 0.1, y: 0.1, width: 0.3, height: 0.06 }],
  });
  return c.json('POST', `/envelopes/${env.id}/send`);
}

describe('mobile app', () => {
  it('signs in with a token, lists agreements to sign and alerts the phone', async () => {
    const sender = await registerSender(app);
    const signer = await registerSender(app);
    const phone = await mobileLogin(signer.email);
    expect((await phone.call('GET', '/auth/me')).json().user.email).toBe(signer.email);

    const pushToken = `ExponentPushToken[${uid()}]`;
    expect((await phone.call('POST', '/mobile/push-devices', { token: pushToken, platform: 'android' })).statusCode).toBe(200);
    expect((await phone.call('POST', '/mobile/push-devices', { token: 'not-a-token', platform: 'android' })).statusCode).toBe(400);

    const pushes = capturePushes();
    const env = await sendTo(sender.c, signer.email);
    await waitFor(async () => pushes.length, (n) => n > 0);
    expect(pushes[0]).toMatchObject({ to: pushToken, title: 'Please sign', data: { screen: 'to-sign' } });
    // No signing link travels through the push service
    expect(JSON.stringify(pushes[0])).not.toContain('/sign/');

    const toSign = (await phone.call('GET', '/mobile/to-sign')).json();
    expect(toSign.emailVerified).toBe(true);
    const item = toSign.data.find((x: { envelopeId: string }) => x.envelopeId === env.id);
    expect(item).toMatchObject({ title: env.title, from: 'Sam Sender', organization: 'Acme' });
    expect(item.signingUrl).toMatch(/\/sign\/[\w]+\.[0-9a-f]{48}$/);

    // The sender's phone hears about progress
    const senderPhone = await mobileLogin(sender.email);
    await senderPhone.call('POST', '/mobile/push-devices', { token: `ExponentPushToken[${uid()}]`, platform: 'ios' });
    const before = pushes.length;
    await pushForEvent('recipient.signed', { envelopeId: env.id, recipientId: env.recipients[0].id });
    expect(pushes.slice(before)).toEqual([expect.objectContaining({ title: 'Signed', body: `Mira Signer signed "${env.title}".`, data: { screen: 'agreement', id: env.id } })]);
  });

  it('opens the website signed in through a one-time link', async () => {
    const { email } = await registerSender(app);
    const phone = await mobileLogin(email);
    expect((await phone.call('POST', '/mobile/web-session', { next: '//evil.test/x' })).statusCode).toBe(400);
    const { url, path } = (await phone.call('POST', '/mobile/web-session', { next: '/envelopes/new' })).json();
    expect(url.endsWith(path)).toBe(true);

    const first = await app.inject({ method: 'GET', url: path });
    expect(first.statusCode).toBe(302);
    expect(first.headers.location).toBe('/envelopes/new');
    const cookie = first.cookies.find((c) => c.name === 'ds_session');
    expect(cookie?.httpOnly).toBe(true);
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: `ds_session=${cookie!.value}` } });
    expect(me.json().user.email).toBe(email);

    // Used once only
    const again = await app.inject({ method: 'GET', url: path });
    expect(again.headers.location).toBe('/login?next=%2Fenvelopes%2Fnew');
  });

  it('signs out: the token stops working and the phone stops getting alerts', async () => {
    const { email } = await registerSender(app);
    const phone = await mobileLogin(email);
    const pushToken = `ExponentPushToken[${uid()}]`;
    await phone.call('POST', '/mobile/push-devices', { token: pushToken, platform: 'ios' });
    expect((await phone.call('POST', '/mobile/logout', { pushToken })).statusCode).toBe(200);
    expect((await phone.call('GET', '/auth/me')).statusCode).toBe(401);
    expect(await prisma.pushDevice.count({ where: { token: pushToken } })).toBe(0);
  });

  it('asks for the second factor when two-factor is on', async () => {
    const { email } = await registerSender(app);
    await prisma.user.update({ where: { email }, data: { totpEnabledAt: new Date() } });
    const res = await app.inject({ method: 'POST', url: '/api/v1/mobile/login', payload: { email, password: 'correct-horse-battery', platform: 'ios' } });
    expect(res.json()).toMatchObject({ mfaRequired: true });
    expect(res.json().token).toBeUndefined();
    const wrong = await app.inject({ method: 'POST', url: '/api/v1/mobile/login', payload: { email, password: 'wrong-password-123', platform: 'ios' } });
    expect(wrong.statusCode).toBe(401);
  });
});
