import type { FastifyInstance } from 'fastify';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { conversionAvailable, convertToPdf, forgetGoogleToken } from '../src/lib/convert.js';
import { getApp, makePdf, multipart, registerSender } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await getApp();
});

const saved = { converter: config.converter, google: { ...config.google } };
afterEach(() => {
  config.converter = saved.converter;
  Object.assign(config.google, saved.google);
  forgetGoogleToken();
  vi.restoreAllMocks();
});

/** Stands in for Google: token, upload, export and delete, recording each call. */
function fakeGoogle(opts: { exportFails?: boolean } = {}) {
  config.converter = 'google';
  Object.assign(config.google, { clientId: 'client', clientSecret: 'secret', refreshToken: 'refresh' });
  const calls: { method: string; url: string; body?: string }[] = [];
  const real = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (!/googleapis\.com/.test(url)) return real(input, init);
    const method = init?.method ?? 'GET';
    const body = init?.body instanceof Buffer ? init.body.toString('latin1') : init?.body ? String(init.body) : undefined;
    calls.push({ method, url, body });
    if (url.startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'access', expires_in: 3600 });
    if (url.includes('/upload/drive/v3/files')) return Response.json({ id: `file-${calls.length}` });
    if (url.includes('/export')) return opts.exportFails ? new Response('nope', { status: 500 }) : new Response(new Uint8Array(await makePdf('Converted', 2)));
    if (method === 'DELETE') return new Response(null, { status: 204 });
    return new Response('unexpected', { status: 500 });
  });
  return calls;
}

describe('office documents to PDF', () => {
  it('converts through Google Drive and deletes the copy straight away', async () => {
    const calls = fakeGoogle();
    expect(conversionAvailable()).toBe(true);
    const pdf = await convertToPdf('Offer letter.docx', Buffer.from('word bytes'));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

    const upload = calls.find((c) => c.url.includes('/upload/'))!;
    expect(upload.body).toContain('"mimeType":"application/vnd.google-apps.document"');
    expect(upload.body).toContain('word bytes');
    expect(calls.map((c) => c.method)).toEqual(['POST', 'POST', 'GET', 'DELETE']);
    expect(calls[3].url).toMatch(/\/drive\/v3\/files\/file-2$/);

    // Spreadsheets become Sheets; the access token is reused
    await convertToPdf('Price list.xlsx', Buffer.from('excel bytes'));
    expect(calls.filter((c) => c.url.includes('/token'))).toHaveLength(1);
    expect(calls.at(-3)!.body).toContain('application/vnd.google-apps.spreadsheet');
  });

  it('still deletes the copy when the export fails', async () => {
    const calls = fakeGoogle({ exportFails: true });
    await expect(convertToPdf('Deck.pptx', Buffer.from('slides'))).rejects.toMatchObject({ statusCode: 422, code: 'conversion_failed' });
    expect(calls.at(-1)!.method).toBe('DELETE');
  });

  it('adds a converted Word file to an agreement', async () => {
    fakeGoogle();
    const { c } = await registerSender(app);
    const env = await c.json('POST', '/envelopes', { json: { title: 'Word upload' } });
    const { payload, headers } = multipart('Offer letter.docx', Buffer.from('word bytes'));
    const doc = await c.json('POST', `/envelopes/${env.id}/documents`, { payload, headers });
    expect(doc.pageCount).toBe(2);
    expect((await c.json('GET', '/auth/me')).features.officeFiles).toBe(true);
  });

  it('says so clearly when no converter is set up', async () => {
    config.converter = 'off';
    expect(conversionAvailable()).toBe(false);
    await expect(convertToPdf('a.docx', Buffer.from('x'))).rejects.toMatchObject({ statusCode: 503, code: 'conversion_unavailable' });
    const { c } = await registerSender(app);
    expect((await c.json('GET', '/auth/me')).features.officeFiles).toBe(false);
    // Google chosen but not connected yet counts as unavailable
    config.converter = 'google';
    Object.assign(config.google, { clientId: '', clientSecret: '', refreshToken: '' });
    expect(conversionAvailable()).toBe(false);
  });
});
