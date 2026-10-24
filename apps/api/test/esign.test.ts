import { createSign, generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import forge from 'node-forge';
import { beforeAll, describe, expect, it } from 'vitest';
import { issueCertificate, aspKeys } from '../src/esign/keys.js';
import { buildEsignRequest, parseEsignRequest, verifyEnveloped } from '../src/esign/xml.js';
import { CadesSigner } from '../src/trust/cades.js';
import type { KeyProvider } from '../src/trust/keys.js';
import { verifyPdfSignatures } from '../src/trust/verify.js';
import { client, getApp, lastMail, makePdf, multipart, registerSender, uid, waitFor } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await getApp();
});

const unescapeHtml = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const hiddenValue = (html: string, name: string) => unescapeHtml(new RegExp(`name="${name}" value="([^"]*)"`).exec(html)![1]);
const form = (fields: Record<string, string>) => ({
  payload: new URLSearchParams(fields).toString(),
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
});
const pemToDer = (pem: string) => Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(forge.pki.certificateFromPem(pem))).getBytes(), 'binary');

/** A DSC-like certificate and key, standing in for a USB token. */
function dscSigner(opts: { expired?: boolean } = {}) {
  const ca = issueCertificate({ subject: [{ name: 'commonName', value: 'Test DSC CA' }], ca: true });
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const cert = issueCertificate({ publicKeyPem: publicKey, issuer: ca, subject: [{ name: 'commonName', value: 'Lender Authorised Signatory' }], years: opts.expired ? -1 : 2 });
  const keys: KeyProvider = {
    id: 'test-dsc',
    certificateChain: () => [pemToDer(cert.certPem), pemToDer(ca.certPem)],
    sign: async (data) => createSign('sha256').update(data).sign(privateKey),
  };
  return new CadesSigner(keys, '');
}

describe('eSign XML', () => {
  it('signs requests with the ASP key and detects tampering', () => {
    const asp = aspKeys();
    const xml = buildEsignRequest({
      txn: 'T1',
      aspId: 'ASP',
      responseUrl: 'https://x.test/cb',
      docs: [{ id: '1', hash: 'ab'.repeat(32), docInfo: 'Loan <&> agreement' }],
      keyPem: asp.keyPem,
      certPem: asp.certPem,
    });
    expect(verifyEnveloped(xml, asp.certPem)).toBe(true);
    expect(parseEsignRequest(xml).docs[0]).toMatchObject({ hash: 'ab'.repeat(32), docInfo: 'Loan <&> agreement' });
    expect(verifyEnveloped(xml.replace('ab'.repeat(32), 'cd'.repeat(32)), asp.certPem)).toBe(false);
  });
});

async function verifyByOtp(email: string) {
  const link = lastMail(email, /Please sign/).text.match(/\/sign\/([\w.-]+)/)![1];
  const s = client(app);
  await s.json('POST', `/signing/${link}/otp/send`);
  await s.json('POST', `/signing/${link}/otp/verify`, { json: { code: lastMail(email, /\d{6}/).subject.match(/\d{6}/)![0] } });
  return { s, link, session: await s.json('GET', `/signing/${link}`) };
}

describe('Indian loan agreement: e-stamp, Aadhaar eSign and DSC', () => {
  it('stamps, collects AES signatures incrementally and seals', async () => {
    const { c } = await registerSender(app, 'IN');
    const borrower = `borrower-${uid()}@example.test`;
    const lender = `lender-${uid()}@example.test`;
    let env = await c.json('POST', '/envelopes', { json: { title: 'Personal loan', jurisdiction: 'IN', documentType: 'loan_agreement' } });
    expect(env.policy).toMatchObject({ allowed: true, signatureLevel: 'AES', signatureProvider: 'aadhaar-esign', stampDutyRequired: true });

    const { payload, headers } = multipart('loan.pdf', await makePdf('Loan agreement', 2));
    const doc = await c.json('POST', `/envelopes/${env.id}/documents`, { payload, headers });
    env = await c.json('PUT', `/envelopes/${env.id}/recipients`, {
      json: [
        { name: 'Ravi Kumar', email: borrower, routingOrder: 1, signatureMethod: 'AADHAAR_ESIGN' },
        { name: 'Lender Co', email: lender, routingOrder: 2, signatureMethod: 'DSC' },
      ],
    });
    const [b, l] = env.recipients;
    await c.json('PUT', `/envelopes/${env.id}/fields`, {
      json: [
        { documentId: doc.id, recipientId: b.id, type: 'SIGNATURE', page: 1, x: 0.1, y: 0.7, width: 0.35, height: 0.08 },
        { documentId: doc.id, recipientId: b.id, type: 'TEXT', label: 'PAN', page: 1, x: 0.1, y: 0.6, width: 0.3, height: 0.03 },
        { documentId: doc.id, recipientId: l.id, type: 'SIGNATURE', page: 1, x: 0.55, y: 0.7, width: 0.35, height: 0.08 },
      ],
    });

    // Stamp duty is required before sending
    const unstamped = await c.call('POST', `/envelopes/${env.id}/send`);
    expect(unstamped.statusCode).toBe(422);
    expect(unstamped.json().error.details.problems.join(' ')).toMatch(/e-stamp/);
    await c.json('PATCH', `/envelopes/${env.id}`, {
      json: { estamp: { state: 'MH', article: 'Article 5(h) Agreement', dutyAmount: 500, firstParty: 'Ravi Kumar', secondParty: 'Lender Co', purpose: 'Loan agreement' } },
    });
    env = await c.json('POST', `/envelopes/${env.id}/send`);
    expect(env.estampResult).toMatchObject({ state: 'MH', sandbox: true });
    expect(env.documents[0].pageCount).toBe(3);
    expect(env.fields.every((f: { page: number }) => f.page === 2)).toBe(true);

    // Electronic completion is refused for an Aadhaar signer
    const bs = await verifyByOtp(borrower);
    expect(bs.session.recipient.signatureMethod).toBe('AADHAAR_ESIGN');
    expect((await bs.s.call('POST', `/signing/${bs.link}/complete`, { json: { consent: true, values: {} } })).statusCode).toBe(400);

    // Borrower: Aadhaar eSign through the sandbox ESP
    const pan = bs.session.fields.find((f: { label: string }) => f.label === 'PAN').id;
    const start = await bs.s.json('POST', `/signing/${bs.link}/esign/start`, { json: { consent: true, values: { [pan]: 'ABCDE1234F' } } });
    expect(start.action).toMatch(/\/api\/v1\/dev\/esp$/);
    const espPage = await app.inject({ method: 'POST', url: '/api/v1/dev/esp', ...form({ eSignRequest: start.fields.eSignRequest }) });
    expect(espPage.body).toContain('SANDBOX');
    const wrongOtp = await app.inject({
      method: 'POST',
      url: '/api/v1/dev/esp/authorize',
      ...form({ eSignRequest: start.fields.eSignRequest, name: 'Ravi Kumar', aadhaar: '999988887777', otp: '000000', consent: 'yes' }),
    });
    expect(wrongOtp.body).toContain('Incorrect OTP');
    const authorized = await app.inject({
      method: 'POST',
      url: '/api/v1/dev/esp/authorize',
      ...form({ eSignRequest: start.fields.eSignRequest, name: 'Ravi Kumar', aadhaar: '999988887777', otp: '123456', consent: 'yes' }),
    });
    const callback = await app.inject({ method: 'POST', url: '/api/v1/esign/callback', ...form({ eSignResponse: hiddenValue(authorized.body, 'eSignResponse') }) });
    expect(callback.statusCode).toBe(303);
    expect(callback.headers.location).toMatch(/esign=done/);

    // A forged response is rejected
    const forged = await app.inject({ method: 'POST', url: '/api/v1/esign/callback', ...form({ eSignResponse: hiddenValue(authorized.body, 'eSignResponse').replace('status="1"', 'status="0"') }) });
    expect(forged.statusCode).toBe(400);

    // Lender: DSC
    await waitFor(async () => { try { return lastMail(lender, /Please sign/); } catch { return null; } }, (m) => m !== null);
    const ls = await verifyByOtp(lender);
    const prep = await ls.s.json('POST', `/signing/${ls.link}/dsc/prepare`, { json: { consent: true, values: {} } });
    const expired = dscSigner({ expired: true });
    const badSigs = await Promise.all(prep.documents.map(async (d: { documentId: string; digest: string }) => ({ documentId: d.documentId, cms: (await expired.signDigest(Buffer.from(d.digest, 'hex'))).toString('base64') })));
    expect((await ls.s.call('POST', `/signing/${ls.link}/dsc/complete`, { json: { txn: prep.txn, signatures: badSigs } })).statusCode).toBe(400);

    const prep2 = await ls.s.json('POST', `/signing/${ls.link}/dsc/prepare`, { json: { consent: true, values: {} } });
    const token = dscSigner();
    const sigs = await Promise.all(prep2.documents.map(async (d: { documentId: string; digest: string }) => ({ documentId: d.documentId, cms: (await token.signDigest(Buffer.from(d.digest, 'hex'))).toString('base64') })));
    await ls.s.json('POST', `/signing/${ls.link}/dsc/complete`, { json: { txn: prep2.txn, signatures: sigs } });

    const done = await waitFor(() => c.json('GET', `/envelopes/${env.id}`), (e) => e.status === 'COMPLETED');
    const pdf = await c.call('GET', `/envelopes/${env.id}/documents/${done.documents[0].id}/file`);
    // DUMP_PDF=path.pdf writes the result for manual inspection
    if (process.env.DUMP_PDF) writeFileSync(process.env.DUMP_PDF, pdf.rawPayload);
    const reports = await verifyPdfSignatures(pdf.rawPayload);
    expect(reports.map((r) => r.signerName)).toEqual(['Ravi Kumar', 'Lender Authorised Signatory', 'DocSign Platform Seal']);
    expect(reports.every((r) => r.integrityValid)).toBe(true);
    expect(reports[2].coversWholeDocument).toBe(true);

    const audit = await c.json('GET', `/envelopes/${env.id}/audit`);
    const types = audit.events.map((e: { type: string }) => e.type);
    expect(types).toEqual(expect.arrayContaining(['document.stamped', 'recipient.esign_failed', 'recipient.signed', 'document.sealed', 'envelope.completed']));
    const signedEvents = audit.events.filter((e: { type: string }) => e.type === 'recipient.signed');
    expect(signedEvents.map((e: { data: { method: string } }) => e.data.method)).toEqual(['aadhaar-esign', 'dsc']);
    expect(signedEvents[0].data.certificate.subject).toContain('CN=Ravi Kumar');
    expect(audit.chain.valid).toBe(true);
  });
});
