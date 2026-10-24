import { createHash, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Field, Prisma, Recipient } from '@prisma/client';
import * as asn1js from 'asn1js';
import forge from 'node-forge';
import * as pkijs from 'pkijs';
import { appendAudit, type Actor } from '../audit/audit.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { addFieldAnnotations } from '../documents/annotate.js';
import { boxToPdf, renderCompletedPdf } from '../documents/render.js';
import { prependCertificate, purchaseEstamp, type EstampRequest } from '../estamp/provider.js';
import { sha256Hex } from '../lib/crypto.js';
import { badRequest, conflict, HttpError, notFound } from '../lib/errors.js';
import { getObject, putObject } from '../lib/storage.js';
import { addSignatureField, embedCms, incrementalUpdate, prepareByteRange, type PreparedSignature } from '../trust/incremental.js';
import { enqueueWebhook } from '../webhooks/dispatcher.js';

export type CryptoMethod = 'AADHAAR_ESIGN' | 'DSC';

/** Envelopes where any signer signs cryptographically use the incremental (append-only) pipeline. */
export const isIncremental = (recipients: Pick<Recipient, 'signatureMethod'>[]) => recipients.some((r) => r.signatureMethod !== 'ELECTRONIC');

const toArrayBuffer = (b: Buffer) => new Uint8Array(b).buffer;

// ---------------------------------------------------------------------------
// Send-time preparation
// ---------------------------------------------------------------------------

/**
 * Runs before an envelope is sent: buys the e-stamp (inserted as page 1 of the
 * first document) and, for incremental envelopes, creates the working copies
 * that signer signatures are appended to.
 */
export async function prepareForSend(envelopeId: string, actor: Actor) {
  const env = await prisma.envelope.findUniqueOrThrow({
    where: { id: envelopeId },
    include: { documents: { orderBy: { order: 'asc' } }, recipients: true },
  });

  if (env.estamp && !env.estampResult && env.documents.length > 0) {
    const req = env.estamp as unknown as EstampRequest;
    const { result, certificatePdf } = await purchaseEstamp(req, env.id);
    const first = env.documents[0];
    const stamped = await prependCertificate(await getObject(first.storageKey), certificatePdf);
    const storageKey = `envelopes/${env.id}/original/${first.id}-stamped.pdf`;
    await putObject(storageKey, stamped, 'application/pdf');
    const pages = first.pages as { width: number; height: number; rotation: number }[];
    await prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: first.id },
        data: {
          storageKey,
          sha256: sha256Hex(stamped),
          pageCount: first.pageCount + 1,
          pages: [{ width: 595.28, height: 841.89, rotation: 0 }, ...pages],
        },
      });
      // Fields keep their place on the original pages, now one page later
      await tx.field.updateMany({ where: { documentId: first.id }, data: { page: { increment: 1 } } });
      await tx.envelope.update({ where: { id: env.id }, data: { estampResult: result as unknown as Prisma.JsonObject } });
      await appendAudit(tx, {
        envelopeId: env.id,
        type: 'document.stamped',
        actor,
        data: { documentId: first.id, ...result, sha256: sha256Hex(stamped) },
      });
    });
  }

  if (isIncremental(env.recipients)) {
    const docs = await prisma.document.findMany({ where: { envelopeId: env.id } });
    for (const d of docs) {
      // Envelope-ID stamp goes in now, before anyone signs; the result has a classic xref table
      const working = Buffer.from(await renderCompletedPdf(await getObject(d.storageKey), [], { envelopeId: env.id, signedAt: new Map() }));
      const workingKey = `envelopes/${env.id}/working/${d.id}-0.pdf`;
      await putObject(workingKey, working, 'application/pdf');
      await prisma.document.update({ where: { id: d.id }, data: { workingKey } });
    }
  }
}

// ---------------------------------------------------------------------------
// Per-signer increments
// ---------------------------------------------------------------------------

function signatureRect(page: Parameters<typeof boxToPdf>[0], f: Field): [number, number, number, number] {
  const b = boxToPdf(page, f);
  return b.rotate === 90
    ? [b.x - b.h, b.y, b.x, b.y + b.w]
    : b.rotate === 180
      ? [b.x - b.w, b.y - b.h, b.x, b.y]
      : b.rotate === 270
        ? [b.x, b.y - b.w, b.x + b.h, b.y]
        : [b.x, b.y, b.x + b.w, b.y + b.h];
}

/** Electronic signers in an incremental envelope: their values are appended as annotations. */
export async function applyElectronicIncrement(envelopeId: string, recipientId: string) {
  const r = await prisma.recipient.findUniqueOrThrow({ where: { id: recipientId } });
  const docs = await prisma.document.findMany({ where: { envelopeId } });
  const fields = await prisma.field.findMany({ where: { recipientId } });
  const attachmentNames = new Map<string, string>();
  for (const d of docs) {
    const mine = fields.filter((f) => f.documentId === d.id && f.value);
    if (mine.length === 0 || !d.workingKey) continue;
    const next = await incrementalUpdate(await getObject(d.workingKey), (doc) => addFieldAnnotations(doc, mine, { signedAt: r.signedAt ?? new Date(), attachmentNames }));
    const key = `envelopes/${envelopeId}/working/${d.id}-${Date.now()}.pdf`;
    await putObject(key, next, 'application/pdf');
    await prisma.document.update({ where: { id: d.id }, data: { workingKey: key } });
  }
}

interface PreparedDoc {
  documentId: string;
  name: string;
  preparedKey: string;
  contentsStart: number;
  contentsEnd: number;
  /** Hex SHA-256 of the bytes the signature covers */
  digest: string;
}

/**
 * Builds, for every document, an increment with the signer's field values as
 * annotations plus an empty signature field, and records what must be signed.
 */
export async function createSigningTransaction(r: Recipient, method: CryptoMethod) {
  const docs = await prisma.document.findMany({ where: { envelopeId: r.envelopeId }, orderBy: { order: 'asc' } });
  const fields = await prisma.field.findMany({ where: { recipientId: r.id } });
  const txn = `DS${Date.now()}${randomBytes(6).toString('hex')}`;
  const signedAt = new Date();
  const prepared: PreparedDoc[] = [];

  // A newer attempt supersedes any unfinished one
  await prisma.esignTransaction.updateMany({ where: { recipientId: r.id, status: 'PENDING' }, data: { status: 'SUPERSEDED' } });

  for (const d of docs) {
    if (!d.workingKey) throw conflict('This envelope is not set up for cryptographic signing.');
    const mine = fields.filter((f) => f.documentId === d.id);
    const sigField = mine.find((f) => f.type === 'SIGNATURE');
    const label = method === 'AADHAAR_ESIGN' ? 'Aadhaar eSign' : 'Digital Signature Certificate';
    const withPlaceholder = await incrementalUpdate(await getObject(d.workingKey), async (doc) => {
      await addFieldAnnotations(
        doc,
        mine.filter((f) => f.value && f.type !== 'SIGNATURE' && f.type !== 'INITIALS'),
        { signedAt },
      );
      await addSignatureField(doc, {
        fieldName: `${r.name} (${r.id.slice(-6)})`,
        reason: `Signed with ${label}`,
        name: r.name,
        location: 'India',
        contactInfo: r.email,
        appearance: sigField
          ? {
              page: sigField.page,
              rect: signatureRect(doc.getPage(sigField.page), sigField),
              lines: [`Digitally signed by ${r.name}`, label, `Date: ${signedAt.toISOString().slice(0, 19).replace('T', ' ')} UTC`],
            }
          : undefined,
      });
    });
    const p = prepareByteRange(withPlaceholder);
    const preparedKey = `envelopes/${r.envelopeId}/signing/${txn}/${d.id}.pdf`;
    await putObject(preparedKey, p.pdf, 'application/pdf');
    prepared.push({
      documentId: d.id,
      name: d.name,
      preparedKey,
      contentsStart: p.contentsStart,
      contentsEnd: p.contentsEnd,
      digest: createHash('sha256').update(p.signedContent).digest('hex'),
    });
  }

  await prisma.esignTransaction.create({
    data: {
      id: txn,
      envelopeId: r.envelopeId,
      recipientId: r.id,
      provider: method === 'AADHAAR_ESIGN' ? 'aadhaar-esign' : 'dsc',
      documents: prepared as unknown as Prisma.JsonArray,
    },
  });
  return { txn, documents: prepared };
}

// ---------------------------------------------------------------------------
// Completing a transaction
// ---------------------------------------------------------------------------

export interface CertificateInfo {
  subject: string;
  issuer: string;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  sha256: string;
}

const dn = (name: pkijs.RelativeDistinguishedNames) =>
  name.typesAndValues
    .map((t) => `${{ '2.5.4.3': 'CN', '2.5.4.10': 'O', '2.5.4.11': 'OU', '2.5.4.6': 'C', '2.5.4.8': 'ST', '2.5.4.5': 'SERIALNUMBER' }[t.type] ?? t.type}=${t.value.valueBlock.value}`)
    .join(', ');

/** Checks that `cms` is a valid signature over `content` and returns the signer certificate. */
export async function verifyCmsOver(cms: Buffer, content: Buffer): Promise<{ cert: pkijs.Certificate; info: CertificateInfo; chain: pkijs.Certificate[] }> {
  const asn = asn1js.fromBER(toArrayBuffer(cms));
  if (asn.offset === -1) throw badRequest('The signature is not valid CMS.');
  const signed = new pkijs.SignedData({ schema: new pkijs.ContentInfo({ schema: asn.result }).content });
  const ok = await signed.verify({ signer: 0, data: toArrayBuffer(content), checkChain: false }).catch(() => false);
  if (ok !== true) throw badRequest('The signature does not match the document.');
  const sid = signed.signerInfos[0].sid as pkijs.IssuerAndSerialNumber;
  const chain = (signed.certificates ?? []).filter((c): c is pkijs.Certificate => c instanceof pkijs.Certificate);
  const cert = chain.find((c) => c.serialNumber.isEqual(sid.serialNumber) && c.issuer.isEqual(sid.issuer));
  if (!cert) throw badRequest('The signer certificate is missing from the signature.');
  const der = Buffer.from(cert.toSchema().toBER());
  return {
    cert,
    chain,
    info: {
      subject: dn(cert.subject),
      issuer: dn(cert.issuer),
      serialNumber: Buffer.from(cert.serialNumber.valueBlock.valueHexView).toString('hex'),
      notBefore: cert.notBefore.value.toISOString(),
      notAfter: cert.notAfter.value.toISOString(),
      sha256: sha256Hex(der),
    },
  };
}

function loadTrustedRoots(dir: string): pkijs.Certificate[] {
  return readdirSync(dir)
    .filter((f) => /\.(pem|crt|cer)$/i.test(f))
    .flatMap((f) => {
      const pem = readFileSync(join(dir, f), 'utf8');
      return [...pem.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)].map((m) => {
        const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(forge.pki.certificateFromPem(m[0]))).getBytes(), 'binary');
        return pkijs.Certificate.fromBER(toArrayBuffer(der));
      });
    });
}

/** DSC certificates must be currently valid and, when roots are configured, chain to them. */
async function checkDscCertificate(cert: pkijs.Certificate, chain: pkijs.Certificate[]): Promise<{ chainVerified: boolean }> {
  const now = new Date();
  if (cert.notBefore.value > now || cert.notAfter.value < now) throw badRequest('The signing certificate has expired or is not yet valid.');
  if (!config.esign.dscTrustDir) return { chainVerified: false };
  const engine = new pkijs.CertificateChainValidationEngine({ trustedCerts: loadTrustedRoots(config.esign.dscTrustDir), certs: [cert, ...chain], checkDate: now });
  const result = await engine.verify();
  if (!result.result) throw badRequest(`The signing certificate is not issued by a trusted authority (${result.resultMessage}).`);
  return { chainVerified: true };
}

/**
 * Embeds verified signatures into each prepared document, makes the result the
 * new working copy, and marks the recipient as signed.
 */
export async function completeTransaction(
  txnId: string,
  signatures: Map<string, Buffer>,
  ctx: { ip?: string | null; userAgent?: string | null; espCertificate?: string | null },
): Promise<Recipient> {
  const txn = await prisma.esignTransaction.findUnique({ where: { id: txnId } });
  if (!txn) throw notFound('Signing transaction');
  if (txn.status !== 'PENDING') throw conflict('This signing transaction is no longer open.');
  const r = await prisma.recipient.findUniqueOrThrow({ where: { id: txn.recipientId } });
  const docs = txn.documents as unknown as PreparedDoc[];

  const results: { documentId: string; workingKey: string; cert: CertificateInfo; chainVerified: boolean }[] = [];
  for (const d of docs) {
    const cms = signatures.get(d.documentId);
    if (!cms) throw badRequest(`Missing signature for ${d.name}.`);
    const preparedPdf = await getObject(d.preparedKey);
    const prepared: PreparedSignature = {
      pdf: preparedPdf,
      contentsStart: d.contentsStart,
      contentsEnd: d.contentsEnd,
      signedContent: Buffer.concat([preparedPdf.subarray(0, d.contentsStart), preparedPdf.subarray(d.contentsEnd)]),
    };
    const { cert, chain, info } = await verifyCmsOver(cms, prepared.signedContent);
    const { chainVerified } = txn.provider === 'dsc' ? await checkDscCertificate(cert, chain) : { chainVerified: true };
    const signedPdf = embedCms(prepared, cms);
    const workingKey = `envelopes/${txn.envelopeId}/working/${d.documentId}-${Date.now()}.pdf`;
    await putObject(workingKey, signedPdf, 'application/pdf');
    results.push({ documentId: d.documentId, workingKey, cert: info, chainVerified });
  }

  const env = await prisma.envelope.findUniqueOrThrow({ where: { id: txn.envelopeId } });
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.esignTransaction.updateMany({ where: { id: txnId, status: 'PENDING' }, data: { status: 'COMPLETED', completedAt: new Date() } });
    if (claimed.count === 0) throw conflict('This signing transaction is no longer open.');
    for (const res of results) await tx.document.update({ where: { id: res.documentId }, data: { workingKey: res.workingKey } });
    await tx.recipient.update({
      where: { id: r.id },
      data: { status: 'SIGNED', signedAt: new Date(), signedIp: ctx.ip ?? null, signedUserAgent: ctx.userAgent ?? null },
    });
    await appendAudit(tx, {
      envelopeId: txn.envelopeId,
      type: 'recipient.signed',
      actor: { kind: 'recipient', id: r.id, name: r.name, email: r.email },
      data: {
        method: txn.provider,
        sandbox: txn.provider === 'aadhaar-esign' && config.esign.mode === 'sandbox',
        certificate: results[0].cert,
        chainVerified: results.every((x) => x.chainVerified),
        documents: results.map((x) => ({ documentId: x.documentId, certificateSha256: x.cert.sha256 })),
        transaction: txnId,
      },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    await enqueueWebhook(tx, env.orgId, 'recipient.signed', { envelopeId: txn.envelopeId, recipientId: r.id, email: r.email, method: txn.provider });
  });
  return r;
}

export async function failTransaction(txnId: string, error: string) {
  const txn = await prisma.esignTransaction.findUnique({ where: { id: txnId } });
  if (!txn || txn.status !== 'PENDING') return null;
  await prisma.esignTransaction.update({ where: { id: txnId }, data: { status: 'FAILED', error } });
  const r = await prisma.recipient.findUniqueOrThrow({ where: { id: txn.recipientId } });
  await prisma.$transaction((tx) =>
    appendAudit(tx, {
      envelopeId: txn.envelopeId,
      type: 'recipient.esign_failed',
      actor: { kind: 'recipient', id: r.id, name: r.name, email: r.email },
      data: { transaction: txnId, error },
    }),
  );
  return r;
}

export function espCertificatePem(): string {
  if (config.esign.mode === 'production') {
    if (!config.esign.espCertPath) throw new HttpError(503, 'ESIGN_ESP_CERT is not configured.', 'esign_unavailable');
    return readFileSync(config.esign.espCertPath, 'utf8');
  }
  return '';
}
