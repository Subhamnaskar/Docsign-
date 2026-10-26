import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import forge from 'node-forge';
import { config } from '../config.js';

/**
 * Key material for Aadhaar eSign:
 *  - the ASP key signs our eSign requests (in production, its certificate is
 *    registered with the ESP);
 *  - the sandbox ESP key and sandbox CA are used only by the built-in sandbox
 *    ESP, which issues clearly-labelled test certificates.
 */

export interface KeyPairPem {
  keyPem: string;
  certPem: string;
}

function serial() {
  const b = randomBytes(16);
  b[0] &= 0x7f;
  return b.toString('hex');
}

function newRsa() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

export function issueCertificate(opts: {
  subject: { name: string; value: string }[];
  issuer?: KeyPairPem;
  ca?: boolean;
  years?: number;
  publicKeyPem?: string;
  keyUsage?: Record<string, boolean>;
}): KeyPairPem {
  const pair = opts.publicKeyPem ? { publicKey: opts.publicKeyPem, privateKey: '' } : newRsa();
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(pair.publicKey);
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + (opts.years ?? 5) * 365 * 24 * 3600 * 1000);
  cert.setSubject(opts.subject);
  const issuerCert = opts.issuer ? forge.pki.certificateFromPem(opts.issuer.certPem) : null;
  cert.setIssuer(issuerCert ? issuerCert.subject.attributes : opts.subject);
  cert.setExtensions([
    { name: 'basicConstraints', cA: Boolean(opts.ca), critical: true },
    { name: 'keyUsage', critical: true, ...(opts.keyUsage ?? (opts.ca ? { keyCertSign: true, cRLSign: true } : { digitalSignature: true, nonRepudiation: true })) },
    { name: 'subjectKeyIdentifier' },
  ]);
  const signingKey = forge.pki.privateKeyFromPem(opts.issuer ? opts.issuer.keyPem : pair.privateKey);
  cert.sign(signingKey, forge.md.sha256.create());
  return { keyPem: pair.privateKey, certPem: forge.pki.certificateToPem(cert) };
}

function loadOrCreate(name: string, create: () => KeyPairPem): KeyPairPem {
  const dir = resolve(config.keysDir);
  mkdirSync(dir, { recursive: true });
  const keyPath = join(dir, `${name}-key.pem`);
  const certPath = join(dir, `${name}-cert.pem`);
  if (!existsSync(keyPath)) {
    const kp = create();
    writeFileSync(keyPath, kp.keyPem, { mode: 0o600 });
    writeFileSync(certPath, kp.certPem);
  }
  return { keyPem: readFileSync(keyPath, 'utf8'), certPem: readFileSync(certPath, 'utf8') };
}

const cache = new Map<string, KeyPairPem>();
const memo = (name: string, create: () => KeyPairPem) => {
  if (!cache.has(name)) cache.set(name, loadOrCreate(name, create));
  return cache.get(name)!;
};

/** Our Application Service Provider key, used to sign eSign requests. */
export const aspKeys = () =>
  memo('esign-asp', () => issueCertificate({ subject: [{ name: 'commonName', value: `Nuronix eSign ASP (${config.cellRegion})` }], years: 3 }));

export const sandboxCa = () =>
  memo('esign-sandbox-ca', () =>
    issueCertificate({ subject: [{ name: 'commonName', value: 'Aadhaar eSign SANDBOX CA - NOT FOR PRODUCTION' }], ca: true, years: 10 }),
  );

/** Key the sandbox ESP signs its responses with. */
export const sandboxEspKeys = () =>
  memo('esign-sandbox-esp', () => issueCertificate({ subject: [{ name: 'commonName', value: 'Sandbox eSign Service Provider' }], issuer: sandboxCa() }));
