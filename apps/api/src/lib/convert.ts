import { config } from '../config.js';
import { badRequest, HttpError } from './errors.js';

export const CONVERTIBLE_EXTENSIONS = [
  'doc', 'docx', 'odt', 'rtf', 'txt', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp', 'html',
];

/** Converts an office document to PDF via Gotenberg (LibreOffice). */
export async function convertToPdf(filename: string, data: Buffer): Promise<Buffer> {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (!CONVERTIBLE_EXTENSIONS.includes(ext)) {
    throw badRequest(`Unsupported file type .${ext}. Upload a PDF or an office document.`);
  }
  const form = new FormData();
  form.append('files', new Blob([new Uint8Array(data)]), filename);
  let res: Response;
  try {
    res = await fetch(`${config.gotenbergUrl}/forms/libreoffice/convert`, { method: 'POST', body: form });
  } catch {
    throw new HttpError(503, 'Document conversion service is unavailable. Upload a PDF instead.', 'conversion_unavailable');
  }
  if (!res.ok) {
    throw new HttpError(422, `Could not convert ${filename} to PDF`, 'conversion_failed');
  }
  return Buffer.from(await res.arrayBuffer());
}
