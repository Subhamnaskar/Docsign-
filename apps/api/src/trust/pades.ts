import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { SignPdf } from '@signpdf/signpdf';
import { SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils';
import { PDFDocument } from 'pdf-lib';
import { config } from '../config.js';
import { CadesSigner, type TimestampResult } from './cades.js';
import { addSignatureField, embedCms, incrementalUpdate, prepareByteRange, type SignatureFieldOptions } from './incremental.js';
import { sealKeyProvider } from './keys.js';

export interface SealResult {
  pdf: Buffer;
  format: 'PAdES-B-T' | 'PAdES-B-B';
  timestamp: TimestampResult;
  keyProvider: string;
}

/**
 * Applies the platform electronic seal as a PAdES signature covering the whole
 * document. Any later change to the file invalidates it.
 */
export async function sealPdf(
  input: Buffer | Uint8Array,
  opts: { reason: string; location?: string },
): Promise<SealResult> {
  const pdfDoc = await PDFDocument.load(input);
  pdflibAddPlaceholder({
    pdfDoc,
    reason: opts.reason,
    contactInfo: config.appUrl,
    name: 'DocSign Platform Seal',
    location: opts.location ?? `DocSign cell: ${config.cellRegion}`,
    // Room for the certificate chain plus a TSA token with its own chain
    signatureLength: 24_000,
    subFilter: SUBFILTER_ETSI_CADES_DETACHED,
  });
  const withPlaceholder = Buffer.from(await pdfDoc.save({ useObjectStreams: false }));

  const keys = sealKeyProvider();
  const signer = new CadesSigner(keys, config.tsaUrl);
  const pdf = await new SignPdf().sign(withPlaceholder, signer);
  return {
    pdf,
    format: signer.lastTimestamp.timestamped ? 'PAdES-B-T' : 'PAdES-B-B',
    timestamp: signer.lastTimestamp,
    keyProvider: keys.id,
  };
}

/**
 * Appends a signature as an incremental update, keeping every earlier
 * signature valid. `sign` receives the exact bytes covered and returns a CMS.
 */
export async function signIncremental(
  pdf: Buffer,
  field: SignatureFieldOptions,
  sign: (signedContent: Buffer) => Promise<Buffer>,
): Promise<Buffer> {
  const withPlaceholder = await incrementalUpdate(pdf, (doc) => addSignatureField(doc, field));
  const prepared = prepareByteRange(withPlaceholder);
  return embedCms(prepared, await sign(prepared.signedContent));
}

/** Platform seal applied incrementally, for documents that already carry signer signatures. */
export async function sealPdfIncremental(input: Buffer, opts: { reason: string }): Promise<SealResult> {
  const keys = sealKeyProvider();
  const signer = new CadesSigner(keys, config.tsaUrl);
  const pdf = await signIncremental(
    input,
    { fieldName: `DocSign Seal ${Date.now()}`, reason: opts.reason, name: 'DocSign Platform Seal', contactInfo: config.appUrl, location: `DocSign cell: ${config.cellRegion}` },
    (content) => signer.sign(content),
  );
  return { pdf, format: signer.lastTimestamp.timestamped ? 'PAdES-B-T' : 'PAdES-B-B', timestamp: signer.lastTimestamp, keyProvider: keys.id };
}
