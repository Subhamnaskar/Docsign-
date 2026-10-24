import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { client, getApp, outbox, uid } from './helpers.js';

describe('website leads', () => {
  it('stores a demo request and notifies sales', async () => {
    const app = await getApp();
    const company = `Bank ${uid()}`;
    const res = await client(app).json('POST', '/leads', {
      json: { name: 'Riya', email: 'riya@bank.test', company, interest: 'demo', country: 'India', message: 'Loan agreements' },
    });
    expect(res.ok).toBe(true);
    expect(await prisma.lead.count({ where: { company } })).toBe(1);
    expect(outbox().some((m) => m.subject === `Website lead: ${company}`)).toBe(true);
  });

  it('silently drops honeypot submissions and validates input', async () => {
    const app = await getApp();
    const company = `Bot ${uid()}`;
    const c = client(app);
    await c.json('POST', '/leads', { json: { name: 'x', email: 'x@y.test', company, interest: 'demo', website: 'http://spam' } });
    expect(await prisma.lead.count({ where: { company } })).toBe(0);
    const bad = await c.call('POST', '/leads', { json: { name: 'x', email: 'nope', company: 'c', interest: 'demo' } });
    expect(bad.statusCode).toBe(400);
  });
});
