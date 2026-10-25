import type { FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';
import { calculateDuty } from '../src/estamp/duty.js';
import { nameMatch } from '../src/kyc/names.js';
import { client, getApp, lastMail, makePdf, multipart, registerSender, signaturePng, uid, waitFor } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await getApp();
});

/** Follows an absolute redirect to our own API in-process. */
const follow = (location: string) => app.inject({ method: 'GET', url: new URL(location).pathname + new URL(location).search });
const form = (url: string, body: Record<string, string>) =>
  app.inject({ method: 'POST', url, payload: new URLSearchParams(body).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });

describe('name matching', () => {
  it('tolerates order, initials, titles and spelling variants', () => {
    expect(nameMatch('Kumar Ravi', 'Ravi Kumar')).toBe(100);
    expect(nameMatch('Shri Ravi Kumar', 'Ravi Kumar')).toBe(100);
    expect(nameMatch('R. Kumar', 'Ravi Kumar')).toBeGreaterThanOrEqual(70);
    expect(nameMatch('Mohammed Ali Khan', 'Mohammad Ali')).toBeGreaterThanOrEqual(70);
    expect(nameMatch('Suresh Patel', 'Ravi Kumar')).toBeLessThan(30);
  });
});

describe('stamp duty calculator', () => {
  it('applies fixed, leave-and-licence and annual-rent rules', () => {
    expect(calculateDuty({ state: 'MH', instrument: 'affidavit' })).toMatchObject({ duty: 500, indicative: true });
    // 0.25% of (11 × ₹20,000 + 10% a year interest on ₹1,00,000 for 11 months)
    expect(calculateDuty({ state: 'MH', instrument: 'rent', monthlyRent: 20_000, months: 11, deposit: 100_000 })?.duty).toBe(573);
    expect(calculateDuty({ state: 'DL', instrument: 'rent', monthlyRent: 20_000 })?.duty).toBe(4800);
    expect(calculateDuty({ state: 'MH', instrument: 'loan', amount: 5_000_000 })?.duty).toBe(5000);
    expect(calculateDuty({ state: 'ZZ', instrument: 'affidavit' })).toBeNull();
  });

  it('is available to senders over the API', async () => {
    const { c } = await registerSender(app, 'IN');
    expect((await c.json('GET', '/estamp/duty?state=MH&instrument=agreement')).duty).toBe(500);
    expect((await c.call('GET', '/estamp/duty?state=GJ&instrument=loan')).statusCode).toBe(400);
  });
});

describe('identity checks and eNACH at signing', () => {
  it('requires PAN, bank, DigiLocker and video checks and a registered mandate before signing', async () => {
    const { c } = await registerSender(app, 'IN');
    const email = `borrower-${uid()}@example.test`;
    let env = await c.json('POST', '/envelopes', { json: { title: 'Two-wheeler loan' } });
    const { payload, headers } = multipart('loan.pdf', await makePdf('Loan'));
    const doc = await c.json('POST', `/envelopes/${env.id}/documents`, { payload, headers });
    env = await c.json('PUT', `/envelopes/${env.id}/recipients`, {
      json: [{ name: 'Ravi Kumar', email, idChecks: ['PAN', 'BANK', 'DIGILOCKER', 'VIDEO'] }],
    });
    expect(env.recipients[0].idChecks).toEqual(['PAN', 'BANK', 'DIGILOCKER', 'VIDEO']);
    const r = env.recipients[0].id;
    const box = (y: number, extra: object) => ({ documentId: doc.id, recipientId: r, page: 0, x: 0.1, y, width: 0.4, height: 0.05, ...extra });
    expect((await c.call('PUT', `/envelopes/${env.id}/fields`, { json: [box(0.3, { type: 'MANDATE', label: 'EMI' })] })).statusCode).toBe(400);
    await c.json('PUT', `/envelopes/${env.id}/fields`, {
      json: [box(0.1, { type: 'SIGNATURE' }), box(0.3, { type: 'MANDATE', label: 'EMI mandate', amount: 450_000, config: { frequency: 'MONTHLY', months: 24 } })],
    });
    await c.json('POST', `/envelopes/${env.id}/send`);

    const link = lastMail(email, /Please sign/).text.match(/\/sign\/([\w.-]+)/)![1];
    const s = client(app);
    await s.json('POST', `/signing/${link}/otp/send`);
    await s.json('POST', `/signing/${link}/otp/verify`, { json: { code: lastMail(email, /\d{6}/).subject.match(/\d{6}/)![0] } });
    let session = await s.json('GET', `/signing/${link}`);
    expect(session.recipient.idChecks.map((x: { status: string }) => x.status)).toEqual(['NOT_STARTED', 'NOT_STARTED', 'NOT_STARTED', 'NOT_STARTED']);
    const sig = session.fields.find((f: { type: string }) => f.type === 'SIGNATURE');
    const mandate = session.fields.find((f: { type: string }) => f.type === 'MANDATE');
    expect(mandate.config).toEqual({ frequency: 'MONTHLY', months: 24 });
    const finish = () => s.call('POST', `/signing/${link}/complete`, { json: { consent: true, values: { [sig.id]: signaturePng() } } });
    const blocked = await finish();
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('kyc_required');

    // PAN: a different name fails, the right one passes
    const wrong = await s.json('POST', `/signing/${link}/kyc/pan`, { json: { pan: 'ABCPK1234F', name: 'Suresh Patel' } });
    expect(wrong).toMatchObject({ status: 'FAILED' });
    expect((await s.call('POST', `/signing/${link}/kyc/pan`, { json: { pan: 'BAD', name: 'Ravi Kumar' } })).statusCode).toBe(400);
    expect(await s.json('POST', `/signing/${link}/kyc/pan`, { json: { pan: 'abcpk1234f', name: 'Kumar Ravi' } })).toMatchObject({ status: 'PASSED', nameMatch: 100 });

    // Bank: the sandbox reports accounts containing 0000 as invalid
    expect((await s.json('POST', `/signing/${link}/kyc/bank`, { json: { accountNumber: '123400001234', ifsc: 'HDFC0001234' } })).status).toBe('FAILED');
    expect((await s.json('POST', `/signing/${link}/kyc/bank`, { json: { accountNumber: '50100123456789', ifsc: 'HDFC0001234' } })).status).toBe('PASSED');

    // DigiLocker through the sandbox consent page
    const { url } = await s.json('POST', `/signing/${link}/kyc/digilocker/start`);
    const state = new URL(url).searchParams.get('state')!;
    const allowed = await form('/api/v1/dev/digilocker', { state, name: 'RAVI KUMAR', dob: '15-08-1990', last4: '4321', outcome: 'allow' });
    const back = await follow(allowed.headers.location as string);
    expect(back.headers.location).toMatch(/\?kyc=passed$/);

    // Video: read the code aloud and upload the recording
    const { challenge } = await s.json('POST', `/signing/${link}/kyc/video/challenge`);
    expect(challenge).toMatch(/^\d \d \d \d$/);
    const video = multipart('selfie.webm', Buffer.from('1a45dfa3fake-webm-bytes', 'utf8'), 'video/webm');
    expect((await s.json('POST', `/signing/${link}/kyc/video`, { payload: video.payload, headers: video.headers })).status).toBe('PASSED');

    session = await s.json('GET', `/signing/${link}`);
    expect(session.recipient.idChecks.every((x: { status: string }) => x.status === 'PASSED')).toBe(true);
    expect(session.recipient.idChecks[0].data.pan).toBe('ABXXXXX34F');

    // Mandate still missing
    expect((await finish()).statusCode).toBe(400);
    const started = await s.json('POST', `/signing/${link}/mandates/${mandate.id}/start`, { json: { accountNumber: '50100123456789', ifsc: 'HDFC0001234', accountHolder: 'Ravi Kumar' } });
    const approved = await form(`/api/v1/dev/enach/${started.mandateId}`, { outcome: 'approve' });
    expect(approved.headers.location).toMatch(/\?mandate=registered$/);
    expect((await s.call('POST', `/signing/${link}/mandates/${mandate.id}/start`, { json: { accountNumber: '50100123456789', ifsc: 'HDFC0001234', accountHolder: 'Ravi Kumar' } })).statusCode).toBe(409);

    expect((await finish()).statusCode).toBe(200);
    await waitFor(() => c.json('GET', `/envelopes/${env.id}`), (e) => e.status === 'COMPLETED');

    const audit = await c.json('GET', `/envelopes/${env.id}/audit`);
    const types = audit.events.map((e: { type: string }) => e.type);
    expect(types.filter((t: string) => t === 'recipient.id_check_passed')).toHaveLength(4);
    expect(types).toContain('recipient.id_check_failed');
    const reg = audit.events.find((e: { type: string }) => e.type === 'mandate.registered');
    expect(reg.data).toMatchObject({ maxAmount: 450_000, frequency: 'MONTHLY', account: 'XXXX6789' });
    expect(reg.data.umrn).toMatch(/^SBXN\d{16}$/);

    const checks = await c.json('GET', `/envelopes/${env.id}/kyc`);
    expect(checks.filter((x: { status: string }) => x.status === 'PASSED')).toHaveLength(4);
    const rec = checks.find((x: { kind: string }) => x.kind === 'VIDEO');
    const dl = await c.call('GET', `/envelopes/${env.id}/kyc/${rec.id}/recording`);
    expect(dl.headers['content-type']).toBe('video/webm');
    // Full identifiers are never stored
    expect(JSON.stringify(checks)).not.toContain('ABCPK1234F');
    expect(JSON.stringify(checks)).not.toContain('50100123456789');
  });
});
