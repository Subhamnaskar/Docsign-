import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { prisma } from '../src/db.js';
import { client, getApp, makePdf, multipart, registerSender, uid } from './helpers.js';

let app: FastifyInstance;
let owner: Awaited<ReturnType<typeof registerSender>>;
beforeAll(async () => {
  app = await getApp();
  owner = await registerSender(app);
  config.platformAdmins.push(owner.email);
});
// Plan settings are shared by every test file: put Enterprise back
afterAll(async () => {
  await owner.c.call('DELETE', '/admin/plans/enterprise');
});

const orgOf = async (c: ReturnType<typeof client>) => (await c.json('GET', '/auth/me')).organization.id as string;

/** A ready-to-send draft with one signer and a signature field. */
async function draft(c: ReturnType<typeof client>) {
  let env = await c.json('POST', '/envelopes', { json: { title: 'Limit check' } });
  const { payload, headers } = multipart('p.pdf', await makePdf('Limit check'));
  const doc = await c.json('POST', `/envelopes/${env.id}/documents`, { payload, headers });
  env = await c.json('PUT', `/envelopes/${env.id}/recipients`, { json: [{ name: 'Signer', email: `s-${uid()}@example.test` }] });
  await c.json('PUT', `/envelopes/${env.id}/fields`, {
    json: [{ documentId: doc.id, recipientId: env.recipients[0].id, type: 'SIGNATURE', page: 0, x: 0.1, y: 0.1, width: 0.3, height: 0.06 }],
  });
  return env.id as string;
}

describe('plan settings', () => {
  it('edits a plan everywhere at once and resets it to the default', async () => {
    const before = await owner.c.json('GET', '/admin/plans');
    const ent = before.plans.find((p: { id: string }) => p.id === 'enterprise');
    expect(ent).toMatchObject({ name: 'Enterprise', customized: false, price: null });
    expect(before.features.map((f: { id: string }) => f.id)).toEqual(['api', 'bulkSend', 'sso']);

    await owner.c.json('PUT', '/admin/plans/enterprise', { json: { name: 'Enterprise Plus', price: null, envelopesPerSeat: 500, maxSeats: 250, features: ['api', 'sso'] } });
    const pub = await app.inject({ method: 'GET', url: '/api/v1/billing/plans' });
    expect(pub.json().plans.find((p: { id: string }) => p.id === 'enterprise')).toMatchObject({ name: 'Enterprise Plus', envelopesPerSeat: 500, maxSeats: 250 });

    // An organisation on the plan gets the new limits and features
    const customer = await registerSender(app);
    const orgId = await orgOf(customer.c);
    await owner.c.json('POST', `/admin/orgs/${orgId}/plan`, { json: { plan: 'enterprise', seats: 4 } });
    const detail = await owner.c.json('GET', `/admin/orgs/${orgId}`);
    expect(detail.usage.envelopeLimit).toBe(2000);
    expect(detail.features).toEqual(['api', 'sso']);
    expect((await customer.c.json('GET', '/auth/me')).billing.planName).toBe('Enterprise Plus');
    expect((await customer.c.call('POST', '/templates/none/bulk-send', { json: {} })).json().error?.code).toBe('plan_feature');

    const after = await owner.c.json('GET', '/admin/plans');
    expect(after.plans.find((p: { id: string }) => p.id === 'enterprise')).toMatchObject({ customized: true, updatedBy: owner.email, organizations: expect.any(Number) });

    await owner.c.json('DELETE', '/admin/plans/enterprise');
    const reset = (await app.inject({ method: 'GET', url: '/api/v1/billing/plans' })).json();
    expect(reset.plans.find((p: { id: string }) => p.id === 'enterprise')).toMatchObject({ name: 'Enterprise', envelopesPerSeat: null });
  });

  it('validates plan terms', async () => {
    const bad = (id: string, json: unknown) => owner.c.call('PUT', `/admin/plans/${id}`, { json }).then((r) => r.statusCode);
    expect(await bad('trial', { name: 'Trial', price: { INR: 100, USD: 1 }, envelopesPerSeat: 10, maxSeats: 3, features: [], trialDays: 7 })).toBe(400);
    expect(await bad('starter', { name: 'Starter', price: { INR: 100, USD: 1 }, envelopesPerSeat: 10, maxSeats: 3, features: [], trialDays: 7 })).toBe(400);
    expect(await bad('starter', { name: '', price: null, envelopesPerSeat: 0, maxSeats: null, features: ['teleport'] })).toBe(400);
    expect(await bad('platinum', { name: 'X', price: null, envelopesPerSeat: null, maxSeats: null, features: [] })).toBe(404);
  });

  it('gives one customer custom limits and features', async () => {
    const customer = await registerSender(app);
    const orgId = await orgOf(customer.c);

    await owner.c.json('PUT', `/admin/orgs/${orgId}/limits`, { json: { envelopeLimit: 1, seatLimit: 12, features: ['sso'], note: 'Pilot: 12 users, 1 agreement' } });
    const detail = await owner.c.json('GET', `/admin/orgs/${orgId}`);
    expect(detail.usage).toMatchObject({ envelopeLimit: 1, seatLimit: 12 });
    expect(detail.customLimits).toMatchObject({ note: 'Pilot: 12 users, 1 agreement' });
    expect((await customer.c.json('GET', '/billing')).usage).toMatchObject({ envelopeLimit: 1, seatLimit: 12 });

    // The custom allowance is enforced
    await customer.c.json('POST', `/envelopes/${await draft(customer.c)}/send`);
    const second = await customer.c.call('POST', `/envelopes/${await draft(customer.c)}/send`);
    expect(second.statusCode).toBe(402);
    expect(second.json().error.code).toBe('plan_limit');

    // null = unlimited; clearing everything goes back to the plan
    await owner.c.json('PUT', `/admin/orgs/${orgId}/limits`, { json: { envelopeLimit: null } });
    expect((await owner.c.json('GET', `/admin/orgs/${orgId}`)).usage.envelopeLimit).toBeNull();
    await owner.c.json('PUT', `/admin/orgs/${orgId}/limits`, { json: {} });
    const cleared = await owner.c.json('GET', `/admin/orgs/${orgId}`);
    expect(cleared.customLimits).toBeNull();
    expect(cleared.usage.envelopeLimit).toBe(25);
    const types = (await prisma.activityLog.findMany({ where: { orgId, type: { startsWith: 'platform.limits' } }, orderBy: { createdAt: 'asc' } })).map((a) => a.type);
    expect(types).toEqual(['platform.limits_changed', 'platform.limits_changed', 'platform.limits_cleared']);
  });
});
