import type { FastifyInstance } from 'fastify';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/db.js';
import { runPendingWorkflows } from '../src/workflows/engine.js';
import { client, getApp, lastMail, makePdf, multipart, outbox, registerSender, signaturePng, uid, waitFor } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await getApp();
});
afterEach(() => vi.restoreAllMocks());

type Client = ReturnType<typeof client>;

/** A draft with one signer and a signature field. */
async function draft(c: Client, title: string, signer = { name: 'Meera Iyer', email: `meera-${uid()}@example.test` }) {
  let env = await c.json('POST', '/envelopes', { json: { title, documentType: 'nda' } });
  const { payload, headers } = multipart('c.pdf', await makePdf(title));
  const doc = await c.json('POST', `/envelopes/${env.id}/documents`, { payload, headers });
  env = await c.json('PUT', `/envelopes/${env.id}/recipients`, { json: [signer] });
  await c.json('PUT', `/envelopes/${env.id}/fields`, { json: [{ documentId: doc.id, recipientId: env.recipients[0].id, type: 'SIGNATURE', page: 0, x: 0.1, y: 0.1, width: 0.3, height: 0.06 }] });
  return { id: env.id as string, signer };
}

async function signerSession(email: string) {
  const link = lastMail(email, /Please sign/).text.match(/\/sign\/([\w.-]+)/)![1];
  const s = client(app);
  await s.json('POST', `/signing/${link}/otp/send`);
  await s.json('POST', `/signing/${link}/otp/verify`, { json: { code: lastMail(email, /\d{6}/).subject.match(/\d{6}/)![0] } });
  return { s, link };
}

async function sign(c: Client, id: string, email: string) {
  const { s, link } = await signerSession(email);
  const session = await s.json('GET', `/signing/${link}`);
  await s.json('POST', `/signing/${link}/complete`, { json: { consent: true, values: { [session.fields[0].id]: signaturePng() } } });
  await waitFor(() => c.json('GET', `/envelopes/${id}`), (e) => e.status === 'COMPLETED');
}

/** Runs the worker step until this workflow's queue is empty. */
async function drain(workflowId: string) {
  for (let i = 0; i < 10; i++) {
    await runPendingWorkflows(50);
    if (!(await prisma.workflowRun.count({ where: { workflowId, status: 'PENDING' } }))) return;
  }
}

describe('contacts', () => {
  it('fills the address book from sent agreements and supports search, edits and CSV', async () => {
    const { c } = await registerSender(app);
    const { id, signer } = await draft(c, 'Supply agreement');
    await c.json('POST', `/envelopes/${id}/send`);

    const list = await c.json('GET', '/contacts');
    expect(list.contacts[0]).toMatchObject({ name: 'Meera Iyer', email: signer.email, source: 'auto', agreements: 1 });
    const suggest = await c.json('GET', '/contacts/suggest?q=meer');
    expect(suggest.contacts.map((x: { email: string }) => x.email)).toContain(signer.email);

    const contact = list.contacts[0];
    await c.json('PATCH', `/contacts/${contact.id}`, { json: { company: 'Kaveri Textiles', tags: ['supplier'] } });
    const detail = await c.json('GET', `/contacts/${contact.id}`);
    expect(detail).toMatchObject({ company: 'Kaveri Textiles', tags: ['supplier'] });
    expect(detail.agreements[0]).toMatchObject({ id, title: 'Supply agreement', status: 'SENT' });

    const added = await c.json('POST', '/contacts', { json: { name: 'Ravi Kumar', email: 'Ravi@Example.test', phone: '+91 98765 43210' } });
    expect(added.email).toBe('ravi@example.test');
    expect((await c.call('POST', '/contacts', { json: { name: 'Again', email: 'ravi@example.test' } })).statusCode).toBe(409);

    const imported = await c.json('POST', '/contacts/import', {
      json: { csv: 'Name,Email,Company,Tags\n"Iyer, Meera",' + signer.email + ',Kaveri,supplier;vip\nAsha,asha@example.test,Acme,\nBroken,not-an-email,,' },
    });
    expect(imported).toMatchObject({ created: 1, updated: 1 });
    expect(imported.problems).toHaveLength(1);
    expect((await c.json('GET', '/contacts?tag=vip')).contacts.map((x: { name: string }) => x.name)).toEqual(['Iyer, Meera']);

    const csv = await c.call('GET', '/contacts.csv');
    expect(csv.body).toContain('ravi@example.test');
    await c.json('DELETE', `/contacts/${added.id}`);
    expect((await c.json('GET', '/contacts?q=ravi')).total).toBe(0);
  });
});

describe('in review', () => {
  it('flags agreements with open signer comments', async () => {
    const { c } = await registerSender(app);
    const { id, signer } = await draft(c, 'Lease');
    await c.json('POST', `/envelopes/${id}/send`);
    const row = async () => (await c.json('GET', '/envelopes')).data.find((e: { id: string }) => e.id === id);
    expect((await row()).inReview).toBe(false);
    const { s, link } = await signerSession(signer.email);
    await s.json('POST', `/signing/${link}/comments`, { json: { body: 'Please change clause 4.' } });
    expect((await row()).inReview).toBe(true);
    const home = await c.json('GET', '/home');
    expect(home.attention.inReview.map((e: { id: string }) => e.id)).toContain(id);
  });
});

describe('workflows', () => {
  it('emails, tags and files completed agreements that match, and logs each run', async () => {
    const { c } = await registerSender(app);
    const folder = await c.json('POST', '/folders', { json: { name: 'Signed NDAs' } });
    const options = await c.json('GET', '/workflows/options');
    expect(options.triggers.map((t: { id: string }) => t.id)).toContain('envelope.completed');
    expect(options.folders.map((f: { id: string }) => f.id)).toContain(folder.id);

    const w = await c.json('POST', '/workflows', {
      json: {
        name: 'File signed NDAs',
        trigger: 'envelope.completed',
        conditions: [{ field: 'title', op: 'contains', value: 'nda' }],
        actions: [
          { type: 'email_copy', to: ['legal@acme.test'] },
          { type: 'add_tag', tag: 'nda' },
          { type: 'move_to_folder', folderId: folder.id },
        ],
      },
    });

    const nda = await draft(c, 'Mutual NDA with Globex');
    const other = await draft(c, 'Supply agreement');
    for (const a of [nda, other]) {
      await c.json('POST', `/envelopes/${a.id}/send`);
      await sign(c, a.id, a.signer.email);
    }
    await drain(w.id);

    const detail = await c.json('GET', `/workflows/${w.id}`);
    expect(detail.runs).toHaveLength(1);
    expect(detail.runs[0]).toMatchObject({ status: 'SUCCEEDED', envelope: { id: nda.id } });
    expect(detail.runs[0].results.map((r: { ok: boolean }) => r.ok)).toEqual([true, true, true]);
    expect(detail.runCount).toBe(1);

    const mail = outbox().filter((m) => m.to === 'legal@acme.test').pop()!;
    expect(mail.attachments?.map((a) => a.filename)).toEqual(['c (signed).pdf', 'Certificate of Completion.pdf']);
    const env = await prisma.envelope.findUniqueOrThrow({ where: { id: nda.id }, include: { contract: true } });
    expect(env.folderId).toBe(folder.id);
    expect(env.contract?.tags).toEqual(['nda']);
  });

  it('sends the next agreement from a template without looping', async () => {
    const { c } = await registerSender(app);
    const base = await draft(c, 'Master services agreement');
    const tpl = await c.json('POST', `/envelopes/${base.id}/save-as-template`, { json: { name: 'MSA' } });
    const w = await c.json('POST', '/workflows', {
      json: { name: 'NDA then MSA', trigger: 'envelope.completed', conditions: [{ field: 'title', op: 'contains', value: 'NDA' }], actions: [{ type: 'send_template', templateId: tpl.id, title: 'MSA for you' }] },
    });
    // A second workflow on every send must not fire for the agreement the first one starts
    const onSend = await c.json('POST', '/workflows', { json: { name: 'Ping on send', trigger: 'envelope.sent', actions: [{ type: 'add_tag', tag: 'sent' }] } });

    const nda = await draft(c, 'NDA');
    await c.json('POST', `/envelopes/${nda.id}/send`);
    await sign(c, nda.id, nda.signer.email);
    await drain(w.id);

    const started = await prisma.envelope.findFirstOrThrow({ where: { createdByWorkflowId: w.id }, include: { recipients: true } });
    expect(started).toMatchObject({ title: 'MSA for you', status: 'SENT', templateId: tpl.id });
    expect(started.recipients[0].email).toBe(nda.signer.email);
    expect(await prisma.workflowRun.count({ where: { workflowId: onSend.id, envelopeId: started.id } })).toBe(0);
    expect(await prisma.workflowRun.count({ where: { workflowId: onSend.id, envelopeId: nda.id } })).toBe(1);
  });

  it('posts to Slack, retries failures, can be tested and paused', async () => {
    const { c } = await registerSender(app);
    const w = await c.json('POST', '/workflows', {
      json: { name: 'Tell sales', trigger: 'envelope.sent', actions: [{ type: 'notify_chat', format: 'slack', url: 'https://hooks.slack.com/services/T0/B0/xyz' }] },
    });
    expect((await c.call('POST', '/workflows', { json: { name: 'Bad', trigger: 'envelope.sent', actions: [] } })).statusCode).toBe(400);
    expect((await c.call('POST', '/workflows', { json: { name: 'Bad', trigger: 'nope', actions: [{ type: 'add_tag', tag: 'x' }] } })).statusCode).toBe(400);
    expect((await c.call('POST', '/workflows', { json: { name: 'Bad', trigger: 'envelope.sent', actions: [{ type: 'move_to_folder', folderId: 'not-mine' }] } })).statusCode).toBe(400);

    const posts: string[] = [];
    let fail = true;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).startsWith('https://hooks.slack.com/')) {
        posts.push(String(init?.body));
        return new Response(fail ? 'down' : 'ok', { status: fail ? 500 : 200 });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const a = await draft(c, 'Order form');
    await c.json('POST', `/envelopes/${a.id}/send`);
    await runPendingWorkflows(50);
    let run = await prisma.workflowRun.findFirstOrThrow({ where: { workflowId: w.id } });
    expect(run).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(run.error).toMatch(/500/);

    fail = false;
    await prisma.workflowRun.update({ where: { id: run.id }, data: { nextAttemptAt: new Date() } });
    await runPendingWorkflows(50);
    run = await prisma.workflowRun.findFirstOrThrow({ where: { id: run.id } });
    expect(run.status).toBe('SUCCEEDED');
    expect(posts.at(-1)).toContain('Order form');

    const { runId } = await c.json('POST', `/workflows/${w.id}/test`, { json: { envelopeId: a.id } });
    await drain(w.id);
    expect((await prisma.workflowRun.findUniqueOrThrow({ where: { id: runId } })).status).toBe('SUCCEEDED');

    await c.json('PATCH', `/workflows/${w.id}`, { json: { enabled: false } });
    const b = await draft(c, 'Second order');
    await c.json('POST', `/envelopes/${b.id}/send`);
    expect(await prisma.workflowRun.count({ where: { workflowId: w.id, envelopeId: b.id } })).toBe(0);

    const list = await c.json('GET', '/workflows');
    expect(list.workflows[0]).toMatchObject({ name: 'Tell sales', enabled: false, runCount: 2 });
    await c.json('DELETE', `/workflows/${w.id}`);
    expect((await c.call('GET', `/workflows/${w.id}`)).statusCode).toBe(404);
  });
});

describe('home', () => {
  it('summarises what needs attention', async () => {
    const { c, email } = await registerSender(app);
    await draft(c, 'Draft one');
    const mine = await draft(c, 'Sign this yourself', { name: 'Me', email });
    await c.json('POST', `/envelopes/${mine.id}/send`);
    const home = await c.json('GET', '/home');
    expect(home.name).toBe('Sam Sender');
    expect(home.counts).toMatchObject({ drafts: 1, awaitingOthers: 1, toSign: 1 });
    expect(home.attention.toSign[0]).toMatchObject({ id: mine.id });
    expect(home.activity[0]).toMatchObject({ type: 'envelope.sent', envelope: { id: mine.id } });
  });
});
