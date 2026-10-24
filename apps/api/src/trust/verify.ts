import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { OID, parseTstInfo } from './cades.js';

export interface SignatureReport {
  index: number;
  subFilter: string | null;
  signerName: string | null;
  issuerName: string | null;
  /** Message digest and signature value check out for the signed byte ranges. */
  integrityValid: boolean;
  /** The signature covers the file up to its last byte (no later edits). */
  coversWholeDocument: boolean;
  timestamp: { genTime: string; valid: boolean } | null;
  error?: string;
}

const commonName = (name: pkijs.RelativeDistinguishedNames) =>
  name.typesAndValues.find((t) => t.type === '2.5.4.3')?.value.valueBlock.value ?? null;

const toArrayBuffer = (b: Buffer) => new Uint8Array(b).buffer;

/** Finds every PDF signature and checks it cryptographically. */
export async function verifyPdfSignatures(pdf: Buffer): Promise<SignatureReport[]> {
  const text = pdf.toString('latin1');
  const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  const reports: SignatureReport[] = [];
  let m: RegExpExecArray | null;
  let index = 0;
  while ((m = re.exec(text))) {
    const [a, b, c, d] = m.slice(1).map(Number);
    // Skip unfilled placeholders
    if (b === 0 && c === 0) continue;
    index += 1;
    const dictStart = text.lastIndexOf('<<', m.index);
    const subFilter = /\/SubFilter\s*\/([\w.]+)/.exec(text.slice(dictStart, c))?.[1] ?? null;
    const report: SignatureReport = {
      index,
      subFilter,
      signerName: null,
      issuerName: null,
      integrityValid: false,
      coversWholeDocument: c + d === pdf.length,
      timestamp: null,
    };
    try {
      const hex = text.slice(a + b + 1, c - 1).replace(/\s/g, '');
      const cms = Buffer.from(hex, 'hex');
      const asn = asn1js.fromBER(toArrayBuffer(cms));
      if (asn.offset === -1) throw new Error('Malformed signature container');
      const contentInfo = new pkijs.ContentInfo({ schema: asn.result });
      const signedData = new pkijs.SignedData({ schema: contentInfo.content });
      const signed = Buffer.concat([pdf.subarray(a, a + b), pdf.subarray(c, c + d)]);

      const signerInfo = signedData.signerInfos[0];
      const sid = signerInfo.sid as pkijs.IssuerAndSerialNumber;
      const cert = (signedData.certificates ?? []).find(
        (x): x is pkijs.Certificate =>
          x instanceof pkijs.Certificate && x.serialNumber.isEqual(sid.serialNumber) && x.issuer.isEqual(sid.issuer),
      );
      if (cert) {
        report.signerName = commonName(cert.subject);
        report.issuerName = commonName(cert.issuer);
      }
      const result = await signedData.verify({ signer: 0, data: toArrayBuffer(signed), checkChain: false });
      report.integrityValid = result === true;

      const tsAttr = signerInfo.unsignedAttrs?.attributes.find((x) => x.type === OID.signatureTimeStampToken);
      if (tsAttr) {
        const token = new pkijs.ContentInfo({ schema: tsAttr.values[0] });
        const tst = parseTstInfo(token);
        const sigDigest = await crypto.subtle.digest('SHA-256', new Uint8Array(signerInfo.signature.valueBlock.valueHexView));
        const imprint = Buffer.from(tst.messageImprint.hashedMessage.valueBlock.valueHexView);
        let valid = imprint.equals(Buffer.from(sigDigest));
        if (valid) {
          const tsSigned = new pkijs.SignedData({ schema: token.content });
          // For TSTInfo content pkijs expects `data` to be the timestamped message
          // (our signature value) and checks the message imprint against it.
          const data = new Uint8Array(signerInfo.signature.valueBlock.valueHexView).slice().buffer;
          valid = (await tsSigned.verify({ signer: 0, data, checkChain: false }).catch(() => false)) === true;
        }
        report.timestamp = { genTime: tst.genTime.toISOString(), valid };
      }
    } catch (err) {
      report.error = (err as Error).message;
    }
    reports.push(report);
  }
  return reports;
}
