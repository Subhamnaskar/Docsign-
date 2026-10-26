import type { FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { forgetOrgSettings, ipAllowed, mailIdentityFor } from '../src/governance/delivery.js';
import { purgeExpired } from '../src/governance/retention.js';
import { getObject } from '../src/lib/storage.js';
import { client, getApp, lastMail, makePdf, multipart, outbox, registerSender, signaturePng, uid, waitFor } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await getApp();
});

type Client = ReturnType<typeof client>;
const DAY = 86_400_000;
const orgOf = async (c: Client) => (await c.json('GET', '/auth/me')).organization.id as string;

async function draft(c: Client, title: string, extra: Record<string, unknown> = {}) {
  let env = await c.json('POST', '/envelopes', { json: { title, ...extra } });
  const { payload, headers } = multipart('g.pdf', await makePdf(title));
  const doc = await c.json('POST', `/envelopes/${env.id}/documents`, { payload, headers });
  const email = `s-${uid()}@example.test`;
  env = await c.json('PUT', `/envelopes/${env.id}/recipients`, { json: [{ name: 'Signer', email }] });
  await c.json('PUT', `/envelopes/${env.id}/fields`, {
    json: [{ documentId: doc.id, recipientId: env.recipients[0].id, type: 'SIGNATURE', page: 0, x: 0.1, y: 0.1, width: 0.3, height: 0.06 }],
  });
  return { id: env.id as string, email };
}

describe('IP allowlist', () => {
  it('matches CIDR ranges for IPv4 and IPv6', () => {
    expect(ipAllowed('10.1.2.3', ['10.0.0.0/8'])).toBe(true);
    expect(ipAllowed('::ffff:10.1.2.3', ['10.0.0.0/8'])).toBe(true);
    expect(ipAllowed('192.168.1.1', ['10.0.0.0/8'])).toBe(false);
    expect(ipAllowed('2001:db8::5', ['2001:db8::/32'])).toBe(true);
    expect(ipAllowed('anything', [])).toBe(true);
  });

  it('blocks the app and API from other addresses, and refuses a list that locks you out', async () => {
    const { c } = await registerSender(app);
    expect((await c.call('PUT', '/governance/ip-allowlist', { json: { cidrs: ['10.0.0.0/8'] } })).statusCode).toBe(400);
    expect((await c.call('PUT', '/governance/ip-allowlist', { json: { cidrs: ['not-an-ip'] } })).statusCode).toBe(400);
    await c.json('PUT', '/governance/ip-allowlist', { json: { cidrs: ['127.0.0.1/32'] } });
    expect((await c.call('GET', '/envelopes')).statusCode).toBe(200);
    const elsewhere = await c.call('GET', '/envelopes', { headers: { 'x-forwarded-for': '203.0.113.9' } });
    expect(elsewhere.statusCode).toBe(403);
    expect(elsewhere.json().error.code).toBe('ip_not_allowed');
    await c.json('PUT', '/governance/ip-allowlist', { json: { cidrs: [] } });
    expect((await c.call('GET', '/envelopes', { headers: { 'x-forwarded-for': '203.0.113.9' } })).statusCode).toBe(200);
  });
});

describe('retention and legal hold', () => {
  it('purges old unfinished agreements, keeps held ones and never deletes signed ones before the legal minimum', async () => {
    const { c } = await registerSender(app);
    const orgId = await orgOf(c);
    await c.json('PUT', '/governance/retention', { json: { retentionDays: 30, purgeIncompleteDays: 7 } });

    const old = await draft(c, 'Abandoned draft');
    const held = await draft(c, 'Disputed draft');
    await c.json('POST', `/envelopes/${held.id}/legal-hold`, { json: { reason: 'Litigation hold, case 42' } });
    expect((await c.json('GET', `/envelopes/${held.id}`)).legalHold.reason).toBe('Litigation hold, case 42');
    expect((await c.call('DELETE', `/envelopes/${held.id}`)).statusCode).toBe(409);
    const docKey = (await prisma.document.findFirstOrThrow({ where: { envelopeId: old.id } })).storageKey;
    await prisma.envelope.updateMany({ where: { id: { in: [old.id, held.id] } }, data: { updatedAt: new Date(Date.now() - 30 * DAY) } });

    // A signed agreement completed 40 days ago is still inside the US legal retention period
    const signed = await draft(c, 'Signed long ago');
    await c.json('POST', `/envelopes/${signed.id}/send`);
    const link = lastMail(signed.email, /Please sign/).text.match(/\/sign\/([\w.-]+)/)![1];
    const s = client(app);
    await s.json('POST', `/signing/${link}/otp/send`);
    await s.json('POST', `/signing/${link}/otp/verify`, { json: { code: lastMail(signed.email, /\d{6}/).subject.match(/\d{6}/)![0] } });
    const session = await s.json('GET', `/signing/${link}`);
    await s.json('POST', `/signing/${link}/complete`, { json: { consent: true, values: { [session.fields[0].id]: signaturePng() } } });
    await waitFor(() => c.json('GET', `/envelopes/${signed.id}`), (e) => e.status === 'COMPLETED');
    await prisma.envelope.update({ where: { id: signed.id }, data: { completedAt: new Date(Date.now() - 40 * DAY) } });
    expect((await c.call('DELETE', `/envelopes/${signed.id}/permanently`)).statusCode).toBe(409);

    await purgeExpired();
    expect(await prisma.envelope.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.envelope.findUnique({ where: { id: held.id } })).not.toBeNull();
    expect(await prisma.envelope.findUnique({ where: { id: signed.id } })).not.toBeNull();
    await expect(getObject(docKey)).rejects.toThrow();
    const log = await prisma.activityLog.findFirstOrThrow({ where: { orgId, type: 'envelope.purged' } });
    expect(log.data).toMatchObject({ envelopeId: old.id, title: 'Abandoned draft', reason: 'retention' });

    await c.json('DELETE', `/envelopes/${held.id}/legal-hold`);
    await prisma.envelope.update({ where: { id: held.id }, data: { updatedAt: new Date(Date.now() - 30 * DAY) } });
    await purgeExpired();
    expect(await prisma.envelope.findUnique({ where: { id: held.id } })).toBeNull();
  });
});

describe('exports', () => {
  it('exports an agreement audit trail, the activity log and audit events as JSON lines', async () => {
    const { c } = await registerSender(app);
    const { id } = await draft(c, 'Export me');
    await c.json('PUT', '/governance/retention', { json: { retentionDays: null, purgeIncompleteDays: null } });
    const auditCsv = await c.call('GET', `/envelopes/${id}/audit.csv`);
    expect(auditCsv.headers['content-type']).toContain('text/csv');
    expect(auditCsv.body.split('\n')[0]).toBe('seq,time,type,actor,ip,user_agent,data,hash,prev_hash');
    expect(auditCsv.body).toContain('envelope.created');
    expect((await c.call('GET', '/activity/export.csv')).body).toContain('governance.retention_updated');
    const lines = (await c.call('GET', `/audit/export?from=${new Date(Date.now() - DAY).toISOString()}`)).body.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.some((l: { envelopeId: string; type: string }) => l.envelopeId === id && l.type === 'document.added')).toBe(true);
  });
});

describe('departments', () => {
  it('lets department managers see their team’s agreements and scopes templates', async () => {
    const { c: owner } = await registerSender(app);
    const invite = async (name: string) => {
      const email = `${name.toLowerCase()}-${uid()}@acme.test`;
      await owner.json('POST', '/team/invitations', { json: { email } });
      const token = lastMail(email, /Join/).text.match(/\/invite\/([\w-]+)/)![1];
      const m = client(app);
      const user = await m.json('POST', `/invitations/${token}/accept`, { json: { name, password: 'correct-horse-battery' } });
      return { m, id: user.id as string };
    };
    const lead = await invite('Lead');
    const rep = await invite('Rep');
    const other = await invite('Other');
    const sales = await owner.json('POST', '/departments', { json: { name: 'Sales' } });
    await owner.json('PUT', `/departments/${sales.id}/members`, { json: [{ userId: lead.id, role: 'manager' }, { userId: rep.id }] });
    expect((await other.m.call('POST', '/envelopes', { json: { title: 'X', departmentId: sales.id } })).statusCode).toBe(403);

    const deal = await draft(rep.m, 'Sales deal', { departmentId: sales.id });
    expect((await lead.m.call('GET', `/envelopes/${deal.id}`)).statusCode).toBe(200);
    expect((await other.m.call('GET', `/envelopes/${deal.id}`)).statusCode).toBe(404);
    expect((await lead.m.json('GET', '/envelopes')).data.map((e: { id: string }) => e.id)).toContain(deal.id);
    expect((await rep.m.json('GET', '/departments')).map((d: { name: string }) => d.name)).toEqual(['Sales']);
    expect(await other.m.json('GET', '/departments')).toEqual([]);

    const tpl = await prisma.template.create({ data: { orgId: (await orgOf(owner)), createdById: rep.id, name: 'Sales only', title: 'Deal', jurisdiction: 'US', departmentId: sales.id } });
    expect((await rep.m.json('GET', '/templates')).map((t: { id: string }) => t.id)).toContain(tpl.id);
    expect((await other.m.json('GET', '/templates')).map((t: { id: string }) => t.id)).not.toContain(tpl.id);
  });
});

describe('sending from the organisation’s domain and custom signing domain', () => {
  it('signs mail with DKIM once the domain is verified and links to the verified signing domain', async () => {
    const { c } = await registerSender(app);
    const orgId = await orgOf(c);
    const signDomain = `sign-${uid().toLowerCase()}.acme.test`;
    expect((await mailIdentityFor(orgId)).from).toMatch(/^"Acme via Nuronix eSign" </);

    await c.json('PUT', '/governance/email', { json: { fromName: 'Acme Legal', replyTo: 'legal@acme.test', domain: 'acme.test' } });
    const gov = await c.json('GET', '/governance');
    expect(gov.email.dns[0].name).toMatch(/^docsign\d{6}\._domainkey\.acme\.test$/);
    expect(gov.email.dns[0].value).toMatch(/^v=DKIM1; k=rsa; p=MII/);
    expect((await c.call('POST', '/governance/email/verify')).statusCode).toBe(400);

    await c.json('PUT', '/governance/domain', { json: { domain: signDomain } });
    expect((await c.json('GET', '/governance')).customDomain.dns[0]).toMatchObject({ type: 'TXT', name: `_docsign-verify.${signDomain}` });
    expect((await c.call('POST', '/governance/domain/verify')).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `/api/v1/domains/check?domain=${signDomain}` })).statusCode).toBe(404);

    // As if the DNS records had been found
    await prisma.organization.update({ where: { id: orgId }, data: { emailDomainVerifiedAt: new Date(), customDomainVerifiedAt: new Date() } });
    forgetOrgSettings(orgId);
    const identity = await mailIdentityFor(orgId);
    expect(identity).toMatchObject({ from: '"Acme Legal" <no-reply@acme.test>', replyTo: 'legal@acme.test' });
    expect(identity.dkim).toMatchObject({ domainName: 'acme.test' });
    expect(identity.dkim!.privateKey).toContain('BEGIN PRIVATE KEY');
    expect((await app.inject({ method: 'GET', url: `/api/v1/domains/check?domain=${signDomain}` })).statusCode).toBe(200);

    const { id, email } = await draft(c, 'Branded');
    await c.json('POST', `/envelopes/${id}/send`);
    const invite = lastMail(email, /Please sign/);
    expect(invite.text).toContain(`https://${signDomain}/sign/`);
    expect(outbox().find((m) => m === invite)?.orgId).toBe(orgId);
  });

  it('validates customer-managed KMS keys', async () => {
    const { c } = await registerSender(app);
    expect((await c.call('PUT', '/governance/kms', { json: { storageKmsKeyId: 'my-key' } })).statusCode).toBe(400);
    const arn = 'arn:aws:kms:ap-south-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab';
    expect((await c.json('PUT', '/governance/kms', { json: { storageKmsKeyId: arn } })).storageKmsKeyId).toBe(arn);
    // Reset: the local object store has no KMS
    await c.json('PUT', '/governance/kms', { json: { storageKmsKeyId: null } });
  });
});
