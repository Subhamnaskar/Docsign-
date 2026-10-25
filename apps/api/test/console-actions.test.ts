import type { FastifyInstance, FastifyRequest } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { prisma } from '../src/db.js';
import { ATTACK_THRESHOLD, recordLogin } from '../src/lib/logins.js';
import { client, getApp, lastMail, outbox, registerSender, uid } from './helpers.js';

let app: FastifyInstance;
/** Console owner (in PLATFORM_ADMINS). Shared: sign-ups are rate limited. */
let owner: Awaited<ReturnType<typeof registerSender>>;
beforeAll(async () => {
  app = await getApp();
  owner = await registerSender(app);
  config.platformAdmins.push(owner.email);
});

const PASSWORD = 'correct-horse-battery';
const orgOf = async (c: ReturnType<typeof client>) => (await c.json('GET', '/auth/me')).organization.id as string;
const userOf = (email: string) => prisma.user.findUniqueOrThrow({ where: { email } });
const actionsOf = async (orgId: string) => (await prisma.activityLog.findMany({ where: { orgId, type: { startsWith: 'platform.' } }, orderBy: { createdAt: 'asc' } })).map((a) => a.type);

/** Buys a plan through the sandbox checkout. */
async function subscribe(c: ReturnType<typeof client>, plan: string, seats: number) {
  const { url } = await c.json('POST', '/billing/checkout', { json: { plan, seats, interval: 'month' } });
  const id = new URL(url).pathname.split('/').pop()!;
  const paid = await app.inject({ method: 'POST', url: `/api/v1/dev/billing/${id}`, payload: 'outcome=pay', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  expect(paid.statusCode).toBe(303);
}

describe('console: users', () => {
  it('signs users out, sends resets, deactivates and reactivates', async () => {
    const customer = await registerSender(app);
    const orgId = await orgOf(customer.c);
    const user = await userOf(customer.email);

    expect((await owner.c.json('POST', `/admin/users/${user.id}/sign-out`)).sessions).toBe(1);
    expect((await customer.c.call('GET', '/auth/me')).statusCode).toBe(401);

    await owner.c.json('POST', `/admin/users/${user.id}/password-reset`);
    expect(lastMail(customer.email, /Reset your password/).text).toMatch(/reset-password\//);

    await owner.c.json('POST', `/admin/users/${user.id}/deactivate`);
    const blocked = await client(app).call('POST', '/auth/login', { json: { email: customer.email, password: PASSWORD } });
    expect(blocked.statusCode).toBe(401);
    expect((await owner.c.call('POST', `/admin/users/${user.id}/password-reset`)).statusCode).toBe(400);

    await owner.c.json('POST', `/admin/users/${user.id}/reactivate`);
    await client(app).json('POST', '/auth/login', { json: { email: customer.email, password: PASSWORD } });

    const me = await userOf(owner.email);
    expect((await owner.c.call('POST', `/admin/users/${me.id}/deactivate`)).statusCode).toBe(400);
    expect(await actionsOf(orgId)).toEqual(['platform.user_signed_out', 'platform.password_reset_sent', 'platform.user_deactivated', 'platform.user_reactivated']);
  });
});

describe('console: suspension', () => {
  it('locks an organisation out of sign-in and the API until reactivated', async () => {
    const customer = await registerSender(app);
    const orgId = await orgOf(customer.c);
    const { key } = await customer.c.json('POST', '/api-keys', { json: { name: 'Integration' } });

    expect((await owner.c.call('POST', `/admin/orgs/${orgId}/suspend`, { json: { reason: 'x' } })).statusCode).toBe(400);
    await owner.c.json('POST', `/admin/orgs/${orgId}/suspend`, { json: { reason: 'Phishing reports' } });
    expect(lastMail(customer.email, /suspended/).text).toContain('Phishing reports');

    expect((await customer.c.call('GET', '/auth/me')).statusCode).toBe(401);
    const login = await client(app).call('POST', '/auth/login', { json: { email: customer.email, password: PASSWORD } });
    expect(login.statusCode).toBe(403);
    expect(login.json().error.code).toBe('org_suspended');
    const viaKey = await app.inject({ method: 'GET', url: '/api/v1/envelopes', headers: { authorization: `Bearer ${key}` } });
    expect(viaKey.statusCode).toBe(403);
    expect(await prisma.loginEvent.findFirst({ where: { email: customer.email, reason: 'suspended' } })).toBeTruthy();

    const list = await owner.c.json('GET', `/admin/orgs?q=${encodeURIComponent(customer.email)}`);
    expect(list.organizations[0].suspended).toBe(true);

    await owner.c.json('POST', `/admin/orgs/${orgId}/reactivate`);
    await client(app).json('POST', '/auth/login', { json: { email: customer.email, password: PASSWORD } });
    expect((await owner.c.call('POST', `/admin/orgs/${await orgOf(owner.c)}/suspend`, { json: { reason: 'Testing myself' } })).statusCode).toBe(400);
    expect(await actionsOf(orgId)).toEqual(['platform.org_suspended', 'platform.org_reactivated']);
  });
});

describe('console: billing', () => {
  it('refunds through the provider, issues credits and cancels, with alerts', async () => {
    const customer = await registerSender(app, 'IN');
    const orgId = await orgOf(customer.c);
    await subscribe(customer.c, 'starter', 2);
    expect(outbox().some((m) => m.to === owner.email && m.subject.startsWith('[Console] New paying customer'))).toBe(true);

    const detail = await owner.c.json('GET', `/admin/orgs/${orgId}`);
    const invoice = detail.invoices[0];
    expect(invoice.total).toBe(Math.round(2 * 499_00 * 1.18));
    expect(detail.liveSubscription).toBe(true);

    const refund = await owner.c.json('POST', `/admin/orgs/${orgId}/refund`, { json: { invoiceId: invoice.id, amount: 500_00, reason: 'Charged for an unused seat' } });
    expect(refund).toMatchObject({ viaProvider: true, creditNote: expect.stringMatching(/^CN-\d{4}-\d{6}$/) });
    expect(refund.providerRef).toMatch(/^sbx_refund_/);
    const tooMuch = await owner.c.call('POST', `/admin/orgs/${orgId}/refund`, { json: { invoiceId: invoice.id, amount: invoice.total, reason: 'Everything again' } });
    expect(tooMuch.statusCode).toBe(400);
    expect(lastMail(customer.email, /Refund issued/).text).toContain(refund.creditNote);

    await owner.c.json('POST', `/admin/orgs/${orgId}/credit`, { json: { amount: 200_00, reason: 'Sorry for the outage' } });
    const billing = await customer.c.json('GET', '/billing');
    expect(billing.creditNotes.map((n: { kind: string }) => n.kind)).toEqual(['credit', 'refund']);
    expect(billing.creditNotes[1]).toMatchObject({ amount: 500_00, currency: 'INR', invoice: invoice.number });
    expect((await owner.c.json('GET', `/admin/orgs/${orgId}`)).invoices[0].refunded).toBe(500_00);

    // The customer's own cancellation alerts the console team
    await customer.c.json('POST', '/billing/cancel');
    expect(outbox().some((m) => m.to === owner.email && m.subject.startsWith('[Console] Cancellation'))).toBe(true);
    await owner.c.json('POST', `/admin/orgs/${orgId}/cancel`, { json: { when: 'now', reason: 'Customer asked to stop today' } });
    expect((await customer.c.json('GET', '/auth/me')).billing.state).toBe('canceled');
    expect((await owner.c.call('POST', `/admin/orgs/${orgId}/cancel`, { json: { when: 'now', reason: 'Twice' } })).statusCode).toBe(400);
    expect(await actionsOf(orgId)).toEqual(['platform.refund_issued', 'platform.credit_issued', 'platform.subscription_canceled']);
  });
});

describe('console: support sessions', () => {
  it('needs the customer’s permission, is read-only and returns staff to the console', async () => {
    const customer = await registerSender(app);
    const orgId = await orgOf(customer.c);
    const staff = client(app);
    await staff.json('POST', '/auth/login', { json: { email: owner.email, password: PASSWORD } });

    expect((await staff.call('POST', `/admin/orgs/${orgId}/support-session`, { json: {} })).statusCode).toBe(403);
    const { until } = await customer.c.json('POST', '/organization/support-access', { json: { hours: 24 } });
    expect(new Date(until).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    expect((await owner.c.json('GET', `/admin/orgs/${orgId}`)).supportAccessUntil).toBeTruthy();

    const started = await staff.json('POST', `/admin/orgs/${orgId}/support-session`, { json: {} });
    expect(started).toMatchObject({ viewingAs: customer.email, redirect: '/dashboard' });
    expect(lastMail(customer.email, /NuronixAI support opened your account/).text).toContain(owner.email);

    const me = await staff.json('GET', '/auth/me');
    expect(me.organization.id).toBe(orgId);
    expect(me.support).toMatchObject({ by: owner.email });
    expect(me.user.platformAdmin).toBe(false);
    expect((await staff.call('GET', '/envelopes')).statusCode).toBe(200);
    const write = await staff.call('POST', '/envelopes', { json: { title: 'Should not exist' } });
    expect(write.statusCode).toBe(403);
    expect(write.json().error.code).toBe('support_read_only');
    expect((await staff.call('GET', '/admin/overview')).statusCode).toBe(404);
    // Support visits don't count as the customer being active or signing in
    expect((await prisma.loginEvent.count({ where: { userId: (await userOf(customer.email)).id } }))).toBe(1);

    const ended = await staff.json('POST', '/auth/support/end');
    expect(ended.redirect).toBe(`/admin/orgs/${orgId}`);
    const back = await staff.json('GET', '/auth/me');
    expect(back.user.email).toBe(owner.email);
    expect(back.user.platformAdmin).toBe(true);
    expect(back.support).toBeNull();

    // Withdrawing access ends an open support session
    await staff.json('POST', `/admin/orgs/${orgId}/support-session`, { json: {} });
    const access = await customer.c.json('GET', '/organization/support-access');
    expect(access.sessions[0]).toMatchObject({ by: owner.email, viewingAs: customer.email });
    await customer.c.json('DELETE', '/organization/support-access');
    expect((await staff.call('GET', '/auth/me')).statusCode).toBe(401);
    expect(await actionsOf(orgId)).toEqual(['platform.support_session_started', 'platform.support_session_ended', 'platform.support_session_started']);
  });
});

describe('console: team and alerts', () => {
  it('lets owners add viewers and admins; viewers only look', async () => {
    const colleague = await registerSender(app);
    const customerOrg = await orgOf(owner.c);
    expect((await colleague.c.call('GET', '/admin/overview')).statusCode).toBe(404);

    await owner.c.json('POST', '/admin/team', { json: { email: colleague.email, role: 'viewer' } });
    expect((await colleague.c.call('GET', '/admin/overview')).statusCode).toBe(200);
    expect((await colleague.c.json('GET', '/admin/me')).role).toBe('viewer');
    expect((await colleague.c.call('POST', `/admin/orgs/${customerOrg}/extend-trial`, { json: { days: 3 } })).statusCode).toBe(403);
    expect((await colleague.c.call('POST', '/admin/team', { json: { email: `x-${uid()}@acme.test`, role: 'admin' } })).statusCode).toBe(403);
    expect((await colleague.c.call('PATCH', `/admin/team/${encodeURIComponent(colleague.email)}`, { json: { role: 'admin' } })).statusCode).toBe(403);
    await colleague.c.json('PATCH', `/admin/team/${encodeURIComponent(colleague.email)}`, { json: { alerts: false } });

    await owner.c.json('PATCH', `/admin/team/${encodeURIComponent(colleague.email)}`, { json: { role: 'admin' } });
    await colleague.c.json('POST', `/admin/orgs/${customerOrg}/extend-trial`, { json: { days: 1 } });
    const team = await owner.c.json('GET', '/admin/team');
    expect(team.members.find((m: { email: string }) => m.email === owner.email)).toMatchObject({ role: 'owner' });
    expect(team.members.find((m: { email: string }) => m.email === colleague.email)).toMatchObject({ role: 'admin', alerts: false, account: { emailVerified: true } });

    await owner.c.json('DELETE', `/admin/team/${encodeURIComponent(colleague.email)}`);
    expect((await colleague.c.call('GET', '/admin/overview')).statusCode).toBe(404);
  });

  it('alerts the team once when failed sign-ins pile up', async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 20}`;
    const req = { ip, headers: {}, log: { error() {} } } as unknown as FastifyRequest;
    for (let i = 0; i < ATTACK_THRESHOLD + 2; i++) await recordLogin(req, { email: `victim-${uid()}@acme.test`, method: 'password', success: false, reason: 'unknown_user' });
    const alerts = outbox().filter((m) => m.to === owner.email && m.subject === `[Console] ${ATTACK_THRESHOLD} failed sign-ins from ${ip}`);
    expect(alerts).toHaveLength(1);
  });
});
