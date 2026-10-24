import { createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import forge from 'node-forge';
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

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    const keyPath = join(dir, 'seal-key.pem');
    const certPath = join(dir, 'seal-cert.pem');
    const caPath = join(dir, 'root-ca.pem');
    if (!existsSync(keyPath)) generate(keyPath, certPath, caPath);
    this.privateKeyPem = readFileSync(keyPath, 'utf8');
    this.chain = [certPath, caPath].map((p) => pemToDer(readFileSync(p, 'utf8')));
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

function generate(keyPath: string, certPath: string, caPath: string) {
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
  ]);
  sealCert.sign(caKey, forge.md.sha256.create());

  writeFileSync(keyPath, seal.privateKeyPem, { mode: 0o600 });
  writeFileSync(certPath, forge.pki.certificateToPem(sealCert));
  writeFileSync(caPath, forge.pki.certificateToPem(caCert));
}

let provider: KeyProvider | undefined;

export function sealKeyProvider(): KeyProvider {
  provider ??= new LocalKeyProvider(resolve(config.keysDir));
  return provider;
}
