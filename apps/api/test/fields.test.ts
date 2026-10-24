import type { FastifyInstance } from 'fastify';
import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { evaluateFormula, formulaRefs } from '../src/lib/formula.js';
import { client, getApp, lastMail, makePdf, multipart, registerSender, signaturePng, uid, waitFor } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await getApp();
});

describe('formula evaluator', () => {
  const vals: Record<string, number> = { Qty: 3, Price: 12.5, Tax: 0.18 };
  const look = (l: string) => vals[l] ?? null;
  it.each([
    ['{Qty} * {Price}', 37.5],
    ['{Qty} * {Price} * (1 + {Tax})', 44.25],
    ['-{Qty} + 10 / 4', -0.5],
    ['0.1 + 0.2', 0.3],
  ])('%s = %s', (f, expected) => expect(evaluateFormula(f, look)).toBe(expected));

  it('returns null when an input is missing', () => expect(evaluateFormula('{Qty} * {Missing}', look)).toBeNull());
  it('lists references', () => expect(formulaRefs('{A} + {B}*2')).toEqual(['A', 'B']));
  it.each(['{A} +', 'process.exit()', '{A} {B}', '(1 + 2'])('rejects %s', (f) => expect(() => formulaRefs(f)).toThrow());
});

/** Opens a signing link and verifies with the emailed code. */
async function openAs(email: string) {
  // The invitation goes out just after the recipient's status changes
  const invite = await waitFor(async () => { try { return lastMail(email, /Please sign|Firme/); } catch { return null; } }, (m) => m !== null);
  const link = invite!.text.match(/\/sign\/([\w.-]+)/)![1];
  const s = client(app);
  await s.json('POST', `/signing/${link}/otp/send`);
  await s.json('POST', `/signing/${link}/otp/verify`, { json: { code: lastMail(email, /\d{6}/).subject.match(/\d{6}/)![0] } });
  return { s, link, session: await s.json('GET', `/signing/${link}`) };
}

describe('advanced fields, approvers and attachments', () => {
  it('validates choices, computes formulas, honours conditions and embeds attachments', async () => {
    const { c } = await registerSender(app);
    const buyer = `buyer-${uid()}@example.test`;
    const approver = `approver-${uid()}@example.test`;
    let env = await c.json('POST', '/envelopes', { json: { title: 'Order form' } });
    const { payload, headers } = multipart('order.pdf', await makePdf('Order'));
    const doc = await c.json('POST', `/envelopes/${env.id}/documents`, { payload, headers });
    env = await c.json('PUT', `/envelopes/${env.id}/recipients`, {
      json: [
        { name: 'Buyer', email: buyer, role: 'SIGNER', routingOrder: 1 },
        { name: 'Finance', email: approver, role: 'APPROVER', routingOrder: 2 },
      ],
    });
    const b = env.recipients.find((r: { role: string }) => r.role === 'SIGNER').id;
    const box = (y: number) => ({ documentId: doc.id, recipientId: b, page: 0, x: 0.1, y, width: 0.3, height: 0.04 });

    // Bad formula reference is rejected at save time
    const bad = await c.call('PUT', `/envelopes/${env.id}/fields`, { json: [{ ...box(0.1), type: 'FORMULA', label: 'Total', formula: '{Nope} * 2' }] });
    expect(bad.statusCode).toBe(400);

    env = await c.json('PUT', `/envelopes/${env.id}/fields`, {
      json: [
        { ...box(0.05), type: 'SIGNATURE' },
        { ...box(0.12), type: 'DROPDOWN', label: 'Plan', options: ['Basic', 'Pro'] },
        { ...box(0.19), type: 'NUMBER', label: 'Qty' },
        { ...box(0.26), type: 'NUMBER', label: 'Price' },
        { ...box(0.33), type: 'FORMULA', label: 'Total', formula: '{Qty} * {Price}' },
        { ...box(0.4), type: 'CHECKBOX', label: 'Has guarantor', required: false },
        { ...box(0.47), type: 'TEXT', label: 'Guarantor name', condition: { fieldLabel: 'Has guarantor', equals: 'true' } },
        { ...box(0.54), type: 'RADIO', label: 'Delivery', options: ['Pickup', 'Courier'] },
        { ...box(0.61), type: 'ATTACHMENT', label: 'Purchase order' },
      ],
    });
    await c.json('POST', `/envelopes/${env.id}/send`);

    const { s, link, session } = await openAs(buyer);
    const f = (label: string) => session.fields.find((x: { label: string | null }) => x.label === label).id;
    const sig = session.fields.find((x: { type: string }) => x.type === 'SIGNATURE').id;

    // Attachment upload
    const up = multipart('po.pdf', await makePdf('PO 123'));
    const att = await s.json('POST', `/signing/${link}/attachments/${f('Purchase order')}`, { payload: up.payload, headers: up.headers });
    const notPdf = multipart('evil.exe', Buffer.from('MZ not allowed'));
    expect((await s.call('POST', `/signing/${link}/attachments/${f('Purchase order')}`, { payload: notPdf.payload, headers: notPdf.headers })).statusCode).toBe(400);

    const base = { [sig]: signaturePng(), [f('Plan')]: 'Pro', [f('Qty')]: '3', [f('Price')]: '12.5', [f('Delivery')]: 'Courier', [f('Purchase order')]: att.id, [f('Total')]: '999999' };
    // Option not in the list
    expect((await s.call('POST', `/signing/${link}/complete`, { json: { consent: true, values: { ...base, [f('Plan')]: 'Enterprise' } } })).statusCode).toBe(400);
    // Condition met → the conditional field becomes required
    expect((await s.call('POST', `/signing/${link}/complete`, { json: { consent: true, values: { ...base, [f('Has guarantor')]: 'true' } } })).statusCode).toBe(400);
    // Condition not met → field hidden, signing succeeds
    await s.json('POST', `/signing/${link}/complete`, { json: { consent: true, values: base } });

    // Routing to the next recipient happens just after the response
    await waitFor(
      () => c.json('GET', `/envelopes/${env.id}`),
      (e) => e.recipients.find((r: { role: string }) => r.role === 'APPROVER').status === 'SENT',
    );

    // Approver approves without fields
    const ap = await openAs(approver);
    expect(ap.session.fields).toHaveLength(0);
    expect(ap.session.recipient.role).toBe('APPROVER');
    await ap.s.json('POST', `/signing/${ap.link}/complete`, { json: { consent: true, values: {} } });

    const done = await waitFor(() => c.json('GET', `/envelopes/${env.id}`), (e) => e.status === 'COMPLETED');
    const audit = await c.json('GET', `/envelopes/${env.id}/audit`);
    expect(audit.events.some((e: { type: string }) => e.type === 'recipient.approved')).toBe(true);

    // Formula was computed server-side, not taken from the client
    const { prisma } = await import('../src/db.js');
    const total = await prisma.field.findFirst({ where: { envelopeId: env.id, label: 'Total' } });
    expect(total!.value).toBe('37.5');

    // The attachment is embedded in the sealed PDF
    const pdf = await c.call('GET', `/envelopes/${env.id}/documents/${done.documents[0].id}/file`);
    const loaded = await PDFDocument.load(pdf.rawPayload);
    expect(pdf.rawPayload.toString('latin1')).toContain('/EmbeddedFiles');
    expect(loaded.getPageCount()).toBe(1);
  });
});

describe('in-person signing', () => {
  it('lets the host start a verified session without emailing the signer', async () => {
    const { c } = await registerSender(app);
    const walkIn = `walkin-${uid()}@example.test`;
    let env = await c.json('POST', '/envelopes', { json: { title: 'Counter agreement' } });
    const { payload, headers } = multipart('a.pdf', await makePdf());
    const doc = await c.json('POST', `/envelopes/${env.id}/documents`, { payload, headers });
    env = await c.json('PUT', `/envelopes/${env.id}/recipients`, { json: [{ name: 'Walk-in', email: walkIn, inPerson: true }] });
    expect(env.recipients[0].inPerson).toBe(true);
    await c.json('PUT', `/envelopes/${env.id}/fields`, {
      json: [{ documentId: doc.id, recipientId: env.recipients[0].id, type: 'SIGNATURE', page: 0, x: 0.1, y: 0.1, width: 0.3, height: 0.06 }],
    });
    await c.json('POST', `/envelopes/${env.id}/send`);
    expect(() => lastMail(walkIn, /Please sign/)).toThrow();

    // Another user can't host
    const other = await registerSender(app);
    expect((await other.c.call('POST', `/envelopes/${env.id}/recipients/${env.recipients[0].id}/host-session`)).statusCode).toBe(404);

    const { signPath } = await c.json('POST', `/envelopes/${env.id}/recipients/${env.recipients[0].id}/host-session`);
    const token = signPath.split('/').pop();
    const session = await c.json('GET', `/signing/${token}`);
    expect(session.verified).toBe(true);
    await c.json('POST', `/signing/${token}/complete`, { json: { consent: true, values: { [session.fields[0].id]: signaturePng() } } });
    await waitFor(() => c.json('GET', `/envelopes/${env.id}`), (e) => e.status === 'COMPLETED');
    const audit = await c.json('GET', `/envelopes/${env.id}/audit`);
    const verified = audit.events.find((e: { type: string }) => e.type === 'recipient.verified');
    expect(verified.data.method).toBe('in_person');
  });
});

describe('self-serve signing links', () => {
  it('creates an envelope per visitor and enforces the use limit', async () => {
    const { c } = await registerSender(app);
    let env = await c.json('POST', '/envelopes', { json: { title: 'Volunteer waiver' } });
    const { payload, headers } = multipart('w.pdf', await makePdf('Waiver'));
    const doc = await c.json('POST', `/envelopes/${env.id}/documents`, { payload, headers });
    env = await c.json('PUT', `/envelopes/${env.id}/recipients`, { json: [{ name: 'Template', email: `t-${uid()}@example.test` }] });
    await c.json('PUT', `/envelopes/${env.id}/fields`, {
      json: [{ documentId: doc.id, recipientId: env.recipients[0].id, type: 'SIGNATURE', page: 0, x: 0.1, y: 0.1, width: 0.3, height: 0.06 }],
    });
    const tpl = await c.json('POST', `/envelopes/${env.id}/save-as-template`, { json: { name: 'Waiver' } });
    const form = await c.json('POST', '/forms', { json: { templateId: tpl.id, name: 'Waiver 2026', maxUses: 1 } });

    const visitor = client(app);
    const info = await visitor.json('GET', `/f/${form.slug}`);
    expect(info.title).toBe('Volunteer waiver');
    const email = `visitor-${uid()}@example.test`;
    const { signPath } = await visitor.json('POST', `/f/${form.slug}`, { json: { name: 'Vee', email } });
    expect(signPath).toMatch(/^\/sign\//);
    expect(lastMail(email, /\d{6}|Please sign/)).toBeTruthy();

    const second = await visitor.call('POST', `/f/${form.slug}`, { json: { name: 'Other', email: `o-${uid()}@example.test` } });
    expect(second.statusCode).toBe(409);
    const list = await c.json('GET', '/forms');
    expect(list[0].uses).toBe(1);
  });
});

describe('reports', () => {
  it('summarises volume, turnaround and the signer funnel', async () => {
    const { c } = await registerSender(app);
    const email = `rep-${uid()}@example.test`;
    let env = await c.json('POST', '/envelopes', { json: { title: 'Report me' } });
    const { payload, headers } = multipart('a.pdf', await makePdf());
    const doc = await c.json('POST', `/envelopes/${env.id}/documents`, { payload, headers });
    env = await c.json('PUT', `/envelopes/${env.id}/recipients`, { json: [{ name: 'R', email }] });
    await c.json('PUT', `/envelopes/${env.id}/fields`, {
      json: [{ documentId: doc.id, recipientId: env.recipients[0].id, type: 'SIGNATURE', page: 0, x: 0.1, y: 0.1, width: 0.3, height: 0.06 }],
    });
    await c.json('POST', `/envelopes/${env.id}/send`);
    const { s, link, session } = await openAs(email);
    await s.json('POST', `/signing/${link}/complete`, { json: { consent: true, values: { [session.fields[0].id]: signaturePng() } } });
    await waitFor(() => c.json('GET', `/envelopes/${env.id}`), (e) => e.status === 'COMPLETED');

    const r = await c.json('GET', '/reports?days=30');
    expect(r.totals).toMatchObject({ sent: 1, completed: 1, completionRate: 1, outstanding: 0 });
    expect(r.totals.medianHours).toBeGreaterThanOrEqual(0);
    expect(r.funnel).toEqual({ invited: 1, opened: 1, verified: 1, signed: 1 });
    expect(r.weekly.reduce((n: number, w: { sent: number }) => n + w.sent, 0)).toBe(1);
    expect(r.bySender[0]).toMatchObject({ sent: 1, completed: 1 });
  });
});
