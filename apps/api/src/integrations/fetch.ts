import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { badRequest } from '../lib/errors.js';

/**
 * Fetches a user-supplied URL without letting it reach internal services
 * (SSRF). Only https is allowed, and the address check happens inside the
 * socket's DNS lookup, so DNS rebinding between "check" and "connect" can't
 * slip a private address through. Redirects are followed manually and each hop
 * is checked again.
 */

function isPrivate(ip: string): boolean {
  if (ip.startsWith('::ffff:')) return isPrivate(ip.slice(7));
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') || v6.startsWith('ff');
}

function safeLookup(hostname: string, options: object, cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
    if (err) return cb(err, []);
    const blocked = addresses.find((a) => isPrivate(a.address));
    if (blocked) return cb(Object.assign(new Error('Blocked private address'), { code: 'EPRIVATE' }), []);
    if ((options as { all?: boolean }).all) return cb(null, addresses);
    cb(null, addresses[0].address, addresses[0].family);
  });
}

/** Turns common share links into direct-download links. */
export function directDownloadUrl(input: string): URL {
  const url = new URL(input);
  const drive = /^\/file\/d\/([\w-]+)/.exec(url.pathname);
  if (url.hostname === 'drive.google.com' && drive) return new URL(`https://drive.google.com/uc?export=download&id=${drive[1]}`);
  if (url.hostname === 'docs.google.com') {
    const doc = /^\/(document|spreadsheets|presentation)\/d\/([\w-]+)/.exec(url.pathname);
    if (doc) return new URL(`https://docs.google.com/${doc[1]}/d/${doc[2]}/export?format=${doc[1] === 'document' ? 'docx' : doc[1] === 'spreadsheets' ? 'xlsx' : 'pptx'}`);
  }
  if (url.hostname.endsWith('dropbox.com')) {
    url.searchParams.set('dl', '1');
    return url;
  }
  if (url.hostname === 'onedrive.live.com' && url.pathname === '/redir') {
    url.pathname = '/download';
    return url;
  }
  if (url.hostname.endsWith('sharepoint.com') && !url.searchParams.has('download')) url.searchParams.set('download', '1');
  return url;
}

export interface Fetched {
  data: Buffer;
  filename: string;
  contentType: string;
}

function filenameFrom(disposition: string | undefined, url: URL): string {
  const star = disposition && /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (star) return decodeURIComponent(star[1]);
  const plain = disposition && /filename="?([^";]+)"?/i.exec(disposition);
  if (plain) return plain[1];
  const last = decodeURIComponent(url.pathname.split('/').pop() || 'document');
  return /\.\w{2,5}$/.test(last) ? last : `${last}.pdf`;
}

export async function fetchExternalFile(input: string, maxBytes: number): Promise<Fetched> {
  let url = directDownloadUrl(input);
  for (let hop = 0; hop < 5; hop++) {
    if (url.protocol !== 'https:') throw badRequest('Only https links can be imported.');
    if (isIP(url.hostname) && isPrivate(url.hostname)) throw badRequest('That address is not allowed.');
    const res = await new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body?: Buffer }>((resolve, reject) => {
      const req = request(url, { method: 'GET', lookup: safeLookup as never, timeout: 20_000, headers: { 'User-Agent': 'DocSign-Import/1.0' } }, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, headers: res.headers });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            req.destroy();
            reject(badRequest('The file is larger than 25 MB.'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error('Timed out')));
      req.on('error', (err: NodeJS.ErrnoException) =>
        reject(err.code === 'EPRIVATE' ? badRequest('That address is not allowed.') : badRequest(`Could not download the file (${err.message}).`)),
      );
      req.end();
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.location;
      if (typeof location !== 'string') throw badRequest('The link redirected without a destination.');
      url = new URL(location, url);
      continue;
    }
    if (res.status !== 200 || !res.body) throw badRequest(`The link returned HTTP ${res.status}. Make sure it is shared publicly or "anyone with the link".`);
    const contentType = String(res.headers['content-type'] ?? '');
    if (contentType.includes('text/html')) throw badRequest('The link opens a web page, not a file. Use a direct download or public share link.');
    return { data: res.body, filename: filenameFrom(res.headers['content-disposition'] as string | undefined, url), contentType };
  }
  throw badRequest('Too many redirects.');
}
