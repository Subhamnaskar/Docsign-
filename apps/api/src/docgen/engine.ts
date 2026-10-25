import Docxtemplater, { type DXT } from 'docxtemplater';
import PizZip from 'pizzip';
import { badRequest } from '../lib/errors.js';

/**
 * Word templates with {{placeholders}}. Loops ({{#items}}…{{/items}}) and
 * conditions work as in docxtemplater; plain placeholders cover most uses.
 */

const OPTIONS = { paragraphLoop: true, linebreaks: true, delimiters: { start: '{{', end: '}}' }, nullGetter: () => '', errorLogging: false };

/** Readable messages for template syntax errors ("Unclosed tag {{Name"). */
function templateError(err: unknown): Error {
  const e = err as { properties?: { errors?: { properties?: { explanation?: string } }[]; explanation?: string } };
  const details = e.properties?.errors?.map((x) => x.properties?.explanation).filter(Boolean) ?? [];
  const msg = details.length ? details.slice(0, 5).join('; ') : (e.properties?.explanation ?? 'The file is not a valid Word template.');
  return badRequest(`Template problem: ${msg}`);
}

function load(docx: Buffer, extra: Partial<DXT.Options> = {}) {
  let zip: PizZip;
  try {
    zip = new PizZip(docx);
  } catch {
    throw badRequest('Upload a Word document (.docx).');
  }
  try {
    return new Docxtemplater(zip, { ...OPTIONS, ...extra });
  } catch (err) {
    throw templateError(err);
  }
}

/** Placeholder names in order of first appearance, found by a dry-run render that records each lookup. */
export function templateVariables(docx: Buffer): string[] {
  const seen = new Set<string>();
  const doc = load(docx, {
    parser: (tag: string) => ({
      get: () => {
        if (tag && tag !== '.') seen.add(tag.trim());
        return undefined;
      },
    }),
  });
  try {
    doc.render({});
  } catch (err) {
    throw templateError(err);
  }
  return [...seen];
}

/** Fills the template; missing values become empty text. */
export function fillTemplate(docx: Buffer, data: Record<string, unknown>): Buffer {
  const doc = load(docx);
  try {
    doc.render(data);
  } catch (err) {
    throw templateError(err);
  }
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}
