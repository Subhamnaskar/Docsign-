import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';

/**
 * eSign API 2.1 messages (CCA "e-authentication using Aadhaar e-KYC services").
 * Requests and responses are XML documents carrying an enveloped XML-DSig.
 */

export interface InputHash {
  id: string;
  /** Hex SHA-256 of the bytes covered by the PDF signature */
  hash: string;
  docInfo: string;
}

const escapeAttr = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Local time without zone, as the eSign specification expects. */
export function esignTimestamp(d = new Date()): string {
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return ist.toISOString().slice(0, 19);
}

function signEnveloped(xml: string, keyPem: string, certPem: string): string {
  const sig = new SignedXml({
    privateKey: keyPem,
    publicCert: certPem,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  });
  sig.addReference({
    xpath: '/*',
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    isEmptyUri: true,
  });
  sig.computeSignature(xml, { location: { reference: '/*', action: 'append' } });
  return sig.getSignedXml();
}

/** Verifies the enveloped signature with a known certificate (never one embedded by the sender). */
export function verifyEnveloped(xml: string, certPem: string): boolean {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const sigNode = doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0];
  if (!sigNode) return false;
  const sig = new SignedXml({ publicCert: certPem });
  sig.loadSignature(sigNode as unknown as Node);
  try {
    return sig.checkSignature(xml);
  } catch {
    return false;
  }
}

export function buildEsignRequest(opts: {
  txn: string;
  aspId: string;
  responseUrl: string;
  docs: InputHash[];
  /** 1 = OTP, 2 = biometric, 3 = iris */
  authMode?: '1' | '2' | '3';
  signerName?: string;
  keyPem: string;
  certPem: string;
}): string {
  const docs = opts.docs
    .map((d) => `<InputHash id="${escapeAttr(d.id)}" hashAlgorithm="SHA256" docInfo="${escapeAttr(d.docInfo.slice(0, 50))}">${d.hash}</InputHash>`)
    .join('');
  const xml =
    `<Esign ver="2.1" sc="Y" ts="${esignTimestamp()}" txn="${escapeAttr(opts.txn)}" ekycIdType="A" aspId="${escapeAttr(opts.aspId)}" ` +
    `AuthMode="${opts.authMode ?? '1'}" responseSigType="pkcs7" responseUrl="${escapeAttr(opts.responseUrl)}"` +
    `${opts.signerName ? ` signerid="${escapeAttr(opts.signerName)}"` : ''}><Docs>${docs}</Docs></Esign>`;
  return signEnveloped(xml, opts.keyPem, opts.certPem);
}

export interface EsignRequest {
  txn: string;
  aspId: string;
  responseUrl: string;
  docs: InputHash[];
}

export function parseEsignRequest(xml: string): EsignRequest {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const root = doc.documentElement;
  if (!root || root.nodeName !== 'Esign') throw new Error('Not an eSign request');
  const hashes = Array.from(doc.getElementsByTagName('InputHash'));
  return {
    txn: root.getAttribute('txn') ?? '',
    aspId: root.getAttribute('aspId') ?? '',
    responseUrl: root.getAttribute('responseUrl') ?? '',
    docs: hashes.map((h) => ({ id: h.getAttribute('id') ?? '', hash: (h.textContent ?? '').trim(), docInfo: h.getAttribute('docInfo') ?? '' })),
  };
}

export interface EsignResponse {
  status: '1' | '0';
  txn: string;
  errCode: string;
  errMsg: string;
  /** Base64 DER of the signer's certificate */
  userCertificate: string | null;
  signatures: { id: string; pkcs7: string }[];
}

export function buildEsignResponse(opts: {
  txn: string;
  status: '1' | '0';
  errCode?: string;
  errMsg?: string;
  userCertificate?: string;
  signatures?: { id: string; pkcs7: string }[];
  keyPem: string;
  certPem: string;
}): string {
  const sigs = (opts.signatures ?? []).map((s) => `<DocSignature id="${escapeAttr(s.id)}" sigHashAlgorithm="SHA256" error="">${s.pkcs7}</DocSignature>`).join('');
  const xml =
    `<EsignResp ver="2.1" status="${opts.status}" ts="${esignTimestamp()}" txn="${escapeAttr(opts.txn)}" resCode="${escapeAttr(opts.txn)}" ` +
    `errCode="${escapeAttr(opts.errCode ?? 'NA')}" errMsg="${escapeAttr(opts.errMsg ?? 'NA')}">` +
    (opts.userCertificate ? `<UserX509Certificate>${opts.userCertificate}</UserX509Certificate>` : '') +
    `<Signatures>${sigs}</Signatures></EsignResp>`;
  return signEnveloped(xml, opts.keyPem, opts.certPem);
}

export function parseEsignResponse(xml: string): EsignResponse {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const root = doc.documentElement;
  if (!root || root.nodeName !== 'EsignResp') throw new Error('Not an eSign response');
  const cert = doc.getElementsByTagName('UserX509Certificate')[0];
  return {
    status: root.getAttribute('status') === '1' ? '1' : '0',
    txn: root.getAttribute('txn') ?? '',
    errCode: root.getAttribute('errCode') ?? '',
    errMsg: root.getAttribute('errMsg') ?? '',
    userCertificate: cert?.textContent?.trim() || null,
    signatures: Array.from(doc.getElementsByTagName('DocSignature')).map((s) => ({ id: s.getAttribute('id') ?? '', pkcs7: (s.textContent ?? '').trim() })),
  };
}
