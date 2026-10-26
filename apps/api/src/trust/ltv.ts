import { createHash } from 'node:crypto';
import * as asn1js from 'asn1js';
import { PDFArray, PDFDict, PDFName, PDFRef, type PDFDocument } from 'pdf-lib';
import * as pkijs from 'pkijs';
import { config } from '../config.js';
import { OID, requestTimestamp } from './cades.js';
import { addSignatureField, embedCms, incrementalUpdate, prepareByteRange } from './incremental.js';
import { sealKeyProvider } from './keys.js';

/**
 * Long-term validation (ETSI EN 319 142-1 PAdES baseline):
 *
 *  - B-LT: a Document Security Store (DSS) holding every certificate and its
 *    revocation data (OCSP responses or CRLs), so signatures can be validated
 *    after the certificates expire or the CA's services go away.
 *  - B-LTA: a document timestamp over everything, including the DSS. Renewing
 *    it before the timestamp authority's certificate expires keeps the
 *    evidence valid indefinitely.
 */

export interface LtvResult {
  pdf: Buffer;
  /** Achieved level, or null when revocation data was missing for some certificate */
  level: 'PAdES-B-LT' | 'PAdES-B-LTA' | null;
  certificates: number;
  crls: number;
  ocsps: number;
  /** Certificates without revocation data (subject CNs) */
  missing: string[];
  documentTimestamp?: Date;
  error?: string;
}

const toArrayBuffer = (b: Buffer | Uint8Array) => new Uint8Array(b).buffer;
const sha1Hex = (b: Buffer) => createHash('sha1').update(b).digest('hex').toUpperCase();
const certKey = (der: Buffer) => createHash('sha256').update(der).digest('hex');
const cn = (c: pkijs.Certificate) => c.subject.typesAndValues.find((t) => t.type === '2.5.4.3')?.value.valueBlock.value ?? 'unknown';

const OIDS = {
  authorityInfoAccess: '1.3.6.1.5.5.7.1.1',
  ocsp: '1.3.6.1.5.5.7.48.1',
  crlDistributionPoints: '2.5.29.31',
};

interface ExtractedSignature {
  /** DER of the CMS in /Contents (VRI key is its SHA-1) */
  contents: Buffer;
  signedData: pkijs.SignedData;
}

/** Every signature container in the file (including document timestamps). */
export function extractSignatures(pdf: Buffer): ExtractedSignature[] {
  const text = pdf.toString('latin1');
  const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  const out: ExtractedSignature[] = [];
  for (let m; (m = re.exec(text)); ) {
    const [a, b, c] = m.slice(1, 4).map(Number);
    if (b === 0 && c === 0) continue;
    const hex = text.slice(a + b + 1, c - 1).replace(/\s/g, '');
    const der = Buffer.from(hex, 'hex');
    const asn = asn1js.fromBER(toArrayBuffer(der));
    if (asn.offset === -1) continue;
    // Strip the zero padding after the DER structure
    const contents = der.subarray(0, asn.offset);
    try {
      const info = new pkijs.ContentInfo({ schema: asn.result });
      out.push({ contents, signedData: new pkijs.SignedData({ schema: info.content }) });
    } catch {
      // Not a CMS; nothing to collect
    }
  }
  return out;
}

/** Certificates inside a SignedData and inside its signature timestamp token. */
function certificatesOf(sd: pkijs.SignedData): pkijs.Certificate[] {
  const certs = (sd.certificates ?? []).filter((c): c is pkijs.Certificate => c instanceof pkijs.Certificate);
  for (const si of sd.signerInfos) {
    for (const attr of si.unsignedAttrs?.attributes ?? []) {
      if (attr.type !== OID.signatureTimeStampToken) continue;
      const token = new pkijs.ContentInfo({ schema: attr.values[0] });
      certs.push(...certificatesOf(new pkijs.SignedData({ schema: token.content })));
    }
  }
  return certs;
}

function extensionValue(cert: pkijs.Certificate, oid: string) {
  return cert.extensions?.find((e) => e.extnID === oid)?.parsedValue;
}

function ocspUrls(cert: pkijs.Certificate): string[] {
  const aia = extensionValue(cert, OIDS.authorityInfoAccess) as pkijs.InfoAccess | undefined;
  return (aia?.accessDescriptions ?? []).filter((d) => d.accessMethod === OIDS.ocsp && d.accessLocation.type === 6).map((d) => String(d.accessLocation.value));
}

function crlUrls(cert: pkijs.Certificate): string[] {
  const dps = extensionValue(cert, OIDS.crlDistributionPoints) as pkijs.CRLDistributionPoints | undefined;
  const urls: string[] = [];
  for (const dp of dps?.distributionPoints ?? []) {
    const names = Array.isArray(dp.distributionPoint) ? dp.distributionPoint : [];
    for (const n of names as pkijs.GeneralName[]) if (n.type === 6) urls.push(String(n.value));
  }
  return urls;
}

const httpUrl = (u: string) => /^https?:\/\//i.test(u);

async function fetchBytes(url: string, init?: RequestInit): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000), redirect: 'follow' });
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

async function fetchOcsp(cert: pkijs.Certificate, issuer: pkijs.Certificate): Promise<Buffer | null> {
  for (const url of ocspUrls(cert).filter(httpUrl)) {
    const req = new pkijs.OCSPRequest();
    await req.createForCertificate(cert, { hashAlgorithm: 'SHA-1', issuerCertificate: issuer });
    const body = await fetchBytes(url, { method: 'POST', headers: { 'Content-Type': 'application/ocsp-request' }, body: new Uint8Array(req.toSchema(true).toBER()) });
    if (!body) continue;
    try {
      const resp = pkijs.OCSPResponse.fromBER(toArrayBuffer(body));
      // 0 = successful; a "good" status is what validators need, but any signed answer is evidence
      if (resp.responseStatus.valueBlock.valueDec === 0) return body;
    } catch {
      // Not an OCSP response; try the next URL
    }
  }
  return null;
}

async function fetchCrl(cert: pkijs.Certificate): Promise<Buffer | null> {
  for (const url of crlUrls(cert).filter(httpUrl)) {
    const body = await fetchBytes(url);
    if (!body) continue;
    try {
      pkijs.CertificateRevocationList.fromBER(toArrayBuffer(body));
      return body;
    } catch {
      // Not a CRL
    }
  }
  return null;
}

interface ValidationData {
  certs: Map<string, Buffer>;
  crls: Map<string, Buffer>;
  ocsps: Map<string, Buffer>;
  /** VRI: per signature, which entries validate it */
  vri: Map<string, { certs: Set<string>; crls: Set<string>; ocsps: Set<string> }>;
  missing: string[];
}

/** Collects certificates and revocation data for every signature in the file. */
export async function collectValidationData(pdf: Buffer): Promise<ValidationData> {
  const data: ValidationData = { certs: new Map(), crls: new Map(), ocsps: new Map(), vri: new Map(), missing: [] };
  const provider = sealKeyProvider();
  const revocationCache = new Map<string, { kind: 'crl' | 'ocsp'; der: Buffer } | null>();

  for (const sig of extractSignatures(pdf)) {
    const certs = certificatesOf(sig.signedData);
    const entry = { certs: new Set<string>(), crls: new Set<string>(), ocsps: new Set<string>() };
    for (const cert of certs) {
      const der = Buffer.from(cert.toSchema(true).toBER());
      const key = certKey(der);
      data.certs.set(key, der);
      entry.certs.add(key);
      if (cert.subject.isEqual(cert.issuer)) continue; // trust anchors need no revocation data

      if (!revocationCache.has(key)) {
        const issuer = certs.find((c) => c.subject.isEqual(cert.issuer));
        let found: { kind: 'crl' | 'ocsp'; der: Buffer } | null = null;
        const local = await provider.crlFor?.(der);
        if (local) found = { kind: 'crl', der: local };
        if (!found && issuer) {
          const ocsp = await fetchOcsp(cert, issuer);
          if (ocsp) found = { kind: 'ocsp', der: ocsp };
        }
        if (!found) {
          const crl = await fetchCrl(cert);
          if (crl) found = { kind: 'crl', der: crl };
        }
        revocationCache.set(key, found);
        if (!found) data.missing.push(cn(cert));
      }
      const rev = revocationCache.get(key);
      if (rev) {
        const rk = certKey(rev.der);
        (rev.kind === 'crl' ? data.crls : data.ocsps).set(rk, rev.der);
        (rev.kind === 'crl' ? entry.crls : entry.ocsps).add(rk);
      }
    }
    data.vri.set(sha1Hex(sig.contents), entry);
  }
  data.missing = [...new Set(data.missing)];
  return data;
}

/** Appends (or extends) the DSS as an incremental update. */
async function writeDss(pdf: Buffer, data: ValidationData): Promise<Buffer> {
  return incrementalUpdate(pdf, async (doc: PDFDocument) => {
    const ctx = doc.context;
    const existing = doc.catalog.lookupMaybe(PDFName.of('DSS'), PDFDict);
    const refs = new Map<string, PDFRef>();
    const arrayFor = (name: string, items: Map<string, Buffer>) => {
      const arr = existing?.lookupMaybe(PDFName.of(name), PDFArray) ?? ctx.obj([]);
      for (const [key, der] of items) {
        const ref = ctx.register(ctx.flateStream(der));
        refs.set(key, ref);
        arr.push(ref);
      }
      return arr;
    };
    const dss = existing ?? ctx.obj({});
    dss.set(PDFName.of('Certs'), arrayFor('Certs', data.certs));
    if (data.crls.size || existing?.has(PDFName.of('CRLs'))) dss.set(PDFName.of('CRLs'), arrayFor('CRLs', data.crls));
    if (data.ocsps.size || existing?.has(PDFName.of('OCSPs'))) dss.set(PDFName.of('OCSPs'), arrayFor('OCSPs', data.ocsps));

    const vri = existing?.lookupMaybe(PDFName.of('VRI'), PDFDict) ?? ctx.obj({});
    for (const [sigHash, e] of data.vri) {
      const pick = (keys: Set<string>) => ctx.obj([...keys].map((k) => refs.get(k)!).filter(Boolean));
      const entry = ctx.obj({ Cert: pick(e.certs) });
      if (e.crls.size) entry.set(PDFName.of('CRL'), pick(e.crls));
      if (e.ocsps.size) entry.set(PDFName.of('OCSP'), pick(e.ocsps));
      vri.set(PDFName.of(sigHash), entry);
    }
    dss.set(PDFName.of('VRI'), vri);
    if (!existing) doc.catalog.set(PDFName.of('DSS'), ctx.register(dss));
  });
}

/** Adds an RFC 3161 document timestamp (PAdES archive timestamp) over the whole file. */
export async function addDocumentTimestamp(pdf: Buffer): Promise<{ pdf: Buffer; genTime: Date }> {
  const withPlaceholder = await incrementalUpdate(pdf, (doc) =>
    addSignatureField(doc, { fieldName: `Nuronix eSign Archive Timestamp ${Date.now()}`, reason: '', name: '', kind: 'timestamp', signatureLength: 12_000 }),
  );
  const prepared = prepareByteRange(withPlaceholder);
  const digest = createHash('sha256').update(prepared.signedContent).digest();
  const { token, genTime } = await requestTimestamp(config.tsaUrl, digest);
  return { pdf: embedCms(prepared, Buffer.from(token.toSchema().toBER())), genTime };
}

/**
 * Upgrades a sealed PDF to B-LT, and to B-LTA when a timestamp authority is
 * configured. Never fails the caller: problems are reported in the result.
 */
export async function addLtv(pdf: Buffer, opts: { archiveTimestamp?: boolean } = {}): Promise<LtvResult> {
  try {
    const data = await collectValidationData(pdf);
    let out = await writeDss(pdf, data);
    const result: LtvResult = {
      pdf: out,
      level: data.missing.length ? null : 'PAdES-B-LT',
      certificates: data.certs.size,
      crls: data.crls.size,
      ocsps: data.ocsps.size,
      missing: data.missing,
    };
    if (opts.archiveTimestamp !== false && config.tsaUrl && result.level) {
      try {
        const ts = await addDocumentTimestamp(out);
        out = ts.pdf;
        result.pdf = out;
        result.level = 'PAdES-B-LTA';
        result.documentTimestamp = ts.genTime;
      } catch (err) {
        result.error = `Archive timestamp failed: ${(err as Error).message}`;
      }
    }
    return result;
  } catch (err) {
    return { pdf, level: null, certificates: 0, crls: 0, ocsps: 0, missing: [], error: (err as Error).message };
  }
}

/** What the file contains for long-term validation (verification portal). */
export function inspectLtv(pdf: Buffer): { dss: boolean; documentTimestamps: number } {
  const text = pdf.toString('latin1');
  return {
    dss: /\/DSS\s+\d+\s+\d+\s+R/.test(text) || /\/DSS\s*<</.test(text),
    documentTimestamps: (text.match(/\/Type\s*\/DocTimeStamp/g) ?? []).length,
  };
}

