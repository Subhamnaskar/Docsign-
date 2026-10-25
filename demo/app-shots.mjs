// Screenshots of the signed-in app: Home, Agreements, Contacts, Workflows and
// the workflow builder. Signs in with the staff demo account from
// admin-shots.mjs and adds a little sample data first.
//   node app-shots.mjs [outDir]
import { mkdirSync } from 'node:fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { chromium } from 'playwright-core';

const APP = process.env.APP ?? 'http://localhost:3000';
const LOGIN = { email: process.env.ADMIN_EMAIL ?? 'admin@nuronixai.test', password: process.env.ADMIN_PASSWORD ?? 'nuronix-console-demo' };
const out = process.argv[2] ?? 'app-shots';
mkdirSync(out, { recursive: true });

async function pdf(title) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  page.drawText(title, { x: 60, y: 760, size: 18, font: await doc.embedFont(StandardFonts.HelveticaBold) });
  return Buffer.from(await doc.save());
}

const browser = await chromium.launch({ channel: process.env.BROWSER ?? 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const req = ctx.request;
const api = async (method, path, data) => {
  const res = await req.fetch(`${APP}/api/v1${path}`, { method, data });
  if (!res.ok()) throw new Error(`${method} ${path} -> ${res.status()} ${await res.text()}`);
  return res.json();
};
await api('POST', '/auth/login', LOGIN);

// Sample data: two contacts, a sent agreement, a folder and a workflow
for (const c of [
  { name: 'Ravi Kumar', email: 'ravi.kumar@kaveri-textiles.test', company: 'Kaveri Textiles', jobTitle: 'Procurement head', tags: ['supplier'] },
  { name: 'Ananya Rao', email: 'ananya@globex.test', company: 'Globex', tags: ['customer', 'vip'] },
]) {
  await req.post(`${APP}/api/v1/contacts`, { data: c });
}
const env = await api('POST', '/envelopes', { title: 'Mutual NDA with Globex', documentType: 'nda' });
const upload = await req.post(`${APP}/api/v1/envelopes/${env.id}/documents`, { multipart: { file: { name: 'nda.pdf', mimeType: 'application/pdf', buffer: await pdf('Mutual NDA') } } });
const doc = await upload.json();
const withSigner = await api('PUT', `/envelopes/${env.id}/recipients`, [{ name: 'Ananya Rao', email: 'ananya@globex.test' }]);
await api('PUT', `/envelopes/${env.id}/fields`, [{ documentId: doc.id, recipientId: withSigner.recipients[0].id, type: 'SIGNATURE', page: 0, x: 0.1, y: 0.6, width: 0.3, height: 0.06 }]);
await api('POST', `/envelopes/${env.id}/send`);
const folders = await api('GET', '/folders');
const folder = folders.find((f) => f.name === 'Signed NDAs') ?? (await api('POST', '/folders', { name: 'Signed NDAs' }));
const existing = (await api('GET', '/workflows')).workflows.find((w) => w.name === 'Email signed NDAs to legal');
if (!existing) {
  await api('POST', '/workflows', {
    name: 'Email signed NDAs to legal',
    trigger: 'envelope.completed',
    conditions: [{ field: 'documentType', op: 'equals', value: 'nda' }],
    actions: [
      { type: 'email_copy', to: ['legal@nuronixai.test'] },
      { type: 'move_to_folder', folderId: folder.id },
    ],
  });
}

const page = await ctx.newPage();
page.setDefaultTimeout(60_000);
const shot = async (name, path, waitText) => {
  await page.goto(APP + path);
  await page.getByText(waitText).first().waitFor();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  console.log('saved', name);
};
await shot('home', '/home', 'Needs your attention');
await shot('agreements', '/dashboard', 'Waiting for others');
await shot('contacts', '/contacts', 'Ravi Kumar');
await shot('workflows', '/workflows', 'Start from a recipe');
await shot('workflow-builder', '/workflows/new?recipe=nda-then-msa', 'How it works');

// Recipient suggestions in the agreement editor
await page.goto(`${APP}/home`);
await page.getByRole('button', { name: /New agreement/ }).click();
await page.waitForURL('**/edit');
await page.locator('input[type=file]').first().setInputFiles({ name: 'offer.pdf', mimeType: 'application/pdf', buffer: await pdf('Offer letter') });
await page.getByText('offer.pdf').waitFor();
await page.getByRole('button', { name: 'Next', exact: true }).click();
if ((await page.getByPlaceholder('Full name').count()) === 0) await page.getByRole('button', { name: '+ Add recipient' }).click();
await page.getByPlaceholder('Full name').first().fill('rav');
await page.getByRole('option').first().waitFor();
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/recipient-suggest.png` });
await page.getByRole('option').first().click();
console.log('picked contact:', await page.getByPlaceholder('name@example.com').first().inputValue());
await browser.close();
