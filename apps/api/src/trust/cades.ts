import { createHash, randomBytes } from 'node:crypto';
import { Signer } from '@signpdf/utils';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import type { KeyProvider } from './keys.js';

const OID = {
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
  signatureTimeStampToken: '1.2.840.113549.1.9.16.2.14',
  sha256: '2.16.840.1.101.3.4.2.1',
  sha256WithRSA: '1.2.840.113549.1.1.11',
};

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest();
const toArrayBuffer = (b: Buffer) => new Uint8Array(b).buffer;

export interface TimestampResult {
  timestamped: boolean;
  genTime?: Date;
  tsa?: string;
  error?: string;
}

/**
 * Produces a detached CMS signature in the ETSI CAdES baseline profile used by
 * PAdES (ETSI.CAdES.detached): content-type, message-digest and
 * signing-certificate-v2 signed attributes, plus an optional RFC 3161 signature
 * timestamp (B-T). The private key operation is delegated to a KeyProvider, so
 * only the encoded attributes, never the document, reach the key.
 */
export class CadesSigner extends Signer {
  lastTimestamp: TimestampResult = { timestamped: false };

  constructor(
    private keys: KeyProvider,
    private tsaUrl: string,
  ) {
    super();
  }

  async sign(content: Buffer): Promise<Buffer> {
    const chainDer = this.keys.certificateChain();
    const certs = chainDer.map((der) => pkijs.Certificate.fromBER(toArrayBuffer(der)));
    const signerCert = certs[0];

    const essCertIdV2 = new asn1js.Sequence({
      value: [
        // hashAlgorithm omitted: DEFAULT sha256
        new asn1js.OctetString({ valueHex: toArrayBuffer(sha256(chainDer[0])) }),
        new asn1js.Sequence({
          value: [
            new asn1js.Sequence({
              value: [
                new asn1js.Constructed({
                  idBlock: { tagClass: 3, tagNumber: 4 }, // [4] directoryName
                  value: [signerCert.issuer.toSchema()],
                }),
              ],
            }),
            signerCert.serialNumber,
          ],
        }),
      ],
    });

    const attributes = [
      new pkijs.Attribute({ type: OID.contentType, values: [new asn1js.ObjectIdentifier({ value: OID.data })] }),
      new pkijs.Attribute({
        type: OID.messageDigest,
        values: [new asn1js.OctetString({ valueHex: toArrayBuffer(sha256(content)) })],
      }),
      new pkijs.Attribute({
        type: OID.signingCertificateV2,
        values: [new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [essCertIdV2] })] })],
      }),
    ];
    // DER requires SET OF members sorted by their encoding
    attributes.sort((a, b) =>
      Buffer.compare(Buffer.from(a.toSchema().toBER()), Buffer.from(b.toSchema().toBER())),
    );
    const signedAttrs = new pkijs.SignedAndUnsignedAttributes({ type: 0, attributes });

    // The signature covers the attributes encoded as a SET (tag 0x31) instead of [0]
    const toBeSigned = Buffer.from(signedAttrs.toSchema().toBER());
    toBeSigned[0] = 0x31;
    const signatureValue = await this.keys.sign(toBeSigned);

    const signerInfo = new pkijs.SignerInfo({
      version: 1,
      sid: new pkijs.IssuerAndSerialNumber({ issuer: signerCert.issuer, serialNumber: signerCert.serialNumber }),
      digestAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 }),
      signedAttrs,
      signatureAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256WithRSA }),
      signature: new asn1js.OctetString({ valueHex: toArrayBuffer(signatureValue) }),
    });

    this.lastTimestamp = { timestamped: false };
    if (this.tsaUrl) {
      try {
        const { token, genTime } = await requestTimestamp(this.tsaUrl, sha256(signatureValue));
        signerInfo.unsignedAttrs = new pkijs.SignedAndUnsignedAttributes({
          type: 1,
          attributes: [new pkijs.Attribute({ type: OID.signatureTimeStampToken, values: [token.toSchema()] })],
        });
        this.lastTimestamp = { timestamped: true, genTime, tsa: this.tsaUrl };
      } catch (err) {
        // Degrade to PAdES-B-B rather than failing the signature; the caller records this in the audit trail.
        this.lastTimestamp = { timestamped: false, tsa: this.tsaUrl, error: (err as Error).message };
      }
    }

    const signedData = new pkijs.SignedData({
      version: 1,
      digestAlgorithms: [new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 })],
      encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: OID.data }),
      certificates: certs,
      signerInfos: [signerInfo],
    });
    const contentInfo = new pkijs.ContentInfo({ contentType: OID.signedData, content: signedData.toSchema(true) });
    return Buffer.from(contentInfo.toSchema().toBER());
  }
}

/** RFC 3161 timestamp request. */
export async function requestTimestamp(
  tsaUrl: string,
  digest: Buffer,
): Promise<{ token: pkijs.ContentInfo; genTime: Date }> {
  const nonce = randomBytes(8);
  nonce[0] &= 0x7f;
  const req = new pkijs.TimeStampReq({
    version: 1,
    messageImprint: new pkijs.MessageImprint({
      hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 }),
      hashedMessage: new asn1js.OctetString({ valueHex: toArrayBuffer(digest) }),
    }),
    nonce: new asn1js.Integer({ valueHex: toArrayBuffer(nonce) }),
    certReq: true,
  });
  const res = await fetch(tsaUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/timestamp-query' },
    body: new Uint8Array(req.toSchema().toBER()),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`TSA responded ${res.status}`);
  const resp = pkijs.TimeStampResp.fromBER(await res.arrayBuffer());
  const status = resp.status.status;
  if ((status !== 0 && status !== 1) || !resp.timeStampToken) {
    throw new Error(`TSA rejected the request (status ${status})`);
  }
  const tst = parseTstInfo(resp.timeStampToken);
  const imprint = Buffer.from(tst.messageImprint.hashedMessage.valueBlock.valueHexView);
  if (!imprint.equals(digest)) throw new Error('TSA returned a token for a different digest');
  return { token: resp.timeStampToken, genTime: tst.genTime };
}

export function parseTstInfo(token: pkijs.ContentInfo): pkijs.TSTInfo {
  const signed = new pkijs.SignedData({ schema: token.content });
  const eContent = signed.encapContentInfo.eContent;
  if (!eContent) throw new Error('Timestamp token has no content');
  return pkijs.TSTInfo.fromBER(eContent.getValue());
}

export { OID };
