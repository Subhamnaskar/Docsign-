import { createSign, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import formbody from '@fastify/formbody';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import forge from 'node-forge';
import { z } from 'zod';
import { appendAudit } from '../audit/audit.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { advanceEnvelope } from '../envelopes/service.js';
import { clientInfo, signingToken } from '../lib/auth.js';
import { sha256Hex } from '../lib/crypto.js';
import { badRequest, HttpError } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { resolvePolicy, type ResolvedPolicy } from '../policy/engine.js';
import { actorOf, loadByToken, requireReady, requireSession } from '../signing/routes.js';
import { resolveFieldValues } from '../signing/values.js';
import { CadesSigner } from '../trust/cades.js';
import type { KeyProvider } from '../trust/keys.js';
import { aspKeys, issueCertificate, sandboxCa, sandboxEspKeys } from './keys.js';
import { completeTransaction, createSigningTransaction, failTransaction, type CryptoMethod } from './service.js';
import { buildEsignRequest, buildEsignResponse, parseEsignRequest, parseEsignResponse, verifyEnveloped } from './xml.js';

const pemToDer = (pem: string) => Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(forge.pki.certificateFromPem(pem))).getBytes(), 'binary');
const pemToBase64Der = (pem: string) => pemToDer(pem).toString('base64');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** HTML that immediately POSTs a form (how eSign requests and responses travel through the browser). */
function autoPost(action: string, fields: Record<string, string>, note: string) {
  const inputs = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Redirecting</title></head>
<body style="font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;color:#374151">
<form id="f" method="POST" action="${esc(action)}">${inputs}<noscript><button type="submit">Continue</button></noscript></form>
<p>${esc(note)}</p><script>document.getElementById('f').submit()</script></body></html>`;
}

const espUrl = () => (config.esign.mode === 'production' ? config.esign.espUrl : `${config.appUrl}/api/v1/dev/esp`);
const espCertPem = () => (config.esign.mode === 'production' ? readFileSync(config.esign.espCertPath, 'utf8') : sandboxEspKeys().certPem);

const startBody = z.object({
  consent: z.literal(true, { errorMap: () => ({ message: 'You must agree to sign electronically.' }) }),
  values: z.record(z.string(), z.string().max(600_000)),
});

export async function esignRoutes(app: FastifyInstance) {
  await app.register(formbody);

  /** Saves the signer's field values and consent, then opens a signing transaction. */
  async function begin(req: FastifyRequest, method: CryptoMethod) {
    const { token } = req.params as { token: string };
    const body = parse(startBody, req.body);
    const r = await loadByToken(token);
    requireReady(r);
    requireSession(req, r);
    if (r.signatureMethod !== method) throw badRequest('This signing request uses a different signing method.');
    const [fields, others] = await Promise.all([
      prisma.field.findMany({ where: { recipientId: r.id } }),
      prisma.field.findMany({ where: { envelopeId: r.envelopeId, recipientId: { not: r.id } } }),
    ]);
    const updates = resolveFieldValues(r, fields, others, body.values, [], { crypto: true });
    const policy = (r.envelope.policy as unknown as ResolvedPolicy | null) ?? resolvePolicy(r.envelope.jurisdiction, r.envelope.documentType);
    await prisma.$transaction(async (tx) => {
      for (const u of updates) await tx.field.update({ where: { id: u.id }, data: { value: u.value } });
      await appendAudit(tx, {
        envelopeId: r.envelopeId,
        type: 'recipient.consented',
        actor: actorOf(r),
        data: { consentTextSha256: sha256Hex(policy.consentText), method },
        ...clientInfo(req),
      });
    });
    return { r, txn: await createSigningTransaction(r, method) };
  }

  // --- Aadhaar eSign ---------------------------------------------------------
  app.post('/signing/:token/esign/start', async (req) => {
    if (config.esign.mode === 'off') throw new HttpError(503, 'Aadhaar eSign is not enabled.', 'esign_unavailable');
    if (config.esign.mode === 'production' && !config.esign.espUrl) throw new HttpError(503, 'ESIGN_ESP_URL is not configured.', 'esign_unavailable');
    const { r, txn } = await begin(req, 'AADHAAR_ESIGN');
    const asp = aspKeys();
    const xml = buildEsignRequest({
      txn: txn.txn,
      aspId: config.esign.aspId,
      responseUrl: `${config.appUrl}/api/v1/esign/callback`,
      docs: txn.documents.map((d, i) => ({ id: String(i + 1), hash: d.digest, docInfo: d.name })),
      signerName: r.name,
      keyPem: asp.keyPem,
      certPem: asp.certPem,
    });
    return { action: espUrl(), fields: { eSignRequest: xml, aspTxnID: txn.txn, 'Content-Type': 'application/xml' } };
  });

  /** The ESP posts the signed response here through the signer's browser. */
  app.post('/esign/callback', async (req, reply: FastifyReply) => {
    const { eSignResponse } = parse(z.object({ eSignResponse: z.string().min(1).max(2_000_000) }), req.body);
    if (!verifyEnveloped(eSignResponse, espCertPem())) throw badRequest('The eSign response signature is invalid.');
    const resp = parseEsignResponse(eSignResponse);
    const txn = await prisma.esignTransaction.findUnique({ where: { id: resp.txn } });
    if (!txn) throw badRequest('Unknown eSign transaction.');
    const r = await prisma.recipient.findUniqueOrThrow({ where: { id: txn.recipientId } });
    const back = `${config.appUrl}/sign/${signingToken(r)}`;

    if (resp.status !== '1') {
      await failTransaction(txn.id, `${resp.errCode}: ${resp.errMsg}`);
      return reply.redirect(`${back}?esign=failed&reason=${encodeURIComponent(resp.errMsg)}`, 303);
    }
    const docs = txn.documents as unknown as { documentId: string }[];
    const signatures = new Map(resp.signatures.map((s) => [docs[Number(s.id) - 1]?.documentId, Buffer.from(s.pkcs7, 'base64')]));
    try {
      await completeTransaction(txn.id, signatures, { ...clientInfo(req) });
    } catch (err) {
      await failTransaction(txn.id, (err as Error).message);
      return reply.redirect(`${back}?esign=failed&reason=${encodeURIComponent((err as Error).message)}`, 303);
    }
    advanceEnvelope(txn.envelopeId).catch((err) => req.log.error({ err }, 'advanceEnvelope failed'));
    return reply.redirect(`${back}?esign=done`, 303);
  });

  // --- DSC (USB token) ---------------------------------------------------------
  /** Returns the digests a local DSC signing utility must sign (CAdES detached over the digest). */
  app.post('/signing/:token/dsc/prepare', async (req) => {
    const { txn } = await begin(req, 'DSC');
    return { txn: txn.txn, documents: txn.documents.map((d) => ({ documentId: d.documentId, name: d.name, digest: d.digest })) };
  });

  app.post('/signing/:token/dsc/complete', async (req) => {
    const { token } = req.params as { token: string };
    const body = parse(
      z.object({ txn: z.string(), signatures: z.array(z.object({ documentId: z.string(), cms: z.string().max(200_000) })).min(1) }),
      req.body,
    );
    const r = await loadByToken(token);
    requireReady(r);
    requireSession(req, r);
    const txn = await prisma.esignTransaction.findUnique({ where: { id: body.txn } });
    if (!txn || txn.recipientId !== r.id) throw badRequest('Unknown signing transaction.');
    try {
      await completeTransaction(txn.id, new Map(body.signatures.map((s) => [s.documentId, Buffer.from(s.cms, 'base64')])), clientInfo(req));
    } catch (err) {
      if (err instanceof HttpError && err.statusCode === 409) throw err;
      await failTransaction(txn.id, (err as Error).message);
      throw err;
    }
    advanceEnvelope(r.envelopeId).catch((err) => req.log.error({ err }, 'advanceEnvelope failed'));
    return { signed: true };
  });

  // --- Sandbox ESP (development and tests only) ------------------------------
  if (config.esign.mode !== 'sandbox') return;

  const sandboxPage = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aadhaar eSign (sandbox)</title>
<style>body{font-family:system-ui,sans-serif;background:#f6f7fb;margin:0;padding:24px;color:#111827}main{max-width:420px;margin:24px auto;background:#fff;border-radius:16px;padding:28px;box-shadow:0 1px 3px #0001}
label{display:block;font-size:14px;font-weight:600;margin:14px 0 4px}input[type=text]{width:100%;box-sizing:border-box;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:16px}
button{margin-top:18px;width:100%;padding:12px;border:0;border-radius:8px;background:#0f766e;color:#fff;font-weight:600;font-size:15px}.warn{background:#fef3c7;color:#92400e;border-radius:8px;padding:10px;font-size:13px}.err{background:#fee2e2;color:#991b1b;border-radius:8px;padding:10px;font-size:13px;margin-top:10px}small{color:#6b7280}</style></head><body><main>${body}</main></body></html>`;

  function form(requestXml: string, error?: string) {
    const req = parseEsignRequest(requestXml);
    const docs = req.docs.map((d) => `<li>${esc(d.docInfo)} <small>(${d.hash.slice(0, 12)}…)</small></li>`).join('');
    return sandboxPage(`<h1 style="font-size:20px;margin:0 0 4px">Aadhaar eSign</h1><p style="margin:0 0 12px"><small>Sandbox eSign Service Provider</small></p>
<div class="warn">SANDBOX: no real Aadhaar check happens and the signature is <b>not legally valid</b>. Use any 12 digits and OTP <b>123456</b>.</div>
<p style="font-size:14px">You are signing:</p><ul style="font-size:14px">${docs}</ul>
<form method="POST" action="${config.appUrl}/api/v1/dev/esp/authorize">
<input type="hidden" name="eSignRequest" value="${esc(requestXml)}">
<label for="n">Name as per Aadhaar</label><input id="n" type="text" name="name" required>
<label for="a">Aadhaar number / VID</label><input id="a" type="text" name="aadhaar" inputmode="numeric" pattern="[0-9 ]{12,16}" required>
<label for="o">OTP</label><input id="o" type="text" name="otp" inputmode="numeric" maxlength="6" required>
<label style="font-weight:400;font-size:13px"><input type="checkbox" name="consent" value="yes" required> I consent to authenticate with Aadhaar and sign the documents above.</label>
${error ? `<div class="err">${esc(error)}</div>` : ''}<button type="submit">Sign</button></form>`);
  }

  app.post('/dev/esp', async (req, reply) => {
    const { eSignRequest } = parse(z.object({ eSignRequest: z.string().min(1) }), req.body);
    if (!verifyEnveloped(eSignRequest, aspKeys().certPem)) throw badRequest('Request signature invalid (sandbox ESP only trusts this server\'s ASP key).');
    reply.type('text/html');
    return form(eSignRequest);
  });

  app.post('/dev/esp/authorize', async (req, reply) => {
    const body = parse(
      z.object({ eSignRequest: z.string().min(1), name: z.string().trim().min(1).max(100), aadhaar: z.string(), otp: z.string(), consent: z.string().optional() }),
      req.body,
    );
    if (!verifyEnveloped(body.eSignRequest, aspKeys().certPem)) throw badRequest('Request signature invalid.');
    const request = parseEsignRequest(body.eSignRequest);
    reply.type('text/html');
    if (!/^\d{12}$/.test(body.aadhaar.replace(/\s/g, ''))) return form(body.eSignRequest, 'Enter a 12-digit Aadhaar number.');
    if (body.otp !== '123456') return form(body.eSignRequest, 'Incorrect OTP. In the sandbox the OTP is 123456.');
    if (body.consent !== 'yes') return form(body.eSignRequest, 'Consent is required.');

    // A one-time key and certificate per signing, as real ESPs issue
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const userCert = issueCertificate({
      publicKeyPem: publicKey,
      issuer: sandboxCa(),
      years: 1,
      subject: [
        { name: 'commonName', value: body.name },
        { name: 'organizationName', value: 'Aadhaar eSign SANDBOX - not valid' },
        { name: 'countryName', value: 'IN' },
        { name: 'serialNumber', value: `SANDBOX-${body.aadhaar.replace(/\s/g, '').slice(-4)}` },
      ],
    });
    const keys: KeyProvider = {
      id: 'sandbox-esp-user',
      certificateChain: () => [pemToDer(userCert.certPem), pemToDer(sandboxCa().certPem)],
      sign: async (data) => createSign('sha256').update(data).sign(privateKey),
    };
    const signer = new CadesSigner(keys, '');
    const signatures = await Promise.all(
      request.docs.map(async (d) => ({ id: d.id, pkcs7: (await signer.signDigest(Buffer.from(d.hash, 'hex'))).toString('base64') })),
    );
    const esp = sandboxEspKeys();
    const response = buildEsignResponse({
      txn: request.txn,
      status: '1',
      userCertificate: pemToBase64Der(userCert.certPem),
      signatures,
      keyPem: esp.keyPem,
      certPem: esp.certPem,
    });
    return autoPost(request.responseUrl, { eSignResponse: response }, 'Returning to the document…');
  });

  /** Sandbox convenience: lets the signer cancel, producing an error response. */
  app.post('/dev/esp/cancel', async (req, reply) => {
    const { eSignRequest } = parse(z.object({ eSignRequest: z.string().min(1) }), req.body);
    const request = parseEsignRequest(eSignRequest);
    const esp = sandboxEspKeys();
    const response = buildEsignResponse({ txn: request.txn, status: '0', errCode: 'ESP-999', errMsg: 'Cancelled by user', keyPem: esp.keyPem, certPem: esp.certPem });
    reply.type('text/html');
    return autoPost(request.responseUrl, { eSignResponse: response }, 'Returning…');
  });

}
