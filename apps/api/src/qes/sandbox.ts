import { createHash, generateKeyPairSync, privateEncrypt, constants as cryptoConstants, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import formbody from '@fastify/formbody';
import type { FastifyInstance } from 'fastify';
import forge from 'node-forge';
import { config } from '../config.js';
import { hmacSha256Hex, safeEqualHex } from '../lib/crypto.js';

/**
 * Sandbox trust service implementing the slice of CSC v2 the app uses:
 * OAuth authorize/token, credentials/list, credentials/info and
 * signatures/signHash. Certificates come from a "DocSign Sandbox QTSP" CA and
 * are NOT qualified. The PIN 000000 is refused, to test failures.
 */

const dir = () => resolve(config.keysDir, 'csc-sandbox');
const pemToDer = (pem: string) => Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(forge.pki.certificateFromPem(pem))).getBytes(), 'binary');
const serial = () => {
  const b = randomBytes(16);
  b[0] &= 0x7f;
  return b.toString('hex');
};

function newRsa() {
  return generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
}

function sandboxCa() {
  mkdirSync(dir(), { recursive: true });
  const keyPath = join(dir(), 'ca-key.pem');
  const certPath = join(dir(), 'ca-cert.pem');
  if (!existsSync(keyPath)) {
    const kp = newRsa();
    const cert = forge.pki.createCertificate();
    cert.publicKey = forge.pki.publicKeyFromPem(kp.publicKey);
    cert.serialNumber = serial();
    cert.validity.notBefore = new Date(Date.now() - 60_000);
    cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 24 * 3600_000);
    const attrs = [{ name: 'commonName', value: 'DocSign Sandbox QTSP (not qualified)' }, { name: 'countryName', value: 'EU' }];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.setExtensions([{ name: 'basicConstraints', cA: true, critical: true }, { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true }]);
    cert.sign(forge.pki.privateKeyFromPem(kp.privateKey), forge.md.sha256.create());
    writeFileSync(keyPath, kp.privateKey, { mode: 0o600 });
    writeFileSync(certPath, forge.pki.certificateToPem(cert));
  }
  return { keyPem: readFileSync(keyPath, 'utf8'), certPem: readFileSync(certPath, 'utf8') };
}

/** One signing credential per user (email), created on first use. */
function credential(email: string, name: string) {
  const id = createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 24);
  const keyPath = join(dir(), `${id}-key.pem`);
  const certPath = join(dir(), `${id}-cert.pem`);
  if (!existsSync(keyPath)) {
    const ca = sandboxCa();
    const caCert = forge.pki.certificateFromPem(ca.certPem);
    const kp = newRsa();
    const cert = forge.pki.createCertificate();
    cert.publicKey = forge.pki.publicKeyFromPem(kp.publicKey);
    cert.serialNumber = serial();
    cert.validity.notBefore = new Date(Date.now() - 60_000);
    cert.validity.notAfter = new Date(Date.now() + 2 * 365 * 24 * 3600_000);
    cert.setSubject([{ name: 'commonName', value: name }, { name: 'emailAddress', value: email }]);
    cert.setIssuer(caCert.subject.attributes);
    cert.setExtensions([{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true, nonRepudiation: true, critical: true }]);
    cert.sign(forge.pki.privateKeyFromPem(ca.keyPem), forge.md.sha256.create());
    writeFileSync(keyPath, kp.privateKey, { mode: 0o600 });
    writeFileSync(certPath, forge.pki.certificateToPem(cert));
  }
  return { id, keyPem: readFileSync(keyPath, 'utf8'), certPem: readFileSync(certPath, 'utf8') };
}

const credentialById = (id: string) => {
  const keyPath = join(dir(), `${id}-key.pem`);
  return /^[0-9a-f]{24}$/.test(id) && existsSync(keyPath) ? { keyPem: readFileSync(keyPath, 'utf8'), certPem: readFileSync(join(dir(), `${id}-cert.pem`), 'utf8') } : null;
};

/** Codes and tokens are signed claims, so the sandbox needs no storage. */
const sign = (claims: object) => {
  const body = Buffer.from(JSON.stringify({ ...claims, exp: Date.now() + 10 * 60_000 })).toString('base64url');
  return `${body}.${hmacSha256Hex(config.appSecret, `csc:${body}`)}`;
};
const verify = <T>(token: string | undefined): T | null => {
  const [body, mac] = (token ?? '').split('.');
  if (!body || !mac || !safeEqualHex(mac, hmacSha256Hex(config.appSecret, `csc:${body}`))) return null;
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { exp: number };
  return claims.exp > Date.now() ? claims : null;
};

// DigestInfo prefix for SHA-256 (PKCS#1 v1.5)
const SHA256_DIGEST_INFO = Buffer.from('3031300d060960864801650304020105000420', 'hex');

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const page = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sandbox trust service</title>
<style>body{font-family:system-ui,sans-serif;background:#f6f7fb;margin:0;padding:24px}main{max-width:420px;margin:24px auto;background:#fff;border-radius:16px;padding:28px;box-shadow:0 1px 3px #0001}
label{display:block;font-size:14px;font-weight:600;margin:14px 0 4px}input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:16px}
button{margin-top:18px;width:100%;padding:12px;border:0;border-radius:8px;background:#1e3a8a;color:#fff;font-weight:600;font-size:15px}.warn{background:#fef3c7;color:#92400e;border-radius:8px;padding:10px;font-size:13px}</style></head><body><main>${body}</main></body></html>`;

type Claims = { scope: string; credentialID: string; hashes?: string };

/** In-process equivalents of the sandbox endpoints (the API calls these directly in sandbox mode). */
export const sandboxCsc = {
  token(code: string): string | null {
    const claims = verify<Claims>(code);
    return claims ? sign(claims) : null;
  },
  list(token: string): string[] | null {
    const t = verify<Claims>(token);
    return t && t.scope === 'service' ? [t.credentialID] : null;
  },
  chain(token: string, credentialID: string): string[] | null {
    const t = verify<Claims>(token);
    const cred = credentialById(credentialID);
    if (!t || t.credentialID !== credentialID || !cred) return null;
    return [pemToDer(cred.certPem).toString('base64'), pemToDer(sandboxCa().certPem).toString('base64')];
  },
  signHash(token: string, credentialID: string, hashes: string[]): string[] | 'unauthorized' | 'mismatch' {
    const t = verify<Claims>(token);
    if (!t || t.scope !== 'credential' || t.credentialID !== credentialID) return 'unauthorized';
    // Only the hashes the signer authorised may be signed
    const authorised = (t.hashes ?? '').split(',');
    const requested = hashes.map((h) => Buffer.from(h, 'base64').toString('base64url'));
    if (requested.length !== authorised.length || requested.some((h, i) => h !== authorised[i])) return 'mismatch';
    const cred = credentialById(credentialID)!;
    return hashes.map((h) =>
      privateEncrypt({ key: cred.keyPem, padding: cryptoConstants.RSA_PKCS1_PADDING }, Buffer.concat([SHA256_DIGEST_INFO, Buffer.from(h, 'base64')])).toString('base64'),
    );
  },
};

export async function qesSandboxRoutes(app: FastifyInstance) {
  await app.register(formbody);

  app.get('/dev/csc/oauth2/authorize', async (req, reply) => {
    const q = req.query as Record<string, string>;
    reply.type('text/html');
    const hidden = Object.entries(q).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
    if (q.scope === 'credential') {
      return page(`<p class="warn">SANDBOX trust service: signatures are NOT qualified.</p><h1 style="font-size:20px">Authorise ${esc(q.numSignatures ?? '1')} signature(s)</h1>
<form method="POST" action="${config.appUrl}/api/v1/dev/csc/oauth2/authorize">${hidden}<label for="pin">Signing PIN</label><input id="pin" name="pin" inputmode="numeric" maxlength="6" required placeholder="Any 6 digits except 000000"><button>Sign</button></form>`);
    }
    return page(`<p class="warn">SANDBOX trust service: signatures are NOT qualified.</p><h1 style="font-size:20px">Sign in to your trust service</h1>
<form method="POST" action="${config.appUrl}/api/v1/dev/csc/oauth2/authorize">${hidden}<label for="n">Full name (on your certificate)</label><input id="n" name="name" required>
<label for="e">Email</label><input id="e" name="email" type="email" value="${esc(q.login_hint ?? '')}" required><button>Continue</button></form>`);
  });

  app.post('/dev/csc/oauth2/authorize', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, string>;
    const back = (params: Record<string, string>) => reply.redirect(`${b.redirect_uri}?${new URLSearchParams({ ...params, state: b.state ?? '' })}`, 303);
    if (b.scope === 'credential') {
      if (!/^\d{6}$/.test(b.pin ?? '') || b.pin === '000000') return back({ error: 'access_denied', error_description: 'Wrong PIN' });
      return back({ code: sign({ scope: 'credential', credentialID: b.credentialID, hashes: b.hashes }) });
    }
    const cred = credential(b.email ?? '', (b.name ?? '').trim() || b.email);
    return back({ code: sign({ scope: 'service', credentialID: cred.id }) });
  });

  // The same operations over HTTP, as a QTSP would expose them
  app.post('/dev/csc/oauth2/token', async (req, reply) => {
    const token = sandboxCsc.token((req.body as Record<string, string>)?.code ?? '');
    if (!token) return reply.code(400).send({ error: 'invalid_grant' });
    return { access_token: token, token_type: 'Bearer', expires_in: 600 };
  });

  const bearer = (h: string | undefined) => h?.replace(/^Bearer /, '') ?? '';

  app.post('/dev/csc/csc/v2/credentials/list', async (req, reply) => {
    const ids = sandboxCsc.list(bearer(req.headers.authorization));
    return ids ? { credentialIDs: ids } : reply.code(401).send({ error: 'invalid_token' });
  });

  app.post('/dev/csc/csc/v2/credentials/info', async (req, reply) => {
    const chain = sandboxCsc.chain(bearer(req.headers.authorization), ((req.body ?? {}) as { credentialID?: string }).credentialID ?? '');
    if (!chain) return reply.code(401).send({ error: 'invalid_token' });
    return { key: { status: 'enabled', algo: ['1.2.840.113549.1.1.1'], len: 2048 }, cert: { status: 'valid', certificates: chain }, authMode: 'oauth2code' };
  });

  app.post('/dev/csc/csc/v2/signatures/signHash', async (req, reply) => {
    const body = (req.body ?? {}) as { credentialID?: string; hashes?: string[] };
    const res = sandboxCsc.signHash(bearer(req.headers.authorization), body.credentialID ?? '', body.hashes ?? []);
    if (res === 'unauthorized') return reply.code(401).send({ error: 'invalid_token' });
    if (res === 'mismatch') return reply.code(400).send({ error: 'invalid_request', error_description: 'Hashes differ from the authorisation' });
    return { signatures: res };
  });
}
