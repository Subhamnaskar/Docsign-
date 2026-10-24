import { createHash } from 'node:crypto';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRef,
  PDFString,
  StandardFonts,
} from 'pdf-lib';

/**
 * Incremental PDF updates. pdf-lib can only rewrite whole files, which would
 * invalidate earlier signatures. Here we load the file, let the caller modify
 * it, and append only the objects that changed plus a new cross-reference
 * section pointing back at the previous one (ISO 32000-1 §7.5.6).
 *
 * The input must use a classic xref table; working copies are normalised to
 * that form once, before anyone signs.
 */

function serialize(obj: PDFObject): Buffer {
  const buf = new Uint8Array(obj.sizeInBytes());
  obj.copyBytesInto(buf, 0);
  return Buffer.from(buf);
}

const digest = (b: Buffer) => createHash('sha1').update(b).digest('hex');

function lastStartxref(pdf: Buffer): number {
  const tail = pdf.subarray(Math.max(0, pdf.length - 2048)).toString('latin1');
  const m = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail);
  if (!m) throw new Error('PDF has no startxref');
  return Number(m[1]);
}

export async function incrementalUpdate(original: Buffer, mutate: (doc: PDFDocument) => Promise<void>): Promise<Buffer> {
  if (/\/Type\s*\/XRef\b/.test(original.subarray(lastStartxref(original)).toString('latin1', 0, 200))) {
    throw new Error('Incremental updates need a classic xref table; normalise the PDF first.');
  }
  const doc = await PDFDocument.load(original, { updateMetadata: false });
  const before = new Map<string, string>();
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) before.set(ref.tag, digest(serialize(obj)));

  await mutate(doc);

  const changed: [PDFRef, Buffer][] = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    const bytes = serialize(obj);
    if (before.get(ref.tag) !== digest(bytes)) changed.push([ref, bytes]);
  }
  changed.sort((a, b) => a[0].objectNumber - b[0].objectNumber);

  const parts: Buffer[] = [original, Buffer.from('\n')];
  let offset = original.length + 1;
  const entries: { num: number; gen: number; offset: number }[] = [];
  for (const [ref, bytes] of changed) {
    const head = Buffer.from(`${ref.objectNumber} ${ref.generationNumber} obj\n`, 'latin1');
    const tail = Buffer.from('\nendobj\n', 'latin1');
    entries.push({ num: ref.objectNumber, gen: ref.generationNumber, offset });
    parts.push(head, bytes, tail);
    offset += head.length + bytes.length + tail.length;
  }

  // Cross-reference subsections of consecutive object numbers; each entry is exactly 20 bytes
  let xref = 'xref\n';
  for (let i = 0; i < entries.length; ) {
    let j = i;
    while (j + 1 < entries.length && entries[j + 1].num === entries[j].num + 1) j++;
    xref += `${entries[i].num} ${j - i + 1}\n`;
    for (let k = i; k <= j; k++) xref += `${String(entries[k].offset).padStart(10, '0')} ${String(entries[k].gen).padStart(5, '0')} n\r\n`;
    i = j + 1;
  }
  const t = doc.context.trailerInfo;
  const trailer = [
    `/Size ${doc.context.largestObjectNumber + 1}`,
    `/Root ${(t.Root as PDFRef).toString()}`,
    t.Info ? `/Info ${(t.Info as PDFObject).toString()}` : '',
    t.ID ? `/ID ${(t.ID as PDFObject).toString()}` : '',
    `/Prev ${lastStartxref(original)}`,
  ]
    .filter(Boolean)
    .join(' ');
  parts.push(Buffer.from(`${xref}trailer\n<< ${trailer} >>\nstartxref\n${offset}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parts);
}

/** Rewrites a PDF with a classic xref table so incremental updates can follow. Only before any signature. */
export async function normalizeForSigning(pdf: Buffer): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

// ---------------------------------------------------------------------------
// Signature fields
// ---------------------------------------------------------------------------

const BYTE_RANGE_PLACEHOLDER = '**********';
const BYTE_RANGE_PATTERN = /\/ByteRange\s*\[\s*0\s+\/\*{10}\s+\/\*{10}\s+\/\*{10}\s*\]/g;

export interface SignatureAppearance {
  /** Page index and box in PDF user space */
  page: number;
  rect: [number, number, number, number];
  lines: string[];
  /** Optional PNG (e.g. the signer's drawn signature) shown above the text */
  image?: Buffer;
}

export interface SignatureFieldOptions {
  fieldName: string;
  reason: string;
  name: string;
  location?: string;
  contactInfo?: string;
  /** Bytes reserved for the CMS signature (hex doubles this) */
  signatureLength?: number;
  /** Omit for an invisible signature (platform seal) */
  appearance?: SignatureAppearance;
}

/** Adds a signature field with an empty /Contents placeholder to `doc` (call inside incrementalUpdate). */
export async function addSignatureField(doc: PDFDocument, opts: SignatureFieldOptions) {
  const ctx = doc.context;
  const length = opts.signatureLength ?? 24_000;
  const sig = ctx.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'ETSI.CAdES.detached',
    ByteRange: [0, PDFName.of(BYTE_RANGE_PLACEHOLDER), PDFName.of(BYTE_RANGE_PLACEHOLDER), PDFName.of(BYTE_RANGE_PLACEHOLDER)],
    Contents: PDFHexString.of('0'.repeat(length * 2)),
    Reason: PDFString.of(opts.reason),
    Name: PDFString.of(opts.name),
    Location: PDFString.of(opts.location ?? ''),
    ContactInfo: PDFString.of(opts.contactInfo ?? ''),
    M: PDFString.fromDate(new Date()),
  });
  const sigRef = ctx.register(sig);

  const pageIndex = opts.appearance?.page ?? 0;
  const page = doc.getPage(pageIndex);
  const rect = opts.appearance?.rect ?? [0, 0, 0, 0];
  const widget = ctx.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    Rect: rect,
    V: sigRef,
    T: PDFString.of(opts.fieldName),
    // Print + Locked
    F: 132,
    P: page.ref,
  });
  if (opts.appearance) widget.set(PDFName.of('AP'), ctx.obj({ N: await appearanceStream(doc, opts.appearance) }));
  const widgetRef = ctx.register(widget);
  page.node.addAnnot(widgetRef);

  const catalog = doc.catalog;
  let acroForm = catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  if (!acroForm) {
    acroForm = ctx.obj({ Fields: [] });
    catalog.set(PDFName.of('AcroForm'), ctx.register(acroForm));
  }
  let fields = acroForm.lookupMaybe(PDFName.of('Fields'), PDFArray);
  if (!fields) {
    fields = ctx.obj([]);
    acroForm.set(PDFName.of('Fields'), fields);
  }
  fields.push(widgetRef);
  // SignaturesExist | AppendOnly: tells viewers to save incrementally
  acroForm.set(PDFName.of('SigFlags'), PDFNumber.of(3));
}

async function appearanceStream(doc: PDFDocument, a: SignatureAppearance): Promise<PDFRef> {
  const [x1, y1, x2, y2] = a.rect;
  const w = x2 - x1;
  const h = y2 - y1;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const resources: { Font: Record<string, PDFRef>; XObject?: Record<string, PDFRef> } = { Font: { F1: font.ref } };
  let ops = '';
  const textBlock = Math.min(h, a.lines.length * 7 + 4);
  if (a.image) {
    const img = await doc.embedPng(a.image);
    const avail = h - textBlock;
    const scale = Math.min(w / img.width, avail / img.height);
    if (scale > 0) {
      resources.XObject = { Im1: img.ref };
      ops += `q ${(img.width * scale).toFixed(2)} 0 0 ${(img.height * scale).toFixed(2)} 0 ${(textBlock + (avail - img.height * scale) / 2).toFixed(2)} cm /Im1 Do Q\n`;
    }
  }
  // Thin border so signed boxes are recognisable
  ops += `q 0.31 0.27 0.9 RG 0.6 w 0.3 0.3 ${(w - 0.6).toFixed(2)} ${(h - 0.6).toFixed(2)} re S Q\n`;
  // Without an image the text is larger and vertically centred in the box
  const size = a.image ? 6 : Math.max(6, Math.min(9, (h - 6) / (a.lines.length * 1.3)));
  const lead = size * 1.25;
  const top = a.image ? textBlock : (h + a.lines.length * lead) / 2;
  a.lines.forEach((line, i) => {
    const encoded = font.encodeText(line.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')).toString();
    ops += `BT /F1 ${size.toFixed(2)} Tf 0.06 0.09 0.35 rg 4 ${(top - (i + 1) * lead + 2).toFixed(2)} Td ${encoded} Tj ET\n`;
  });
  const stream = doc.context.stream(ops, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, h], Resources: resources });
  return doc.context.register(stream);
}

// ---------------------------------------------------------------------------
// Byte ranges and CMS embedding
// ---------------------------------------------------------------------------

export interface PreparedSignature {
  pdf: Buffer;
  /** The bytes the signature covers (everything except the /Contents hex) */
  signedContent: Buffer;
  contentsStart: number;
  contentsEnd: number;
}

/** Fills in the last /ByteRange placeholder and returns the content to sign. */
export function prepareByteRange(pdf: Buffer): PreparedSignature {
  const text = pdf.toString('latin1');
  let match: RegExpExecArray | null = null;
  for (let m; (m = BYTE_RANGE_PATTERN.exec(text)); ) match = m;
  BYTE_RANGE_PATTERN.lastIndex = 0;
  if (!match) throw new Error('No signature placeholder found');
  const contentsStart = text.indexOf('/Contents <', match.index) + '/Contents '.length;
  const contentsEnd = text.indexOf('>', contentsStart) + 1;
  if (contentsStart < '/Contents '.length || contentsEnd <= contentsStart) throw new Error('Malformed signature placeholder');

  const range = `/ByteRange [0 ${contentsStart} ${contentsEnd} ${pdf.length - contentsEnd}]`;
  if (range.length > match[0].length) throw new Error('ByteRange does not fit its placeholder');
  const out = Buffer.from(pdf);
  out.write(range.padEnd(match[0].length, ' '), match.index, 'latin1');
  return {
    pdf: out,
    signedContent: Buffer.concat([out.subarray(0, contentsStart), out.subarray(contentsEnd)]),
    contentsStart,
    contentsEnd,
  };
}

/** Writes a DER CMS signature into the prepared placeholder. */
export function embedCms(prepared: PreparedSignature, cms: Buffer): Buffer {
  const hex = cms.toString('hex');
  const room = prepared.contentsEnd - prepared.contentsStart - 2;
  if (hex.length > room) throw new Error(`Signature is ${hex.length / 2} bytes; only ${room / 2} reserved`);
  const out = Buffer.from(prepared.pdf);
  out.write(hex.padEnd(room, '0'), prepared.contentsStart + 1, 'latin1');
  return out;
}

