import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { PDFArray, PDFDict, PDFDocument, PDFName, type PDFObject, PDFRef, PDFStream } from 'pdf-lib';
import { OID, parseTstInfo } from './cades.js';

export interface SignatureReport {
  index: number;
  /** A signer's signature or seal, or a PAdES document (archive) timestamp */
  kind: 'signature' | 'document-timestamp';
  subFilter: string | null;
  signerName: string | null;
  issuerName: string | null;
  /** Message digest and signature value check out for the signed byte ranges. */
  integrityValid: boolean;
  /**
   * Nothing was changed after this signature, apart from long-term validation
   * data (DSS, document timestamps), which PAdES explicitly allows.
   */
  coversWholeDocument: boolean;
  /** What was appended after the signed bytes ('validation-data' also covers further signature fields) */
  laterChanges: 'none' | 'validation-data' | 'other';
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
    const laterChanges = await changesAfter(pdf, c + d);
    const report: SignatureReport = {
      index,
      kind: subFilter === 'ETSI.RFC3161' ? 'document-timestamp' : 'signature',
      subFilter,
      signerName: null,
      issuerName: null,
      integrityValid: false,
      coversWholeDocument: laterChanges !== 'other',
      laterChanges,
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

      if (report.kind === 'document-timestamp') {
        // The token's message imprint must be the hash of the covered bytes
        const tst = parseTstInfo(contentInfo);
        const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new Uint8Array(signed)));
        const imprintOk = Buffer.from(tst.messageImprint.hashedMessage.valueBlock.valueHexView).equals(digest);
        const sigOk = imprintOk && (await signedData.verify({ signer: 0, data: toArrayBuffer(signed), checkChain: false }).catch(() => false)) === true;
        const tsCert = (signedData.certificates ?? []).find((x): x is pkijs.Certificate => x instanceof pkijs.Certificate);
        report.signerName = tsCert ? commonName(tsCert.subject) : null;
        report.issuerName = tsCert ? commonName(tsCert.issuer) : null;
        report.integrityValid = sigOk;
        report.timestamp = { genTime: tst.genTime.toISOString(), valid: sigOk };
        reports.push(report);
        continue;
      }

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

// ---------------------------------------------------------------------------
// What changed after a signature
// ---------------------------------------------------------------------------

function bytesOf(obj: PDFObject): string {
  const buf = new Uint8Array(obj.sizeInBytes());
  obj.copyBytesInto(buf, 0);
  return Buffer.from(buf).toString('latin1');
}

const dictOf = (o: PDFObject | undefined) => (o instanceof PDFDict ? o : o instanceof PDFStream ? o.dict : undefined);

/** Keys whose values differ between two dictionaries. */
function changedKeys(a: PDFDict, b: PDFDict): string[] {
  const keys = new Set([...a.keys(), ...b.keys()].map((k) => k.asString()));
  return [...keys].filter((k) => {
    const x = a.get(PDFName.of(k.slice(1)));
    const y = b.get(PDFName.of(k.slice(1)));
    return (x ? bytesOf(x) : '') !== (y ? bytesOf(y) : '');
  });
}

/** True when `ref` is a signature widget (signer, seal or document timestamp field). */
function isSignatureWidget(doc: PDFDocument, ref: PDFObject): boolean {
  const d = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
  return dictOf(d)?.get(PDFName.of('FT'))?.toString() === '/Sig';
}

/** Entries added to an array (earlier entries must be unchanged and in order). */
function addedEntries(before: PDFArray | undefined, after: PDFArray | undefined): PDFObject[] | null {
  const a = before?.asArray() ?? [];
  const b = after?.asArray() ?? [];
  if (b.length < a.length) return null;
  for (let i = 0; i < a.length; i++) if (bytesOf(a[i]) !== bytesOf(b[i])) return null;
  return b.slice(a.length);
}

const resolveArray = (doc: PDFDocument, o: PDFObject | undefined) => {
  const v = o instanceof PDFRef ? doc.context.lookup(o) : o;
  return v instanceof PDFArray ? v : undefined;
};

const onlySignatureWidgets = (doc: PDFDocument, added: PDFObject[] | null) => added !== null && added.every((x) => isSignatureWidget(doc, x));

/**
 * Compares the revision ending at `end` with the final file and classifies the
 * difference: nothing, only long-term validation data (DSS, VRI, document
 * timestamps and their invisible fields), or anything else.
 */
export async function changesAfter(pdf: Buffer, end: number): Promise<'none' | 'validation-data' | 'other'> {
  if (end >= pdf.length) return 'none';
  // Appended bytes must form complete revisions
  if (!/%%EOF\s*$/.test(pdf.subarray(Math.max(end, pdf.length - 64)).toString('latin1'))) return 'other';
  let before: PDFDocument;
  let after: PDFDocument;
  try {
    before = await PDFDocument.load(pdf.subarray(0, end), { updateMetadata: false });
    after = await PDFDocument.load(pdf, { updateMetadata: false });
  } catch {
    return 'other';
  }
  const old = new Map<string, PDFObject>();
  for (const [ref, obj] of before.context.enumerateIndirectObjects()) old.set(ref.tag, obj);
  // Something must actually have been added (a DSS or a document timestamp)
  let addedValidationData = false;

  for (const [ref, obj] of after.context.enumerateIndirectObjects()) {
    const prev = old.get(ref.tag);
    // New objects only matter if something existing points at them; those changes are checked below
    if (!prev || bytesOf(prev) === bytesOf(obj)) continue;

    if (prev instanceof PDFArray && obj instanceof PDFArray) {
      // Indirect /Annots or /Fields arrays may only gain signature widgets
      if (onlySignatureWidgets(after, addedEntries(prev, obj))) {
        addedValidationData = true;
        continue;
      }
      return 'other';
    }
    if (prev instanceof PDFStream || obj instanceof PDFStream) return 'other';
    const p = dictOf(prev);
    const n = dictOf(obj);
    if (!p || !n) return 'other';
    const type = p.get(PDFName.of('Type'))?.toString();
    const diff = changedKeys(p, n);

    if (type === '/Catalog') {
      if (diff.every((k) => k === '/DSS' || k === '/AcroForm')) {
        addedValidationData = true;
        continue;
      }
      return 'other';
    }
    if (type === '/Page') {
      if (diff.some((k) => k !== '/Annots')) return 'other';
      const added = addedEntries(resolveArray(before, p.get(PDFName.of('Annots'))), resolveArray(after, n.get(PDFName.of('Annots'))));
      if (onlySignatureWidgets(after, added)) {
        addedValidationData = true;
        continue;
      }
      return 'other';
    }
    if (p.has(PDFName.of('Fields'))) {
      // AcroForm: new signature fields and SigFlags only
      if (diff.some((k) => k !== '/Fields' && k !== '/SigFlags')) return 'other';
      const added = addedEntries(resolveArray(before, p.get(PDFName.of('Fields'))), resolveArray(after, n.get(PDFName.of('Fields'))));
      if (onlySignatureWidgets(after, added)) {
        addedValidationData = true;
        continue;
      }
      return 'other';
    }
    // DSS and VRI dictionaries may grow
    if (p.has(PDFName.of('Certs')) || p.has(PDFName.of('VRI')) || diff.every((k) => /^\/[0-9A-F]{40}$/.test(k))) {
      addedValidationData = true;
      continue;
    }
    return 'other';
  }
  return addedValidationData ? 'validation-data' : 'other';
}
