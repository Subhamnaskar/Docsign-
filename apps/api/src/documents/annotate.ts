import type { Field } from '@prisma/client';
import { PDFName, PDFString, StandardFonts, type PDFDocument, type PDFRef } from 'pdf-lib';
import { boxToPdf, fitText, winAnsiSafe } from './render.js';

/**
 * Writes field values as locked stamp annotations instead of page content.
 * Adding annotations after a signature is a permitted change, so earlier
 * signers' signatures stay valid in viewers like Adobe Acrobat.
 *
 * Known limitation: on rotated pages the text is drawn unrotated in the box.
 */
export async function addFieldAnnotations(
  doc: PDFDocument,
  fields: Field[],
  opts: { signedAt: Date; attachmentNames?: Map<string, string> },
): Promise<void> {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  for (const f of fields) {
    const page = pages[f.page];
    let value = f.type === 'DATE_SIGNED' ? opts.signedAt.toISOString().slice(0, 10) : f.value;
    if (!page || !value) continue;
    if (f.type === 'CHECKBOX') {
      if (value !== 'true') continue;
      value = 'X';
    }
    const box = boxToPdf(page, f);
    const rot = box.rotate;
    const [w, h] = rot % 180 === 0 ? [box.w, box.h] : [box.h, box.w];
    const rect: [number, number, number, number] =
      rot === 90 ? [box.x - box.h, box.y, box.x, box.y + box.w] : rot === 180 ? [box.x - box.w, box.y - box.h, box.x, box.y] : rot === 270 ? [box.x, box.y - box.w, box.x + box.h, box.y] : [box.x, box.y, box.x + box.w, box.y + box.h];

    const resources: { Font?: Record<string, PDFRef>; XObject?: Record<string, PDFRef> } = {};
    let ops: string;
    if (f.type === 'SIGNATURE' || f.type === 'INITIALS') {
      const img = await doc.embedPng(Buffer.from(value.replace(/^data:image\/png;base64,/, ''), 'base64'));
      const scale = Math.min(w / img.width, h / img.height);
      resources.XObject = { Im1: img.ref };
      ops = `q ${(img.width * scale).toFixed(2)} 0 0 ${(img.height * scale).toFixed(2)} 0 ${((h - img.height * scale) / 2).toFixed(2)} cm /Im1 Do Q`;
    } else {
      const shown = f.type === 'ATTACHMENT' ? `Attached: ${opts.attachmentNames?.get(value) ?? 'file'}` : value;
      const text = winAnsiSafe(shown);
      const size = fitText(font, text, w, h);
      resources.Font = { F1: font.ref };
      ops = `BT /F1 ${size.toFixed(2)} Tf 0.06 0.09 0.35 rg 2 ${((h - size) / 2 + size * 0.2).toFixed(2)} Td ${font.encodeText(text).toString()} Tj ET`;
    }
    const ap = doc.context.register(doc.context.stream(ops, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, h], Resources: resources }));
    const annot = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Stamp',
      Rect: rect,
      // Print + Locked + LockedContents
      F: 644,
      AP: { N: ap },
      NM: PDFString.of(`field-${f.id}`),
      Contents: PDFString.of(`${f.label ?? f.type}: ${f.type === 'SIGNATURE' || f.type === 'INITIALS' ? 'signed' : winAnsiSafe(value)}`),
    });
    annot.set(PDFName.of('P'), page.ref);
    page.node.addAnnot(doc.context.register(annot));
  }
}
