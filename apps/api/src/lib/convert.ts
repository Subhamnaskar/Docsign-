import { config } from '../config.js';
import { randomToken } from './crypto.js';
import { badRequest, HttpError } from './errors.js';

export const CONVERTIBLE_EXTENSIONS = [
  'doc', 'docx', 'odt', 'rtf', 'txt', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp', 'html',
];

/** Whether office documents can be turned into PDFs on this server (the apps offer them only then). */
export function conversionAvailable(): boolean {
  if (config.converter === 'google') return Boolean(config.google.clientId && config.google.clientSecret && config.google.refreshToken);
  return config.converter === 'gotenberg';
}

const unavailable = () => new HttpError(503, 'Word, Excel and PowerPoint files can\'t be converted right now. Upload a PDF instead.', 'conversion_unavailable');

/** Converts an office document to PDF with the configured converter. */
export async function convertToPdf(filename: string, data: Buffer): Promise<Buffer> {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (!CONVERTIBLE_EXTENSIONS.includes(ext)) {
    throw badRequest(`Unsupported file type .${ext}. Upload a PDF or an office document.`);
  }
  if (!conversionAvailable()) throw unavailable();
  return config.converter === 'google' ? convertWithGoogle(filename, ext, data) : convertWithGotenberg(filename, data);
}

/** Gotenberg (LibreOffice) */
async function convertWithGotenberg(filename: string, data: Buffer): Promise<Buffer> {
  const form = new FormData();
  form.append('files', new Blob([new Uint8Array(data)]), filename);
  let res: Response;
  try {
    res = await fetch(`${config.gotenbergUrl}/forms/libreoffice/convert`, { method: 'POST', body: form });
  } catch {
    throw unavailable();
  }
  if (!res.ok) {
    throw new HttpError(422, `Could not convert ${filename} to PDF`, 'conversion_failed');
  }
  return Buffer.from(await res.arrayBuffer());
}

// --- Google Drive ----------------------------------------------------------------
//
// The file is uploaded into the connected Google account as a Google Doc, Sheet or
// Slides file, exported as PDF and deleted straight away. The `drive.file` scope only
// reaches files this app created, never the rest of the account's Drive.

const GOOGLE_KIND: Record<string, 'document' | 'spreadsheet' | 'presentation'> = {
  doc: 'document', docx: 'document', odt: 'document', rtf: 'document', txt: 'document', html: 'document',
  xls: 'spreadsheet', xlsx: 'spreadsheet', ods: 'spreadsheet',
  ppt: 'presentation', pptx: 'presentation', odp: 'presentation',
};

const SOURCE_MIME: Record<string, string> = {
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf',
  txt: 'text/plain',
  html: 'text/html',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odp: 'application/vnd.oasis.opendocument.presentation',
};

let accessToken: { value: string; expiresAt: number } | null = null;

async function googleAccessToken(): Promise<string> {
  if (accessToken && accessToken.expiresAt > Date.now() + 60_000) return accessToken.value;
  let res: Response;
  try {
    res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        refresh_token: config.google.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
  } catch {
    throw unavailable();
  }
  if (!res.ok) {
    console.error('Google token refresh failed', res.status, await res.text().catch(() => ''));
    throw unavailable();
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  accessToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return accessToken.value;
}

async function convertWithGoogle(filename: string, ext: string, data: Buffer): Promise<Buffer> {
  const token = await googleAccessToken();
  const auth = { Authorization: `Bearer ${token}` };
  const failed = () => new HttpError(422, `Could not convert ${filename} to PDF`, 'conversion_failed');

  // One multipart/related request: the file's metadata (as a Google file type) and its bytes
  const boundary = `nuronix-${randomToken().slice(0, 16)}`;
  const metadata = JSON.stringify({ name: `Nuronix eSign conversion ${Date.now()}`, mimeType: `application/vnd.google-apps.${GOOGLE_KIND[ext]}` });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${SOURCE_MIME[ext]}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const upload = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!upload.ok) {
    console.error('Google upload failed', upload.status, await upload.text().catch(() => ''));
    throw upload.status === 401 || upload.status === 403 ? unavailable() : failed();
  }
  const { id } = (await upload.json()) as { id: string };
  try {
    const pdf = await fetch(`https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=application/pdf`, { headers: auth });
    if (!pdf.ok) {
      console.error('Google export failed', pdf.status, await pdf.text().catch(() => ''));
      throw failed();
    }
    return Buffer.from(await pdf.arrayBuffer());
  } finally {
    // Nothing stays in the Google account
    await fetch(`https://www.googleapis.com/drive/v3/files/${id}`, { method: 'DELETE', headers: auth }).catch(() => {});
  }
}

/** For tests: forget the cached Google access token. */
export const forgetGoogleToken = () => {
  accessToken = null;
};
