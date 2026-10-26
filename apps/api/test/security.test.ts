import type { FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';
import { base32Encode, totp, verifyTotp } from '../src/lib/totp.js';
import { client, getApp, lastMail, makePdf, multipart, registerSender, uid, verifyEmail } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await getApp();
});

type Client = ReturnType<typeof client>;
const PASSWORD = 'correct-horse-battery';

async function draft(c: Client) {
  let env = await c.json('POST', '/envelopes', { json: { title: 'Security check' } });
  const { payload, headers } = multipart('s.pdf', await makePdf('Security'));
  const doc = await c.json('POST', `/envelopes/${env.id}/documents`, { payload, headers });
  env = await c.json('PUT', `/envelopes/${env.id}/recipients`, { json: [{ name: 'Signer', email: `s-${uid()}@example.test` }] });
  await c.json('PUT', `/envelopes/${env.id}/fields`, {
    json: [{ documentId: doc.id, recipientId: env.recipients[0].id, type: 'SIGNATURE', page: 0, x: 0.1, y: 0.1, width: 0.3, height: 0.06 }],
  });
  return env.id as string;
}

const login = (email: string, password = PASSWORD) => {
  const c = client(app);
  return c.call('POST', '/auth/login', { json: { email, password } }).then((res) => ({ c, res }));
};

/** Turns on 2FA for the signed-in user; returns the secret and recovery codes. */
async function enable2fa(c: Client) {
  const setup = await c.json('POST', '/auth/2fa/setup');
  expect(setup.qrSvg).toContain('<svg');
  expect(setup.otpauthUri).toMatch(/^otpauth:\/\/totp\/Nuronix%20eSign/);
  expect((await c.call('POST', '/auth/2fa/enable', { json: { code: '000000' } })).statusCode).toBe(400);
  const { recoveryCodes } = await c.json('POST', '/auth/2fa/enable', { json: { code: totp(setup.secret) } });
  expect(recoveryCodes).toHaveLength(10);
  return { secret: setup.secret as string, recoveryCodes: recoveryCodes as string[] };
}

describe('TOTP', () => {
  it('matches the RFC 6238 test vector and tolerates one step of drift', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(totp(secret, 59_000)).toBe('287082');
    expect(verifyTotp(secret, '287082', 59_000 + 30_000)).toBe(true);
    expect(verifyTotp(secret, '287082', 59_000 + 90_000)).toBe(false);
  });
});

describe('email verification', () => {
  it('blocks sending until the sender confirms their email', async () => {
    const c = client(app);
    const email = `new-${uid()}@acme.test`;
    await c.json('POST', '/auth/register', { json: { name: 'New', email, password: PASSWORD, organizationName: 'New Co' } });
    expect((await c.json('GET', '/auth/me')).user.emailVerified).toBe(false);
    const id = await draft(c);
    const blocked = await c.call('POST', `/envelopes/${id}/send`);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('email_unverified');

    await c.json('POST', '/auth/verify-email/resend');
    await verifyEmail(c, email);
    expect((await c.json('GET', '/auth/me')).user.emailVerified).toBe(true);
    expect((await c.call('POST', `/envelopes/${id}/send`)).statusCode).toBe(200);
    expect((await c.call('POST', '/auth/verify-email', { json: { token: 'not-a-real-token-at-all' } })).statusCode).toBe(400);
  });
});

describe('passwords', () => {
  it('resets by email link, signs out every device and works once', async () => {
    const { c, email } = await registerSender(app);
    // Unknown emails get the same answer and no email
    expect((await client(app).json('POST', '/auth/password/forgot', { json: { email: `nobody-${uid()}@acme.test` } })).ok).toBe(true);
    await client(app).json('POST', '/auth/password/forgot', { json: { email } });
    const token = lastMail(email, /Reset your password/).text.match(/\/reset-password\/([\w-]+)/)![1];

    expect((await client(app).call('POST', '/auth/password/reset', { json: { token, password: 'short' } })).statusCode).toBe(400);
    await client(app).json('POST', '/auth/password/reset', { json: { token, password: 'a-brand-new-passphrase' } });
    expect((await client(app).call('POST', '/auth/password/reset', { json: { token, password: 'another-new-passphrase' } })).statusCode).toBe(400);
    expect((await c.call('GET', '/auth/me')).statusCode).toBe(401);
    expect(lastMail(email, /Security notice: your password was changed/)).toBeTruthy();
    expect((await login(email)).res.statusCode).toBe(401);
    expect((await login(email, 'a-brand-new-passphrase')).res.statusCode).toBe(200);
  });

  it('changes the password, keeping this session and ending the others', async () => {
    const { c, email } = await registerSender(app);
    const { c: other } = await login(email);
    expect((await c.call('POST', '/auth/password/change', { json: { currentPassword: 'wrong-password', newPassword: 'a-brand-new-passphrase' } })).statusCode).toBe(400);
    await c.json('POST', '/auth/password/change', { json: { currentPassword: PASSWORD, newPassword: 'a-brand-new-passphrase' } });
    expect((await c.call('GET', '/auth/me')).statusCode).toBe(200);
    expect((await other.call('GET', '/auth/me')).statusCode).toBe(401);
  });
});

describe('two-factor authentication', () => {
  it('asks for a code at sign-in, accepts recovery codes once and locks after repeated failures', async () => {
    const { c, email } = await registerSender(app);
    const { secret, recoveryCodes } = await enable2fa(c);
    expect(lastMail(email, /two-factor authentication was enabled/)).toBeTruthy();

    // Password alone no longer signs in
    const first = await login(email);
    expect(first.res.json()).toMatchObject({ mfaRequired: true });
    expect(first.res.cookies.find((x) => x.name === 'ds_session')).toBeUndefined();
    const mfaToken = first.res.json().mfaToken;
    for (let i = 0; i < 5; i++) {
      expect((await first.c.call('POST', '/auth/login/mfa', { json: { token: mfaToken, code: '000000' } })).statusCode).toBe(401);
    }
    // Locked even with the right code now
    expect((await first.c.call('POST', '/auth/login/mfa', { json: { token: mfaToken, code: totp(secret) } })).statusCode).toBe(401);

    const second = await login(email);
    await second.c.json('POST', '/auth/login/mfa', { json: { token: second.res.json().mfaToken, code: totp(secret) } });
    expect((await second.c.call('GET', '/auth/me')).statusCode).toBe(200);

    const third = await login(email);
    await third.c.json('POST', '/auth/login/mfa', { json: { token: third.res.json().mfaToken, code: recoveryCodes[0].toLowerCase() } });
    const fourth = await login(email);
    expect((await fourth.c.call('POST', '/auth/login/mfa', { json: { token: fourth.res.json().mfaToken, code: recoveryCodes[0] } })).statusCode).toBe(401);
    expect((await c.json('GET', '/auth/2fa')).recoveryCodesLeft).toBe(9);

    // Turning it off needs both the password and a code
    expect((await c.call('POST', '/auth/2fa/disable', { json: { password: PASSWORD, code: '000000' } })).statusCode).toBe(400);
    await c.json('POST', '/auth/2fa/disable', { json: { password: PASSWORD, code: totp(secret) } });
    expect((await login(email)).res.json()).not.toHaveProperty('mfaRequired');
  });

  it('lets an organisation require two-factor for everyone', async () => {
    const { c } = await registerSender(app);
    expect((await c.call('PATCH', '/organization', { json: { require2fa: true } })).statusCode).toBe(400);
    await enable2fa(c);
    await c.json('PATCH', '/organization', { json: { require2fa: true } });

    // A new member must set up 2FA before using the app
    const memberEmail = `m-${uid()}@acme.test`;
    await c.json('POST', '/team/invitations', { json: { email: memberEmail } });
    const invite = lastMail(memberEmail, /Join/).text.match(/\/invite\/([\w-]+)/)![1];
    const m = client(app);
    await m.json('POST', `/invitations/${invite}/accept`, { json: { name: 'Member', password: PASSWORD } });
    const me = await m.json('GET', '/auth/me');
    expect(me.user).toMatchObject({ emailVerified: true, mfaSetupRequired: true });
    const blocked = await m.call('GET', '/envelopes');
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('mfa_setup_required');
    await enable2fa(m);
    expect((await m.call('GET', '/envelopes')).statusCode).toBe(200);
    expect((await m.call('POST', '/auth/2fa/disable', { json: { password: PASSWORD, code: '123456' } })).statusCode).toBe(403);
  });
});

describe('profile', () => {
  it('stores the app language and name', async () => {
    const { c } = await registerSender(app);
    expect((await c.call('PATCH', '/auth/profile', { json: { locale: 'fr' } })).statusCode).toBe(400);
    await c.json('PATCH', '/auth/profile', { json: { locale: 'hi', name: 'Sam S.' } });
    expect((await c.json('GET', '/auth/me')).user).toMatchObject({ locale: 'hi', name: 'Sam S.' });
  });
});

describe('Office add-in sessions', () => {
  it('issues a session token that works in a header where cookies are unavailable', async () => {
    const { c } = await registerSender(app);
    const { token } = await c.json('POST', '/auth/session-token');
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { 'x-session-token': token } });
    expect(res.statusCode).toBe(200);
    expect((await c.json('GET', '/auth/sessions')).some((x: { userAgent: string }) => x.userAgent === 'Office add-in')).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { 'x-session-token': 'nope' } })).statusCode).toBe(401);
    expect((await client(app).call('POST', '/auth/session-token')).statusCode).toBe(401);
  });
});

describe('sessions', () => {
  it('lists devices and signs out the others', async () => {
    const { c, email } = await registerSender(app);
    const { c: other } = await login(email);
    const sessions = await c.json('GET', '/auth/sessions');
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect((await c.json('POST', '/auth/sessions/revoke-others')).revoked).toBe(1);
    expect((await other.call('GET', '/auth/me')).statusCode).toBe(401);
    expect((await c.call('GET', '/auth/me')).statusCode).toBe(200);
  });
});
