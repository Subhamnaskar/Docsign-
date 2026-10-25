import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { SignPdf } from '@signpdf/signpdf';
import { SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils';
import { PDFDocument } from 'pdf-lib';
import { config } from '../config.js';
import { CadesSigner, type TimestampResult } from './cades.js';
import { addSignatureField, embedCms, incrementalUpdate, prepareByteRange, type SignatureFieldOptions } from './incremental.js';
import { sealKeyProvider } from './keys.js';
import { addLtv, type LtvResult } from './ltv.js';

export type SealFormat = 'PAdES-B-B' | 'PAdES-B-T' | 'PAdES-B-LT' | 'PAdES-B-LTA';

export interface SealResult {
  pdf: Buffer;
  format: SealFormat;
  timestamp: TimestampResult;
  keyProvider: string;
  ltv: Omit<LtvResult, 'pdf'>;
}

/**
 * Adds long-term validation data after the seal. The baseline levels build on
 * each other, so B-LT/B-LTA are only claimed on top of a timestamped (B-T) seal.
 */
async function finish(sealed: Buffer, timestamp: TimestampResult, keyProvider: string): Promise<SealResult> {
  const { pdf, ...ltv } = await addLtv(sealed);
  const format: SealFormat = !timestamp.timestamped ? 'PAdES-B-B' : (ltv.level ?? 'PAdES-B-T');
  return { pdf, format, timestamp, keyProvider, ltv };
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
  return finish(pdf, signer.lastTimestamp, keys.id);
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
  return finish(pdf, signer.lastTimestamp, keys.id);
}
