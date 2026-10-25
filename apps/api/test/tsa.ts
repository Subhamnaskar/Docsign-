import { createHash, generateKeyPairSync, randomBytes, webcrypto } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as asn1js from 'asn1js';
import forge from 'node-forge';
import * as pkijs from 'pkijs';

/**
 * A minimal RFC 3161 timestamp authority for tests: answers TimeStampReq with
 * a signed TSTInfo from a self-signed "Test TSA" certificate.
 */
const OID = {
  tstInfo: '1.2.840.113549.1.9.16.1.4',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signedData: '1.2.840.113549.1.7.2',
  sha256: '2.16.840.1.101.3.4.2.1',
  sha256WithRSA: '1.2.840.113549.1.1.11',
  policy: '1.3.6.1.4.1.99999.1',
};

const ab = (b: Uint8Array) => new Uint8Array(b).buffer;

function makeCert() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicKey);
  cert.serialNumber = '01' + randomBytes(8).toString('hex');
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600_000);
  const attrs = [{ name: 'commonName', value: 'Test TSA' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([{ name: 'extKeyUsage', timeStamping: true, critical: true }]);
  cert.sign(forge.pki.privateKeyFromPem(privateKey), forge.md.sha256.create());
  const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary');
  return { der, privateKeyPem: privateKey };
}

export async function startTestTsa(): Promise<{ url: string; requests: () => number; close: () => Promise<void> }> {
  const { der, privateKeyPem } = makeCert();
  const certificate = pkijs.Certificate.fromBER(ab(der));
  const key = await webcrypto.subtle.importKey(
    'pkcs8',
    Buffer.from(privateKeyPem.replace(/-----[^-]+-----|\s/g, ''), 'base64'),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  let count = 0;
  let serial = 1;

  async function respond(body: Buffer): Promise<Buffer> {
    const req = pkijs.TimeStampReq.fromBER(ab(body));
    const tst = new pkijs.TSTInfo({
      version: 1,
      policy: OID.policy,
      messageImprint: req.messageImprint,
      serialNumber: new asn1js.Integer({ value: serial++ }),
      genTime: new Date(),
      ...(req.nonce ? { nonce: req.nonce } : {}),
    });
    const tstDer = Buffer.from(tst.toSchema().toBER());
    // Assigned after construction: the constructor would re-encode it as a
    // constructed OCTET STRING, which real TSAs don't send and pkijs can't verify
    const encapContentInfo = new pkijs.EncapsulatedContentInfo({ eContentType: OID.tstInfo });
    encapContentInfo.eContent = new asn1js.OctetString({ valueHex: ab(tstDer) });
    const signedData = new pkijs.SignedData({
      version: 3,
      encapContentInfo,
      certificates: [certificate],
      signerInfos: [
        new pkijs.SignerInfo({
          version: 1,
          sid: new pkijs.IssuerAndSerialNumber({ issuer: certificate.issuer, serialNumber: certificate.serialNumber }),
          signedAttrs: new pkijs.SignedAndUnsignedAttributes({
            type: 0,
            attributes: [
              new pkijs.Attribute({ type: OID.contentType, values: [new asn1js.ObjectIdentifier({ value: OID.tstInfo })] }),
              new pkijs.Attribute({ type: OID.messageDigest, values: [new asn1js.OctetString({ valueHex: ab(createHash('sha256').update(tstDer).digest()) })] }),
            ],
          }),
        }),
      ],
    });
    await signedData.sign(key as CryptoKey, 0, 'SHA-256');
    const token = new pkijs.ContentInfo({ contentType: OID.signedData, content: signedData.toSchema(true) });
    const resp = new pkijs.TimeStampResp({ status: new pkijs.PKIStatusInfo({ status: 0 }), timeStampToken: token });
    return Buffer.from(resp.toSchema().toBER());
  }

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      count += 1;
      try {
        const out = await respond(Buffer.concat(chunks));
        res.writeHead(200, { 'Content-Type': 'application/timestamp-reply' }).end(out);
      } catch (err) {
        res.writeHead(400).end(String(err));
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/`, requests: () => count, close: () => new Promise((r) => server.close(() => r())) };
}
