import { PDFDocument } from 'pdf-lib';
import { convertToPdf } from '../lib/convert.js';
import { sha256Hex } from '../lib/crypto.js';
import { badRequest } from '../lib/errors.js';
import { assertClean } from '../lib/malware.js';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_PAGES = 200;

export interface IngestedDocument {
  pdf: Buffer;
  sha256: string;
  pageCount: number;
  pages: { width: number; height: number; rotation: number }[];
}

/** Normalises an upload into a PDF, fingerprints it and records page geometry. */
export async function ingestDocument(filename: string, data: Buffer): Promise<IngestedDocument> {
  await assertClean(filename, data);
  const isPdf = data.subarray(0, 5).toString('latin1') === '%PDF-';
  const pdf = isPdf ? data : await convertToPdf(filename, data);

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdf);
  } catch (err) {
    const msg = (err as Error).message;
    if (/encrypt/i.test(msg)) throw badRequest('Password-protected PDFs are not supported. Remove the password and upload again.');
    throw badRequest('The file is not a readable PDF.');
  }
  if (doc.getPageCount() === 0) throw badRequest('The document has no pages.');
  if (doc.getPageCount() > MAX_PAGES) throw badRequest(`Documents are limited to ${MAX_PAGES} pages.`);

  const pages = doc.getPages().map((p) => {
    const { width, height } = p.getSize();
    return { width, height, rotation: p.getRotation().angle };
  });
  return { pdf, sha256: sha256Hex(pdf), pageCount: pages.length, pages };
}
