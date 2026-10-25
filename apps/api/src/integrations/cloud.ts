import { config } from '../config.js';
import { badRequest, HttpError } from '../lib/errors.js';
import { fetchExternalFile, type Fetched } from './fetch.js';

/**
 * Files picked with the providers' own pickers in the browser (Google Picker,
 * Dropbox Chooser, OneDrive file picker). The browser hands us either a
 * short-lived download link or, for Google, a file id plus the user's
 * drive.file-scoped access token; the server never stores either.
 */

export const cloudConfig = () => ({
  google: config.cloud.googleClientId && config.cloud.googleApiKey ? { clientId: config.cloud.googleClientId, apiKey: config.cloud.googleApiKey, appId: config.cloud.googleAppId } : null,
  dropbox: config.cloud.dropboxAppKey ? { appKey: config.cloud.dropboxAppKey } : null,
  onedrive: config.cloud.onedriveClientId ? { clientId: config.cloud.onedriveClientId } : null,
});

/** Download links each picker can return. Anything else is refused. */
const LINK_HOSTS: Record<'dropbox' | 'onedrive', RegExp[]> = {
  dropbox: [/^dl\.dropboxusercontent\.com$/, /^(www\.)?dropbox\.com$/],
  onedrive: [/\.sharepoint\.com$/, /(^|\.)1drv\.com$/, /\.livefilestore\.com$/, /(^|\.)onedrive\.live\.com$/, /^graph\.microsoft\.com$/],
};

export async function fetchFromLink(provider: 'dropbox' | 'onedrive', link: string, name: string | undefined, maxBytes: number): Promise<Fetched> {
  let host: string;
  try {
    host = new URL(link).hostname.toLowerCase();
  } catch {
    throw badRequest('That is not a valid link.');
  }
  if (!LINK_HOSTS[provider].some((re) => re.test(host))) throw badRequest(`That link is not a ${provider === 'dropbox' ? 'Dropbox' : 'OneDrive'} download link.`);
  const file = await fetchExternalFile(link, maxBytes);
  return name ? { ...file, filename: name } : file;
}

const GOOGLE_EXPORT: Record<string, { mime: string; ext: string }> = {
  'application/vnd.google-apps.document': { mime: 'application/pdf', ext: 'pdf' },
  'application/vnd.google-apps.spreadsheet': { mime: 'application/pdf', ext: 'pdf' },
  'application/vnd.google-apps.presentation': { mime: 'application/pdf', ext: 'pdf' },
  'application/vnd.google-apps.drawing': { mime: 'application/pdf', ext: 'pdf' },
};

/** Downloads a Drive file with the picker's access token; Google Docs/Sheets/Slides are exported as PDF. */
export async function fetchFromGoogleDrive(fileId: string, accessToken: string, maxBytes: number): Promise<Fetched> {
  if (!/^[\w-]{10,200}$/.test(fileId)) throw badRequest('Invalid Google Drive file id.');
  const api = 'https://www.googleapis.com/drive/v3/files';
  const auth = { Authorization: `Bearer ${accessToken}` };
  const metaRes = await fetch(`${api}/${fileId}?fields=name,mimeType,size&supportsAllDrives=true`, { headers: auth, signal: AbortSignal.timeout(15_000) });
  if (metaRes.status === 401 || metaRes.status === 403) throw new HttpError(403, 'Google Drive refused access to that file. Pick it again.', 'cloud_forbidden');
  if (!metaRes.ok) throw badRequest('Could not read that file from Google Drive.');
  const meta = (await metaRes.json()) as { name: string; mimeType: string; size?: string };
  if (meta.size && Number(meta.size) > maxBytes) throw badRequest(`That file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);

  const exported = GOOGLE_EXPORT[meta.mimeType];
  if (meta.mimeType.startsWith('application/vnd.google-apps.') && !exported) throw badRequest('That kind of Google file cannot be imported. Choose a document, sheet, slide deck or a regular file.');
  const url = exported ? `${api}/${fileId}/export?mimeType=${encodeURIComponent(exported.mime)}` : `${api}/${fileId}?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, { headers: auth, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw badRequest('Could not download that file from Google Drive.');
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > maxBytes) throw badRequest(`That file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  const filename = exported && !meta.name.toLowerCase().endsWith(`.${exported.ext}`) ? `${meta.name}.${exported.ext}` : meta.name;
  return { filename, data, contentType: exported?.mime ?? meta.mimeType };
}
