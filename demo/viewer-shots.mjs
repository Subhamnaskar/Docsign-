// The document viewer: signs a 3-page document yourself, then opens it on a
// computer, on a phone browser and inside the mobile app's web view.
//   node viewer-shots.mjs <outDir> <email> <password>
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { chromium } from 'playwright-core';

const [out = 'viewer-shots', email, password] = process.argv.slice(2);
const WEB = process.env.WEB ?? 'http://localhost:3000';
mkdirSync(out, { recursive: true });

async function threePages() {
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  ['Rental agreement', 'Terms and conditions', 'Signatures'].forEach((title, i) => {
    const page = doc.addPage([595, 842]);
    page.drawText(title.toUpperCase(), { x: 60, y: 770, size: 18, font: bold });
    for (let l = 0; l < 22; l++) page.drawText(`${i + 1}.${l + 1}  The tenant and the landlord agree to the terms set out in this clause.`, { x: 60, y: 720 - l * 24, size: 10, font });
  });
  return Buffer.from(await doc.save());
}

const { PNG } = createRequire(import.meta.url)('pngjs');
const png = new PNG({ width: 120, height: 40 });
for (let x = 0; x < 120; x++) png.data[((Math.round(20 + 12 * Math.sin(x / 9)) * 120 + x) * 4) + 3] = 255;
const signature = `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;

const browser = await chromium.launch({ channel: process.env.BROWSER ?? 'msedge' });
const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await desk.newPage();
page.setDefaultTimeout(240_000);
const api = async (method, path, body, multipart) => {
  const res = await page.request.fetch(`${WEB}/api/v1${path}`, { method, ...(multipart ? { multipart } : body ? { data: body } : {}) });
  if (!res.ok()) throw new Error(`${method} ${path} -> ${res.status()} ${await res.text()}`);
  return res.status() === 204 ? null : res.json();
};

await api('POST', '/auth/login', { email, password });
const env = await api('POST', '/self-sign', { title: 'Rental agreement – Koramangala' });
const doc = await api('POST', `/envelopes/${env.id}/documents`, null, { file: { name: 'Rental agreement.pdf', mimeType: 'application/pdf', buffer: await threePages() } });
await api('PUT', `/envelopes/${env.id}/fields`, [{ documentId: doc.id, recipientId: env.recipients[0].id, type: 'SIGNATURE', page: 2, x: 0.1, y: 0.8, width: 0.35, height: 0.06 }]);
const { signPath } = await api('POST', `/self-sign/${env.id}/start`);
const token = signPath.split('/').pop();
const session = await api('GET', `/signing/${token}`);
await api('POST', `/signing/${token}/complete`, { consent: true, values: Object.fromEntries(session.fields.map((f) => [f.id, signature])) });
for (let i = 0; i < 60 && (await api('GET', `/envelopes/${env.id}`)).status !== 'COMPLETED'; i++) await page.waitForTimeout(500);

const viewer = `/envelopes/${env.id}/view?doc=${doc.id}&version=signed`;
const settle = async (p) => {
  await p.locator('canvas').filter({ visible: true }).first().waitFor();
  await p.waitForTimeout(3000);
};

// Computer: thumbnails, zoom, signed/original
await page.goto(`${WEB}${viewer}`);
await settle(page);
await page.screenshot({ path: `${out}/1-computer.png` });
await page.getByRole('button', { name: 'Zoom in' }).click();
await page.getByRole('button', { name: 'Page 3' }).click();
await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/2-computer-zoom-page3.png` });
console.log('page indicator:', await page.getByText(/Page \d of 3/).textContent());

// The agreement page links to the viewer
await page.goto(`${WEB}/envelopes/${env.id}`);
await page.getByRole('link', { name: 'Signed PDF' }).click();
await page.waitForURL(/\/view\?/);
console.log('agreement page link opens:', new URL(page.url()).pathname);

// Phone browser
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: await desk.storageState() });
const pp = await phone.newPage();
pp.setDefaultTimeout(240_000);
await pp.goto(`${WEB}${viewer}`);
await settle(pp);
await pp.screenshot({ path: `${out}/3-phone-browser.png` });

// Inside the mobile app: token sign-in, then the one-time link
const app = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const ap = await app.newPage();
ap.setDefaultTimeout(240_000);
const { token: appToken } = await (await ap.request.post(`${WEB}/api/v1/mobile/login`, { data: { email, password, platform: 'ios' } })).json();
const { path } = await (await ap.request.post(`${WEB}/api/v1/mobile/web-session`, { data: { next: viewer }, headers: { 'x-session-token': appToken } })).json();
await ap.goto(`${WEB}${path}`);
await settle(ap);
await ap.screenshot({ path: `${out}/4-in-app.png` });
console.log('in app, download button shown:', await ap.getByRole('link', { name: 'Download' }).count());
await browser.close();
