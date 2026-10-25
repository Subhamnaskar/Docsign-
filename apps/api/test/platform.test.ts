import type { FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { prisma } from '../src/db.js';
import { client, getApp, registerSender, uid } from './helpers.js';

let app: FastifyInstance;
/** A signed-in NuronixAI staff member (listed in PLATFORM_ADMINS, email confirmed). Shared: sign-ups are rate limited. */
let admin: Awaited<ReturnType<typeof registerSender>>;
beforeAll(async () => {
  app = await getApp();
  admin = await registerSender(app);
  config.platformAdmins.push(admin.email);
});

describe('platform console', () => {
  it('is invisible to customers, unverified staff and API keys', async () => {
    const { c } = await registerSender(app);
    expect((await c.json('GET', '/auth/me')).user.platformAdmin).toBe(false);
    expect((await c.call('GET', '/admin/overview')).statusCode).toBe(404);

    // Listed, but email not confirmed yet
    const u = client(app);
    const email = `staff-${uid()}@nuronixai.test`;
    config.platformAdmins.push(email);
    await u.json('POST', '/auth/register', {
      json: {
        name: 'New Staff',
        email,
        password: 'correct-horse-battery',
        organizationName: 'NuronixAI',
      },
    });
    expect((await u.call('GET', '/admin/overview')).statusCode).toBe(404);

    // An API key of a staff member's organisation acts as its owner, but never opens the console
    const { key } = await admin.c.json('POST', '/api-keys', {
      json: { name: 'Ops' },
    });
    const viaKey = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/overview',
      headers: { authorization: `Bearer ${key}` },
    });
    expect(viaKey.statusCode).toBe(404);
  });

  it('counts sign-ups, sign-ins, active users and plans', async () => {
    expect((await admin.c.json('GET', '/auth/me')).user.platformAdmin).toBe(true);

    const customer = await registerSender(app, 'IN');
    // A fresh sign-in on another device
    const other = client(app);
    await other.json('POST', '/auth/login', {
      json: { email: customer.email, password: 'correct-horse-battery' },
    });

    const o = await admin.c.json('GET', '/admin/overview?days=7');
    expect(o.totals.organizations).toBeGreaterThanOrEqual(2);
    expect(o.signups.today).toBeGreaterThanOrEqual(2);
    expect(o.logins.today).toBeGreaterThanOrEqual(1);
    expect(o.activeUsers.day).toBeGreaterThanOrEqual(2);
    expect(o.plans.find((p: { plan: string }) => p.plan === 'trial').status.TRIALING).toBeGreaterThanOrEqual(2);
    expect(o.series.signups).toHaveLength(7);
    expect(o.series.logins.at(-1).value).toBeGreaterThanOrEqual(1);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: customer.email },
    });
    expect(user.lastLoginAt).toBeInstanceOf(Date);
    const methods = await prisma.loginEvent.findMany({
      where: { userId: user.id, success: true },
      select: { method: true },
    });
    expect(methods.map((m) => m.method).sort()).toEqual(['password', 'register']);
  });

  it('logs failed sign-ins with the reason', async () => {
    const customer = await registerSender(app);
    const attacker = client(app);
    expect(
      (
        await attacker.call('POST', '/auth/login', {
          json: { email: customer.email, password: 'wrong-password-123' },
        })
      ).statusCode,
    ).toBe(401);
    const ghost = `nobody-${uid()}@acme.test`;
    await attacker.call('POST', '/auth/login', {
      json: { email: ghost, password: 'whatever-123456' },
    });

    const failed = await admin.c.json('GET', `/admin/logins?result=failed&q=${encodeURIComponent(customer.email)}`);
    expect(failed.events[0]).toMatchObject({
      email: customer.email,
      success: false,
      reason: 'bad_password',
      method: 'password',
    });
    const unknown = await admin.c.json('GET', `/admin/logins?result=failed&q=${encodeURIComponent(ghost)}`);
    expect(unknown.events[0]).toMatchObject({
      reason: 'unknown_user',
      organization: null,
    });
    const all = await admin.c.json('GET', '/admin/logins');
    expect(all.summary.failuresByReason.map((r: { reason: string }) => r.reason)).toEqual(expect.arrayContaining(['bad_password', 'unknown_user']));
    expect(all.summary.byMethod.length).toBeGreaterThan(0);
  });

  it('lists customers, shows one in detail and exports CSV', async () => {
    const customer = await registerSender(app, 'IN');
    const orgId = (await customer.c.json('GET', '/auth/me')).organization.id;

    const list = await admin.c.json('GET', `/admin/orgs?q=${encodeURIComponent(customer.email)}`);
    expect(list.total).toBe(1);
    expect(list.organizations[0]).toMatchObject({
      id: orgId,
      plan: 'trial',
      state: 'trialing',
      users: 1,
      owner: { email: customer.email },
    });
    expect(list.organizations[0].lastLoginAt).toBeTruthy();

    const filtered = await admin.c.json('GET', '/admin/orgs?plan=enterprise&status=ACTIVE');
    expect(filtered.organizations.every((o: { plan: string }) => o.plan === 'enterprise')).toBe(true);

    const detail = await admin.c.json('GET', `/admin/orgs/${orgId}`);
    expect(detail.users[0]).toMatchObject({
      email: customer.email,
      role: 'OWNER',
      emailVerified: true,
      activeSessions: 1,
    });
    expect(detail.usage).toMatchObject({
      envelopes: 0,
      envelopeLimit: 25,
      seats: 1,
    });
    expect(detail.logins.length).toBeGreaterThan(0);

    const csv = await admin.c.call('GET', `/admin/orgs.csv?q=${encodeURIComponent(customer.email)}`);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.body).toContain(customer.email);
    expect((await admin.c.call('GET', '/admin/orgs/nope')).statusCode).toBe(404);
  });

  it('extends trials and changes plans, recorded in the customer activity log', async () => {
    const customer = await registerSender(app);
    const orgId = (await customer.c.json('GET', '/auth/me')).organization.id;
    const before = (await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).trialEndsAt;

    const { trialEndsAt } = await admin.c.json('POST', `/admin/orgs/${orgId}/extend-trial`, { json: { days: 10 } });
    expect(new Date(trialEndsAt).getTime() - before.getTime()).toBeGreaterThan(9.9 * 24 * 3600 * 1000);

    await admin.c.json('POST', `/admin/orgs/${orgId}/plan`, {
      json: { plan: 'enterprise', seats: 40, months: 12 },
    });
    const me = await customer.c.json('GET', '/auth/me');
    expect(me.billing).toMatchObject({ plan: 'enterprise', state: 'active' });
    expect(
      (
        await admin.c.call('POST', `/admin/orgs/${orgId}/extend-trial`, {
          json: { days: 5 },
        })
      ).statusCode,
    ).toBe(400);

    const actions = await prisma.activityLog.findMany({
      where: { orgId, type: { startsWith: 'platform.' } },
      orderBy: { createdAt: 'asc' },
    });
    expect(actions.map((a) => a.type)).toEqual(['platform.trial_extended', 'platform.plan_changed']);
    expect(actions[1].data).toMatchObject({
      plan: 'enterprise',
      seats: 40,
      via: 'platform console',
    });

    // Paying self-serve customers count towards MRR
    const paying = await registerSender(app, 'IN');
    const payingId = (await paying.c.json('GET', '/auth/me')).organization.id;
    await prisma.organization.update({
      where: { id: payingId },
      data: {
        plan: 'business',
        seats: 3,
        billingStatus: 'ACTIVE',
        billingCurrency: 'INR',
        billingInterval: 'month',
      },
    });
    const row = (await admin.c.json('GET', `/admin/orgs?q=${encodeURIComponent(paying.email)}`)).organizations[0];
    expect(row.mrr).toEqual({ currency: 'INR', amount: 3 * 1_299_00 });
    const o = await admin.c.json('GET', '/admin/overview');
    expect(o.mrr.INR).toBeGreaterThanOrEqual(3 * 1_299_00);
    expect(o.arr.INR).toBe(o.mrr.INR * 12);
  });
});
