import type Anthropic from '@anthropic-ai/sdk';
import type { FastifyInstance } from 'fastify';
import PizZip from 'pizzip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setAiClientForTests } from '../src/ai/claude.js';
import { sendRenewalReminders } from '../src/contracts/routes.js';
import { client, getApp, lastMail, makePdf, multipart, outbox, registerSender, signaturePng, uid, waitFor } from './helpers.js';

let app: FastifyInstance;
const aiAnswers: unknown[] = [];
beforeAll(async () => {
  app = await getApp();
  setAiClientForTests({ beta: { messages: { parse: async () => aiAnswers.shift() } } } as unknown as Anthropic);
});
afterAll(() => setAiClientForTests(null));

type Client = ReturnType<typeof client>;
const DAY = 86_400_000;

/** A minimal .docx whose body is the given paragraphs. */
function docx(paragraphs: string[]): Buffer {
  const zip = new PizZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join('');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return zip.generate({ type: 'nodebuffer' });
}

/** Draft with one signer and a signature field; returns ids. */
async function draft(c: Client, title = 'Agreement', email = `s-${uid()}@example.test`) {
  let env = await c.json('POST', '/envelopes', { json: { title } });
  const { payload, headers } = multipart('a.pdf', await makePdf(title));
  const doc = await c.json('POST', `/envelopes/${env.id}/documents`, { payload, headers });
  env = await c.json('PUT', `/envelopes/${env.id}/recipients`, { json: [{ name: 'Priya Shah', email }] });
  await c.json('PUT', `/envelopes/${env.id}/fields`, {
    json: [{ documentId: doc.id, recipientId: env.recipients[0].id, type: 'SIGNATURE', page: 0, x: 0.1, y: 0.1, width: 0.3, height: 0.06 }],
  });
  return { id: env.id as string, docId: doc.id as string, email };
}

async function signerSession(email: string) {
  const link = lastMail(email, /Please sign|Updated/).text.match(/\/sign\/([\w.-]+)/)![1];
  const s = client(app);
  await s.json('POST', `/signing/${link}/otp/send`);
  await s.json('POST', `/signing/${link}/otp/verify`, { json: { code: lastMail(email, /\d{6}/).subject.match(/\d{6}/)![0] } });
  return { s, link };
}

describe('document generation from Word templates', () => {
  it('finds placeholders, fills them and adds the PDF to a new agreement', async () => {
    const { c } = await registerSender(app, 'IN');
    const bad = multipart('bad.docx', docx(['Dear {{Client name']));
    expect((await c.call('POST', '/doc-templates', bad)).statusCode).toBe(400);

    const up = multipart('Service agreement.docx', docx(['Agreement with {{Client name}}', 'Fee: {{Fee}} per month', 'Signed in {{City}}']));
    const tpl = await c.json('POST', '/doc-templates', up);
    expect(tpl).toMatchObject({ name: 'Service agreement', variables: ['Client name', 'Fee', 'City'] });
    expect((await c.json('GET', '/doc-templates')).map((t: { id: string }) => t.id)).toContain(tpl.id);

    const out = await c.json('POST', `/doc-templates/${tpl.id}/generate`, { json: { title: 'Acme services', data: { 'Client name': 'Acme Pvt Ltd', Fee: '₹50,000' } } });
    const env = await c.json('GET', `/envelopes/${out.envelopeId}`);
    expect(env).toMatchObject({ title: 'Acme services', status: 'DRAFT' });
    expect(env.documents[0]).toMatchObject({ name: 'Service agreement.pdf', pageCount: 1 });
    const audit = await c.json('GET', `/envelopes/${out.envelopeId}/audit`);
    expect(audit.events.find((e: { type: string }) => e.type === 'document.added').data.generatedFrom.templateId).toBe(tpl.id);
  });
});

describe('contract repository', () => {
  it('stores key terms, searches, extracts with AI and reminds before the notice deadline', async () => {
    const { c, email: senderEmail } = await registerSender(app);
    const { id, email } = await draft(c, 'Office lease');
    await c.json('POST', `/envelopes/${id}/send`);
    const { s, link } = await signerSession(email);
    const session = await s.json('GET', `/signing/${link}`);
    await s.json('POST', `/signing/${link}/complete`, { json: { consent: true, values: { [session.fields[0].id]: signaturePng() } } });
    await waitFor(() => c.json('GET', `/envelopes/${id}`), (e) => e.status === 'COMPLETED');

    // AI fills the terms; a later manual edit wins over a second extraction
    await c.json('PATCH', '/organization', { json: { aiEnabled: true } });
    aiAnswers.push({
      stop_reason: 'end_turn',
      parsed_output: { counterparty: 'Priya Shah', value: 1200000, currency: 'INR', effectiveDate: '2026-01-01', expiryDate: null, renewalDate: null, noticeDays: 30, autoRenews: true, tags: ['lease', 'office'] },
    });
    const extracted = await c.json('POST', `/envelopes/${id}/contract/extract`);
    expect(extracted).toMatchObject({ counterparty: 'Priya Shah', value: 120_000_000, currency: 'INR', noticeDays: 30, autoRenews: true, tags: ['lease', 'office'], source: 'ai' });

    const renewal = new Date(Date.now() + 20 * DAY);
    const meta = await c.json('PUT', `/envelopes/${id}/contract`, { json: { renewalDate: renewal.toISOString(), noticeDays: 10, tags: ['lease', 'bengaluru'] } });
    expect(meta).toMatchObject({ source: 'manual', counterparty: 'Priya Shah', tags: ['lease', 'bengaluru'] });

    expect((await c.json('GET', '/repository?expiring=30')).map((e: { id: string }) => e.id)).toContain(id);
    expect((await c.json('GET', '/repository?expiring=7')).map((e: { id: string }) => e.id)).not.toContain(id);
    expect((await c.json('GET', '/repository?tag=bengaluru')).map((e: { id: string }) => e.id)).toEqual([id]);
    expect((await c.json('GET', '/repository?search=priya')).map((e: { id: string }) => e.id)).toContain(id);
    expect((await c.json('GET', '/repository/tags'))[0]).toEqual({ tag: 'lease', count: 1 });

    // Notice deadline is 10 days away, inside the 14-day reminder window
    const before = outbox().length;
    expect(await sendRenewalReminders()).toBeGreaterThanOrEqual(1);
    const mail = lastMail(senderEmail, /Renewal reminder: Office lease/);
    expect(mail.text).toContain('notice must be given by');
    await sendRenewalReminders();
    expect(outbox().filter((m) => m.subject === 'Renewal reminder: Office lease').length).toBe(1);
    expect(outbox().length).toBeGreaterThan(before);
  });
});

describe('negotiation', () => {
  it('lets signers comment, the sender reply and upload a revised version until someone signs', async () => {
    const { c, email: senderEmail } = await registerSender(app);
    const { id, docId, email } = await draft(c, 'Supply agreement');
    await c.json('POST', `/envelopes/${id}/send`);
    const { s, link } = await signerSession(email);

    const comment = await s.json('POST', `/signing/${link}/comments`, { json: { body: 'Clause 4: please change payment terms to 45 days.', documentId: docId, page: 0, x: 0.3, y: 0.4 } });
    expect(lastMail(senderEmail, /New comment on Supply agreement/).text).toContain('45 days');
    await c.json('POST', `/envelopes/${id}/comments`, { json: { body: 'Agreed, revised version coming.', parentId: comment.id } });
    expect(lastMail(email, /Reply on Supply agreement/)).toBeTruthy();
    await c.json('PATCH', `/envelopes/${id}/comments/${comment.id}`, { json: { resolved: true } });
    const thread = await s.json('GET', `/signing/${link}/comments`);
    expect(thread).toHaveLength(2);
    expect(thread[0]).toMatchObject({ resolved: true, authorKind: 'recipient', page: 0 });

    const revised = multipart('supply-v2.pdf', await makePdf('Supply agreement v2'));
    const rev = await c.json('POST', `/envelopes/${id}/documents/${docId}/revise`, revised);
    expect(rev).toMatchObject({ version: 2, notified: 1 });
    expect(lastMail(email, /Updated: Supply agreement/)).toBeTruthy();
    const versions = await c.json('GET', `/envelopes/${id}/documents/${docId}/versions`);
    expect(versions.map((v: { version: number; current: boolean }) => [v.version, v.current])).toEqual([[1, false], [2, true]]);
    expect((await c.call('GET', `/envelopes/${id}/documents/${docId}/versions/1/file`)).headers['content-type']).toBe('application/pdf');

    const session = await s.json('GET', `/signing/${link}`);
    await s.json('POST', `/signing/${link}/complete`, { json: { consent: true, values: { [session.fields[0].id]: signaturePng() } } });
    expect((await c.call('POST', `/envelopes/${id}/documents/${docId}/revise`, multipart('v3.pdf', await makePdf('v3')))).statusCode).toBe(409);
    expect((await s.call('POST', `/signing/${link}/comments`, { json: { body: 'late' } })).statusCode).toBe(409);
    const audit = await c.json('GET', `/envelopes/${id}/audit`);
    expect(audit.events.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(['comment.added', 'document.revised']));
  });
});

describe('internal approval before sending', () => {
  it('holds members’ agreements until an admin approves, and re-asks after a rejection', async () => {
    const { c: owner, email: ownerEmail } = await registerSender(app);
    await owner.json('PATCH', '/organization', { json: { approvalPolicy: 'members' } });
    const memberEmail = `member-${uid()}@acme.test`;
    await owner.json('POST', '/team/invitations', { json: { email: memberEmail } });
    const invite = lastMail(memberEmail, /Join/).text.match(/\/invite\/([\w-]+)/)![1];
    const m = client(app);
    await m.json('POST', `/invitations/${invite}/accept`, { json: { name: 'Mo Member', password: 'correct-horse-battery' } });

    const { id, email } = await draft(m, 'Vendor NDA');
    const held = await m.json('POST', `/envelopes/${id}/send`);
    expect(held).toMatchObject({ status: 'DRAFT', approval: { status: 'PENDING' } });
    expect(lastMail(ownerEmail, /Approval needed: Vendor NDA/)).toBeTruthy();
    expect(outbox().some((x) => x.to === email)).toBe(false);
    expect((await m.call('POST', `/envelopes/${id}/approval`, { json: { decision: 'approve' } })).statusCode).toBe(403);
    expect((await owner.json('GET', '/envelopes?approval=pending')).data.map((e: { id: string }) => e.id)).toContain(id);

    const rejected = await owner.json('POST', `/envelopes/${id}/approval`, { json: { decision: 'reject', note: 'Use the 2026 NDA wording' } });
    expect(rejected.approval).toMatchObject({ status: 'REJECTED', note: 'Use the 2026 NDA wording' });
    expect(lastMail(memberEmail, /Changes requested: Vendor NDA/).text).toContain('2026 NDA wording');

    expect((await m.json('POST', `/envelopes/${id}/send`)).approval.status).toBe('PENDING');
    const sent = await owner.json('POST', `/envelopes/${id}/approval`, { json: { decision: 'approve' } });
    expect(sent.status).toBe('SENT');
    expect(lastMail(email, /Please sign/)).toBeTruthy();
    const audit = await owner.json('GET', `/envelopes/${id}/audit`);
    expect(audit.events.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(['envelope.approval_requested', 'envelope.approval_rejected', 'envelope.approved', 'envelope.sent']));
    const sentEvent = audit.events.find((e: { type: string }) => e.type === 'envelope.sent');
    expect(sentEvent.actor.name).toBe('Mo Member');

    // Owners are approvers, so their own agreements go straight out
    const own = await draft(owner, 'Owner deal');
    expect((await owner.json('POST', `/envelopes/${own.id}/send`)).status).toBe('SENT');
  });
});
