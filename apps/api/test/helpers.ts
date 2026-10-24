import type { FastifyInstance } from 'fastify';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import pngjs from 'pngjs';
import { buildApp } from '../src/app.js';
import { ensureBucket } from '../src/lib/storage.js';

import type { Mail } from '../src/lib/mailer.js';

let app: FastifyInstance | undefined;

export const outbox = () => (globalThis as unknown as { __outbox: Mail[] }).__outbox;

/** Most recent email to `to` whose subject matches. */
export function lastMail(to: string, subject: RegExp): Mail {
  const m = [...outbox()].reverse().find((x) => x.to === to && subject.test(x.subject));
  if (!m) throw new Error(`No email to ${to} matching ${subject}`);
  return m;
}

export async function getApp() {
  if (!app) {
    await ensureBucket();
    app = await buildApp({ logger: false });
  }
  return app;
}

export const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export async function makePdf(text = 'Test agreement', pages = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]).drawText(`${text} - page ${i + 1}`, { x: 72, y: 720, size: 14, font });
  return Buffer.from(await doc.save());
}

/** A small, valid signature image as a PNG data URL. */
export function signaturePng(): string {
  const png = new pngjs.PNG({ width: 60, height: 20 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i + 3] = (i / 4) % 7 === 0 ? 255 : 0;
  }
  return `data:image/png;base64,${pngjs.PNG.sync.write(png).toString('base64')}`;
}

export function multipart(filename: string, data: Buffer, contentType = 'application/octet-stream') {
  const boundary = `----docsign${uid()}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, data, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

/** Minimal cookie-jar client over app.inject. */
export function client(app: FastifyInstance) {
  const jar: Record<string, string> = {};
  const call = async (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    opts: { json?: unknown; payload?: Buffer; headers?: Record<string, string> } = {},
  ) => {
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers: {
        ...(opts.json !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(Object.keys(jar).length ? { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...opts.headers,
      },
      payload: opts.json !== undefined ? JSON.stringify(opts.json) : opts.payload,
    });
    for (const c of res.cookies) jar[c.name] = c.value;
    return res;
  };
  return {
    call,
    async json<T = any>(method: Parameters<typeof call>[0], url: string, opts?: Parameters<typeof call>[2], expected = [200, 201]) {
      const res = await call(method, url, opts);
      if (!expected.includes(res.statusCode)) throw new Error(`${method} ${url} -> ${res.statusCode}: ${res.body}`);
      return res.json() as T;
    },
  };
}

export async function registerSender(app: FastifyInstance, jurisdiction = 'US') {
  const c = client(app);
  const email = `sender-${uid()}@acme.test`;
  await c.json('POST', '/auth/register', {
    json: { name: 'Sam Sender', email, password: 'correct-horse-battery', organizationName: 'Acme', jurisdiction },
  });
  return { c, email };
}

export async function waitFor<T>(fn: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 30_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (done(v)) return v;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 250));
  }
}
