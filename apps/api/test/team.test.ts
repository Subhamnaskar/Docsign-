import type { FastifyInstance } from 'fastify';
import { unzipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { client, getApp, lastMail, makePdf, multipart, registerSender, signaturePng, uid, waitFor } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await getApp();
});

type C = ReturnType<typeof client>;

async function invite(owner: C, role: 'ADMIN' | 'MEMBER') {
  const email = `${role.toLowerCase()}-${uid()}@acme.test`;
  await owner.json('POST', '/team/invitations', { json: { email, role } });
  const token = lastMail(email, /Join/).text.match(/\/invite\/([\w-]+)/)![1];
  const c = client(app);
  expect((await c.json('GET', `/invitations/${token}`)).email).toBe(email);
  await c.json('POST', `/invitations/${token}/accept`, { json: { name: `${role} user`, password: 'correct-horse-battery' } });
  const me = await c.json('GET', '/auth/me');
  return { c, email, id: me.user.id as string };
}

async function sentEnvelope(c: C, signerEmail: string) {
  let env = await c.json('POST', '/envelopes', { json: { title: `Doc ${uid()}` } });
  const { payload, headers } = multipart('a.pdf', await makePdf());
  const doc = await c.json('POST', `/envelopes/${env.id}/documents`, { payload, headers });
  env = await c.json('PUT', `/envelopes/${env.id}/recipients`, { json: [{ name: 'Signer', email: signerEmail }] });
  await c.json('PUT', `/envelopes/${env.id}/fields`, {
    json: [{ documentId: doc.id, recipientId: env.recipients[0].id, type: 'SIGNATURE', page: 0, x: 0.1, y: 0.1, width: 0.3, height: 0.06 }],
  });
  return c.json('POST', `/envelopes/${env.id}/send`);
}

describe('teams', () => {
  it('invites people, scopes what members see, and restricts admin areas', async () => {
    const { c: owner } = await registerSender(app);
    const admin = await invite(owner, 'ADMIN');
    const member = await invite(owner, 'MEMBER');

    const team = await owner.json('GET', '/team');
    expect(team.users).toHaveLength(3);

    const ownersEnvelope = await owner.json('POST', '/envelopes', { json: { title: 'Owner only' } });
    const membersEnvelope = await member.c.json('POST', '/envelopes', { json: { title: 'Member draft' } });

    // Members see only their own agreements; admins see all
    expect((await member.c.call('GET', `/envelopes/${ownersEnvelope.id}`)).statusCode).toBe(404);
    expect((await member.c.json('GET', '/envelopes')).data.map((e: { id: string }) => e.id)).toEqual([membersEnvelope.id]);
    expect((await admin.c.json('GET', '/envelopes')).data).toHaveLength(2);

    // Members can't manage keys, webhooks, team or settings
    expect((await member.c.call('POST', '/api-keys', { json: { name: 'x' } })).statusCode).toBe(403);
    expect((await member.c.call('POST', '/team/invitations', { json: { email: 'z@z.test' } })).statusCode).toBe(403);
    expect((await member.c.call('PATCH', '/organization', { json: { name: 'Hacked' } })).statusCode).toBe(403);

    // Admins can't promote to admin/owner or touch other admins
    expect((await admin.c.call('PATCH', `/team/users/${member.id}`, { json: { role: 'ADMIN' } })).statusCode).toBe(403);

    // Deactivation signs the member out immediately
    await owner.json('PATCH', `/team/users/${member.id}`, { json: { active: false } });
    expect((await member.c.call('GET', '/envelopes')).statusCode).toBe(401);

    const activity = await owner.json('GET', '/activity');
    expect(activity.map((a: { type: string }) => a.type)).toEqual(expect.arrayContaining(['user.invited', 'user.joined', 'user.updated']));
  });

  it('keeps at least one owner', async () => {
    const { c: owner } = await registerSender(app);
    const me = await owner.json('GET', '/auth/me');
    expect((await owner.call('PATCH', `/team/users/${me.user.id}`, { json: { role: 'MEMBER' } })).statusCode).toBe(400);
  });
});

describe('branding', () => {
  it('uploads a logo, serves it publicly and puts it in signer emails', async () => {
    const { c } = await registerSender(app);
    await c.json('PATCH', '/organization', { json: { brandColor: '#0f766e' } });
    const png = Buffer.from(signaturePng().split(',')[1], 'base64');
    const { payload, headers } = multipart('logo.png', png, 'image/png');
    const branding = await c.json('POST', '/organization/logo', { payload, headers });
    expect(branding.logoUrl).toMatch(/\/branding\/.+\/logo\?v=/);

    const path = new URL(branding.logoUrl).pathname + new URL(branding.logoUrl).search;
    const logo = await app.inject({ method: 'GET', url: path });
    expect(logo.statusCode).toBe(200);
    expect(logo.headers['content-type']).toBe('image/png');

    const signer = `brand-${uid()}@example.test`;
    await sentEnvelope(c, signer);
    const mail = lastMail(signer, /Please sign/);
    expect(mail.html).toContain(branding.logoUrl);
    expect(mail.html).toContain('#0f766e');
  });
});

describe('editing after sending', () => {
  it('corrects a wrong email, invalidating the old link', async () => {
    const { c } = await registerSender(app);
    const wrong = `wrong-${uid()}@example.test`;
    const right = `right-${uid()}@example.test`;
    const env = await sentEnvelope(c, wrong);
    const oldLink = lastMail(wrong, /./).text.match(/\/sign\/([\w.-]+)/)![1];

    await c.json('POST', `/envelopes/${env.id}/recipients/${env.recipients[0].id}/correct`, { json: { email: right } });
    expect((await client(app).call('GET', `/signing/${oldLink}`)).statusCode).toBe(404);
    const newLink = lastMail(right, /Please sign/).text.match(/\/sign\/([\w.-]+)/)![1];
    expect((await client(app).call('GET', `/signing/${newLink}`)).statusCode).toBe(200);
    const audit = await c.json('GET', `/envelopes/${env.id}/audit`);
    expect(audit.events.some((e: { type: string }) => e.type === 'recipient.corrected')).toBe(true);
  });

  it('lets a signer reassign to a colleague', async () => {
    const { c, email: senderEmail } = await registerSender(app);
    const first = `first-${uid()}@example.test`;
    const colleague = `colleague-${uid()}@example.test`;
    const env = await sentEnvelope(c, first);
    const link = lastMail(first, /./).text.match(/\/sign\/([\w.-]+)/)![1];
    const s = client(app);
    await s.json('POST', `/signing/${link}/otp/send`);
    await s.json('POST', `/signing/${link}/otp/verify`, { json: { code: lastMail(first, /\d{6}/).subject.match(/\d{6}/)![0] } });
    await s.json('POST', `/signing/${link}/reassign`, { json: { name: 'Colleague', email: colleague, reason: 'She owns this contract' } });

    expect((await client(app).call('GET', `/signing/${link}`)).statusCode).toBe(404);
    expect(lastMail(colleague, /Please sign/)).toBeTruthy();
    expect(lastMail(senderEmail, /Reassigned/).text).toContain('She owns this contract');
    const updated = await c.json('GET', `/envelopes/${env.id}`);
    expect(updated.recipients[0].email).toBe(colleague);
  });
});

describe('folders, bulk download and export', () => {
  it('files agreements, zips completed ones and exports CSV', async () => {
    const { c } = await registerSender(app);
    const folder = await c.json('POST', '/folders', { json: { name: 'HR' } });
    const signer = `zip-${uid()}@example.test`;
    const env = await sentEnvelope(c, signer);
    await c.json('PATCH', `/envelopes/${env.id}/folder`, { json: { folderId: folder.id } });
    expect((await c.json('GET', `/envelopes?folderId=${folder.id}`)).data).toHaveLength(1);
    expect((await c.json('GET', '/envelopes?folderId=none')).data).toHaveLength(0);

    // Sign it so there is something to download
    const link = lastMail(signer, /./).text.match(/\/sign\/([\w.-]+)/)![1];
    const s = client(app);
    await s.json('POST', `/signing/${link}/otp/send`);
    await s.json('POST', `/signing/${link}/otp/verify`, { json: { code: lastMail(signer, /\d{6}/).subject.match(/\d{6}/)![0] } });
    const session = await s.json('GET', `/signing/${link}`);
    await s.json('POST', `/signing/${link}/complete`, { json: { consent: true, values: { [session.fields[0].id]: signaturePng() } } });
    await waitFor(() => c.json('GET', `/envelopes/${env.id}`), (e) => e.status === 'COMPLETED');

    const zip = await c.call('POST', '/envelopes/download', { json: { ids: [env.id] } });
    expect(zip.headers['content-type']).toBe('application/zip');
    const files = Object.keys(unzipSync(new Uint8Array(zip.rawPayload)));
    expect(files.some((f) => f.endsWith('(signed).pdf'))).toBe(true);
    expect(files.some((f) => f.endsWith('Certificate of Completion.pdf'))).toBe(true);

    const csv = (await c.call('GET', '/envelopes/export.csv')).body;
    expect(csv).toContain('Envelope ID,Title,Status');
    expect(csv).toContain(env.id);
    expect(csv).toContain('COMPLETED');
  });
});
