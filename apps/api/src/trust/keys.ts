import { createSign, generateKeyPairSync, randomBytes, webcrypto } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import forge from 'node-forge';
import * as pkijs from 'pkijs';
import { config } from '../config.js';

/**
 * A signing key whose private part never leaves the provider. Production cells
 * back this with an HSM (PKCS#11 / cloud KMS); only digests are sent to it.
 */
export interface KeyProvider {
  readonly id: string;
  /** DER certificates, signer certificate first. */
  certificateChain(): Buffer[];
  /** RSASSA-PKCS1-v1_5 with SHA-256 over `data`. */
  sign(data: Buffer): Promise<Buffer>;
  /**
   * Revocation list for certificates this provider's own CA issued (the dev CA).
   * Production keys come from a public CA whose OCSP/CRL services are queried instead.
   */
  crlFor?(certDer: Buffer): Promise<Buffer | null>;
}

/**
 * Development key provider: generates a private "DocSign Dev Root CA" and a
 * platform seal certificate on first run and keeps them on disk.
 * Signatures validate structurally everywhere; Adobe shows them as "validity
 * unknown" until the dev root is trusted, as expected for a non-AATL CA.
 */
class LocalKeyProvider implements KeyProvider {
  readonly id = 'local-dev';
  private chain: Buffer[];
  private privateKeyPem: string;
  private caKeyPem: string;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    const keyPath = join(dir, 'seal-key.pem');
    const certPath = join(dir, 'seal-cert.pem');
    const caPath = join(dir, 'root-ca.pem');
    const caKeyPath = join(dir, 'root-ca-key.pem');
    // Older dev setups didn't keep the CA key, which is needed to issue revocation lists
    if (!existsSync(keyPath) || !existsSync(caKeyPath)) generate(keyPath, certPath, caPath, caKeyPath);
    this.privateKeyPem = readFileSync(keyPath, 'utf8');
    this.caKeyPem = readFileSync(caKeyPath, 'utf8');
    this.chain = [certPath, caPath].map((p) => pemToDer(readFileSync(p, 'utf8')));
  }

  async crlFor(certDer: Buffer) {
    const root = pkijs.Certificate.fromBER(new Uint8Array(this.chain[1]).buffer);
    const cert = pkijs.Certificate.fromBER(new Uint8Array(certDer).buffer);
    if (!cert.issuer.isEqual(root.subject) || cert.subject.isEqual(root.subject)) return null;
    return devCrl(root, this.caKeyPem);
  }

  certificateChain() {
    return this.chain;
  }

  async sign(data: Buffer) {
    return createSign('sha256').update(data).sign(this.privateKeyPem);
  }
}

function pemToDer(pem: string): Buffer {
  return Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(forge.pki.certificateFromPem(pem))).getBytes(), 'binary');
}

function newKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}

function serial() {
  // Positive 16-byte serial
  const b = randomBytes(16);
  b[0] &= 0x7f;
  return b.toString('hex');
}

function generate(keyPath: string, certPath: string, caPath: string, caKeyPath: string) {
  const ca = newKeyPair();
  const caKey = forge.pki.privateKeyFromPem(ca.privateKeyPem);
  const caCert = forge.pki.createCertificate();
  caCert.publicKey = forge.pki.publicKeyFromPem(ca.publicKeyPem);
  caCert.serialNumber = serial();
  caCert.validity.notBefore = new Date(Date.now() - 60_000);
  caCert.validity.notAfter = new Date(Date.now() + 20 * 365 * 24 * 3600 * 1000);
  const caAttrs = [
    { name: 'commonName', value: 'DocSign Dev Root CA' },
    { name: 'organizationName', value: 'DocSign (development)' },
  ];
  caCert.setSubject(caAttrs);
  caCert.setIssuer(caAttrs);
  caCert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  caCert.sign(caKey, forge.md.sha256.create());

  const seal = newKeyPair();
  const sealCert = forge.pki.createCertificate();
  sealCert.publicKey = forge.pki.publicKeyFromPem(seal.publicKeyPem);
  sealCert.serialNumber = serial();
  sealCert.validity.notBefore = new Date(Date.now() - 60_000);
  sealCert.validity.notAfter = new Date(Date.now() + 5 * 365 * 24 * 3600 * 1000);
  sealCert.setSubject([
    { name: 'commonName', value: 'DocSign Platform Seal' },
    { name: 'organizationName', value: 'DocSign (development)' },
    { name: 'organizationalUnitName', value: `Cell: ${config.cellRegion}` },
  ]);
  sealCert.setIssuer(caAttrs);
  sealCert.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true, critical: true },
    { name: 'subjectKeyIdentifier' },
    { name: 'authorityKeyIdentifier', keyIdentifier: caCert.generateSubjectKeyIdentifier().getBytes() },
    // Lets PDF viewers fetch the dev CA's revocation list
    { name: 'cRLDistributionPoints', altNames: [{ type: 6, value: `${config.appUrl}/api/v1/trust/dev-ca.crl` }] },
  ]);
  sealCert.sign(caKey, forge.md.sha256.create());

  writeFileSync(keyPath, seal.privateKeyPem, { mode: 0o600 });
  writeFileSync(certPath, forge.pki.certificateToPem(sealCert));
  writeFileSync(caPath, forge.pki.certificateToPem(caCert));
  writeFileSync(caKeyPath, ca.privateKeyPem, { mode: 0o600 });
}

/** An empty CRL from the dev CA, valid for 7 days (nothing it issued is revoked). */
async function devCrl(root: pkijs.Certificate, caKeyPem: string): Promise<Buffer> {
  const der = Buffer.from(caKeyPem.replace(/-----[^-]+-----|\s/g, ''), 'base64');
  const key = await webcrypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const now = new Date();
  const crl = new pkijs.CertificateRevocationList({
    version: 1,
    issuer: root.subject,
    thisUpdate: new pkijs.Time({ type: 0, value: now }),
    nextUpdate: new pkijs.Time({ type: 0, value: new Date(now.getTime() + 7 * 24 * 3600_000) }),
  });
  await crl.sign(key as CryptoKey, 'SHA-256');
  return Buffer.from(crl.toSchema(true).toBER());
}

let provider: KeyProvider | undefined;

export function sealKeyProvider(): KeyProvider {
  provider ??= new LocalKeyProvider(resolve(config.keysDir));
  return provider;
}
