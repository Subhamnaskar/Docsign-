import type { FastifyInstance } from 'fastify';
import { OAuth2Server } from 'oauth2-mock-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { directDownloadUrl } from '../src/integrations/fetch.js';
import { client, getApp, registerSender, uid } from './helpers.js';

let app: FastifyInstance;
let idp: OAuth2Server;
let nextClaims: Record<string, unknown> = {};

beforeAll(async () => {
  app = await getApp();
  idp = new OAuth2Server();
  await idp.issuer.keys.generate('RS256');
  await idp.start(0, 'localhost');
  idp.service.on('beforeTokenSigning', (token) => {
    Object.assign(token.payload, nextClaims);
  });
});
afterAll(async () => {
  await idp.stop();
});

/** Runs the browser part of an OIDC login: start → IdP → callback. Returns the callback response. */
async function ssoLogin(email: string, claims: Record<string, unknown>) {
  nextClaims = { email, email_verified: true, name: 'Sso Person', ...claims };
  const browser = client(app);
  const { url } = await browser.json('POST', '/auth/sso/start', { json: { email } });
  const idpRes = await fetch(url, { redirect: 'manual' });
  const back = new URL(idpRes.headers.get('location')!);
  const callback = await browser.call('GET', `/auth/sso/callback${back.search}`);
  return { browser, callback };
}

describe('single sign-on (OIDC)', () => {
  it('configures a provider, provisions users just in time and enforces SSO', async () => {
    const { c: owner, email: ownerEmail } = await registerSender(app);
    const domain = `sso-${uid()}.test`;
    await owner.json('PUT', '/organization/sso', {
      json: { issuer: idp.issuer.url, clientId: 'docsign', clientSecret: 's3cret', domains: [domain], enforced: true, defaultRole: 'MEMBER' },
    });
    const cfg = await owner.json('GET', '/organization/sso');
    expect(cfg).toMatchObject({ clientId: 'docsign', hasClientSecret: true, domains: [domain], enforced: true });
    expect(cfg.clientSecret).toBeUndefined();

    expect((await client(app).json('POST', '/auth/sso/lookup', { json: { email: `x@${domain}` } })).sso).toBe(true);

    const email = `new.person@${domain}`;
    const { browser, callback } = await ssoLogin(email, {});
    expect(callback.statusCode).toBe(303);
    expect(callback.headers.location).toMatch(/\/dashboard$/);
    const me = await browser.json('GET', '/auth/me');
    expect(me.user).toMatchObject({ email, role: 'MEMBER', name: 'Sso Person' });
    expect(me.organization.id).toBe((await owner.json('GET', '/auth/me')).organization.id);

    // Self-registration on an SSO domain is refused
    const reg = await client(app).call('POST', '/auth/register', {
      json: { name: 'X', email: `other@${domain}`, password: 'correct-horse-battery', organizationName: 'Shadow' },
    });
    expect(reg.statusCode).toBe(409);

    // A different email domain in the token is rejected
    const wrong = await ssoLogin(`x@${domain}`, { email: 'intruder@elsewhere.test' });
    expect(wrong.callback.headers.location).toMatch(/sso=wrong_domain/);

    // Owners keep password access even when SSO is enforced
    expect((await client(app).call('POST', '/auth/login', { json: { email: ownerEmail, password: 'correct-horse-battery' } })).statusCode).toBe(200);
  });

  it('rejects a callback without the flow cookie (CSRF / replay)', async () => {
    const res = await client(app).call('GET', '/auth/sso/callback?code=abc&state=xyz');
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toMatch(/sso=expired/);
  });
});

describe('SCIM provisioning', () => {
  it('creates, finds, deactivates and deletes users', async () => {
    const { c: owner } = await registerSender(app);
    const { token } = await owner.json('POST', '/organization/scim-token');
    const scim = client(app);
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/scim+json' };
    expect((await scim.call('GET', '/scim/v2/Users', { headers: { authorization: 'Bearer nope' } })).statusCode).toBe(401);

    const email = `scim-${uid()}@corp.test`;
    const created = await scim.call('POST', '/scim/v2/Users', {
      headers: auth,
      payload: Buffer.from(JSON.stringify({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: email, name: { givenName: 'Sam', familyName: 'Lee' }, active: true, externalId: 'okta-1' })),
    });
    expect(created.statusCode).toBe(201);
    const user = created.json();
    expect(user).toMatchObject({ userName: email, active: true, externalId: 'okta-1', displayName: 'Sam Lee' });

    const found = await scim.json('GET', `/scim/v2/Users?filter=${encodeURIComponent(`userName eq "${email}"`)}`, { headers: auth });
    expect(found.totalResults).toBe(1);

    // Entra-style patch
    await scim.json('PATCH', `/scim/v2/Users/${user.id}`, {
      headers: auth,
      payload: Buffer.from(JSON.stringify({ Operations: [{ op: 'Replace', path: 'active', value: 'False' }] })),
    });
    expect((await scim.json('GET', `/scim/v2/Users/${user.id}`, { headers: auth })).active).toBe(false);

    // Okta-style patch re-activates
    await scim.json('PATCH', `/scim/v2/Users/${user.id}`, {
      headers: auth,
      payload: Buffer.from(JSON.stringify({ Operations: [{ op: 'replace', value: { active: true } }] })),
    });
    expect((await scim.json('GET', `/scim/v2/Users/${user.id}`, { headers: auth })).active).toBe(true);

    expect((await scim.call('DELETE', `/scim/v2/Users/${user.id}`, { headers: auth })).statusCode).toBe(204);
    expect((await scim.json('GET', `/scim/v2/Users/${user.id}`, { headers: auth })).active).toBe(false);

    // Another organisation's token can't see this user
    const other = await registerSender(app);
    const { token: otherToken } = await other.c.json('POST', '/organization/scim-token');
    expect((await scim.call('GET', `/scim/v2/Users/${user.id}`, { headers: { authorization: `Bearer ${otherToken}` } })).statusCode).toBe(404);
  });
});

describe('integrations', () => {
  it('rewrites share links to direct downloads', () => {
    expect(directDownloadUrl('https://drive.google.com/file/d/AbC_123/view?usp=sharing').toString()).toBe('https://drive.google.com/uc?export=download&id=AbC_123');
    expect(directDownloadUrl('https://docs.google.com/document/d/XyZ/edit').toString()).toBe('https://docs.google.com/document/d/XyZ/export?format=docx');
    expect(directDownloadUrl('https://www.dropbox.com/s/abc/file.pdf?dl=0').searchParams.get('dl')).toBe('1');
  });

  it('refuses to import from internal or non-https addresses', async () => {
    const { c } = await registerSender(app);
    const env = await c.json('POST', '/envelopes', { json: { title: 'Import' } });
    for (const url of ['http://example.com/a.pdf', 'https://127.0.0.1/a.pdf', 'https://localhost:4000/health', 'https://169.254.169.254/latest/meta-data']) {
      const res = await c.call('POST', `/envelopes/${env.id}/documents/import`, { json: { url } });
      expect(res.statusCode, url).toBe(400);
    }
  });

  it('supports REST-hook subscriptions for Zapier and Make', async () => {
    const { c } = await registerSender(app);
    const hook = await c.json('POST', '/hooks', { json: { target_url: 'https://hooks.zapier.test/abc', event: 'envelope.completed' } });
    expect((await c.json('GET', '/webhooks')).endpoints[0]).toMatchObject({ url: 'https://hooks.zapier.test/abc', events: ['envelope.completed'] });
    expect((await c.json('GET', '/hooks/sample/envelope.completed'))[0].data.title).toBeTruthy();
    expect((await c.call('DELETE', `/hooks/${hook.id}`)).statusCode).toBe(204);
  });
});
