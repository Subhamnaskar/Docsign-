import type { Field } from '@prisma/client';
import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';

const INK = rgb(0.06, 0.09, 0.35);

/** Pick the largest font size (up to `max`) at which `text` fits in the box. */
function fitText(font: PDFFont, text: string, boxW: number, boxH: number, max = 14): number {
  let size = Math.min(max, boxH * 0.75);
  while (size > 5 && font.widthOfTextAtSize(text, size) > boxW - 4) size -= 0.5;
  return size;
}

/** WinAnsi (standard fonts) can't encode every character; replace the rest. */
const winAnsiSafe = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

/**
 * Converts a field box (fractions of the page as displayed, top-left origin)
 * into PDF user-space coordinates, accounting for /Rotate.
 */
function boxToPdf(page: PDFPage, f: Pick<Field, 'x' | 'y' | 'width' | 'height'>) {
  const { width: W, height: H } = page.getSize();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  // Displayed page dimensions
  const dW = rot % 180 === 0 ? W : H;
  const dH = rot % 180 === 0 ? H : W;
  const left = f.x * dW;
  const top = f.y * dH;
  const w = f.width * dW;
  const h = f.height * dH;
  // Bottom-left corner of the box in displayed coordinates (origin bottom-left)
  const bx = left;
  const by = dH - top - h;
  switch (rot) {
    case 90:
      return { x: W - by, y: bx, w, h, rotate: 90 };
    case 180:
      return { x: W - bx, y: H - by, w, h, rotate: 180 };
    case 270:
      return { x: by, y: H - bx, w, h, rotate: 270 };
    default:
      return { x: bx, y: by, w, h, rotate: 0 };
  }
}

export interface RenderOptions {
  envelopeId: string;
  /** Map of recipientId → signed timestamp, for DATE_SIGNED fields. */
  signedAt: Map<string, Date>;
}

/** Burns completed field values into the PDF and stamps the envelope ID on every page. */
export async function renderCompletedPdf(
  original: Buffer,
  fields: Field[],
  opts: RenderOptions,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(original);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();

  for (const f of fields) {
    const page = pages[f.page];
    if (!page) continue;
    const box = boxToPdf(page, f);
    const rotate = degrees(box.rotate);
    let value = f.value;
    if (f.type === 'DATE_SIGNED') {
      const at = opts.signedAt.get(f.recipientId);
      value = at ? at.toISOString().slice(0, 10) : value;
    }
    if (!value) continue;

    if (f.type === 'SIGNATURE' || f.type === 'INITIALS') {
      const png = Buffer.from(value.replace(/^data:image\/png;base64,/, ''), 'base64');
      const img = await doc.embedPng(png);
      const scale = Math.min(box.w / img.width, box.h / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      // Centre vertically, left-align horizontally (only exact for unrotated pages)
      const dy = box.rotate === 0 ? (box.h - h) / 2 : 0;
      page.drawImage(img, { x: box.x, y: box.y + dy, width: w, height: h, rotate });
    } else if (f.type === 'CHECKBOX') {
      if (value === 'true') {
        const size = Math.min(box.w, box.h) * 0.9;
        page.drawText('X', { x: box.x + size * 0.2, y: box.y + size * 0.15, size, font, color: INK, rotate });
      }
    } else {
      const text = winAnsiSafe(value);
      const size = fitText(font, text, box.w, box.h);
      page.drawText(text, { x: box.x + 2, y: box.y + (box.h - size) / 2 + size * 0.2, size, font, color: INK, rotate });
    }
  }

  const stamp = `DocSign Envelope ID: ${opts.envelopeId}`;
  for (const page of pages) {
    // Rotated pages are left unstamped rather than stamped sideways
    if (page.getRotation().angle % 360 !== 0) continue;
    page.drawText(stamp, { x: 12, y: page.getSize().height - 10, size: 6, font, color: rgb(0.45, 0.45, 0.5) });
  }

  return doc.save({ useObjectStreams: false });
}
