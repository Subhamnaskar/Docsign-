// "Sign it yourself" end to end, as a new joiner without an account: email
// code, upload a joining letter, sign, download the signed PDF and send it
// back to HR. Headed by default so you can watch; HEADLESS=1 to hide it.
//   node selfsign.mjs [outDir]
import { mkdirSync } from 'node:fs';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { chromium } from 'playwright-core';

const APP = process.env.APP ?? 'http://localhost:3000';
const MAIL = process.env.MAIL ?? 'http://localhost:8025';
const out = process.argv[2] ?? 'selfsign-shots';
mkdirSync(out, { recursive: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// MAIL=mailtm: real disposable inboxes (mail.tm), for testing a live deployment
const MAILTM = 'https://api.mail.tm';
const inboxes = new Map();
async function mailtmInbox(name) {
  const { 'hydra:member': [{ domain }] } = await (await fetch(`${MAILTM}/domains`)).json();
  const address = `${name}.${Date.now()}@${domain}`;
  const password = `pw-${Date.now()}-${Math.random()}`;
  const body = JSON.stringify({ address, password });
  const headers = { 'Content-Type': 'application/json' };
  await fetch(`${MAILTM}/accounts`, { method: 'POST', headers, body });
  const { token } = await (await fetch(`${MAILTM}/token`, { method: 'POST', headers, body })).json();
  inboxes.set(address, token);
  return address;
}
const live = MAIL === 'mailtm';
const email = live ? await mailtmInbox('priya') : `priya.${Date.now()}@gmail.test`;
const hrEmail = live ? await mailtmInbox('hr') : 'hr@acme-hiring.test';

async function joiningLetter() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('JOINING LETTER', { x: 60, y: 770, size: 20, font: bold });
  ['Dear Priya Nair,', 'We are pleased to offer you the position of Product Designer at Acme Pvt Ltd,', 'starting 1 December 2026, with an annual CTC of INR 18,00,000.', 'Please sign below to confirm you accept this offer.'].forEach((l, i) =>
    page.drawText(l, { x: 60, y: 720 - i * 22, size: 11, font }),
  );
  page.drawText('Signature of employee:', { x: 60, y: 420, size: 11, font: bold });
  page.drawLine({ start: { x: 60, y: 360 }, end: { x: 300, y: 360 }, thickness: 0.6, color: rgb(0.5, 0.5, 0.5) });
  return Buffer.from(await doc.save());
}

async function mail(to, subject) {
  if (live) {
    const auth = { headers: { Authorization: `Bearer ${inboxes.get(to)}` } };
    for (let i = 0; i < 90; i++) {
      const list = await (await fetch(`${MAILTM}/messages`, auth)).json();
      const m = list['hydra:member']?.find((x) => subject.test(x.subject));
      if (m) {
        const full = await (await fetch(`${MAILTM}/messages/${m.id}`, auth)).json();
        return { Subject: full.subject, Attachments: (full.attachments ?? []).map((a) => ({ FileName: a.filename })) };
      }
      await pause(2000);
    }
    throw new Error(`No email to ${to} matching ${subject}`);
  }
  for (let i = 0; i < 60; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json();
    const m = list.messages?.find((x) => subject.test(x.Subject));
    if (m) return (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json();
    await pause(500);
  }
  throw new Error(`No email to ${to} matching ${subject}`);
}

console.log('signer:', email, '| HR:', hrEmail);
const browser = await chromium.launch({ channel: process.env.BROWSER ?? 'msedge', headless: Boolean(process.env.HEADLESS), slowMo: process.env.HEADLESS ? 0 : 250 });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(60_000);
if (process.env.DEBUG) {
  page.on('response', async (r) => r.status() >= 400 && console.log('HTTP', r.status(), r.request().method(), r.url(), (await r.text().catch(() => '')).slice(0, 300)));
  page.on('requestfailed', (r) => console.log('FAILED', r.url(), r.failure()?.errorText));
  page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text().slice(0, 300)));
}

if (process.env.ACCOUNT) {
  // 1. With an account (no email code needed): sign up, then sign it yourself
  const res = await page.request.post(`${APP}/api/v1/auth/register`, {
    data: { name: 'Priya Nair', email, password: `Test-${Date.now()}-pass`, organizationName: 'E2E Test', jurisdiction: 'IN' },
  });
  console.log('registered:', res.status());
  if (!res.ok()) throw new Error(await res.text());
  await page.goto(`${APP}/sign-yourself`);
} else {
  // 1. No account: name, email, code
  await page.goto(`${APP}/sign-yourself`);
  await page.getByLabel('Your full name').fill('Priya Nair');
  await page.getByLabel('Your email').fill(email);
  await page.screenshot({ path: `${out}/1-start.png` });
  await page.getByRole('button', { name: 'Email me a code' }).click();
  const code = (await mail(email, /signing code/)).Subject.match(/\d{6}/)[0];
  await page.getByLabel('Code').fill(code);
  await page.getByRole('button', { name: 'Continue' }).click();
}

// 2. Upload the joining letter and place the signature
await page.getByText('Drop your document here').waitFor();
await page.locator('input[type=file]').first().setInputFiles({ name: 'Joining letter.pdf', mimeType: 'application/pdf', buffer: await joiningLetter() });
const surface = page.locator('[data-page-surface]').first();
await surface.waitFor();
const box = await surface.boundingBox();
await page.getByRole('button', { name: /^Signature$/ }).click();
await surface.click({ position: { x: box.width * 0.2, y: box.height * 0.55 } });
await page.getByRole('button', { name: /^Date signed$/ }).click();
await surface.click({ position: { x: box.width * 0.62, y: box.height * 0.5 } });
await page.screenshot({ path: `${out}/2-place.png` });
await page.getByRole('button', { name: /Sign now/ }).click();

// 3. Sign
await page.waitForURL('**/sign/**');
const consent = page.getByLabel('I agree to use electronic records and signatures.');
const field = page.locator('button[id^=field-]').first();
// The consent screen appears once the session loads (skipped if already given)
await Promise.race([consent.waitFor(), field.waitFor()]);
if (await consent.isVisible()) {
  await page.screenshot({ path: `${out}/2b-consent.png` });
  await consent.check();
  await page.getByRole('button', { name: 'Continue' }).click();
}
await page.locator('button[id^=field-]').first().click();
await page.getByRole('button', { name: 'Adopt and sign' }).click();
await page.getByRole('button', { name: 'Finish signing' }).first().click();

// 4. Download the signed PDF and certificate
const downloadLink = page.getByRole('link', { name: /Download signed PDF/ });
await downloadLink.waitFor();
await page.screenshot({ path: `${out}/3-done.png`, fullPage: true });
const [pdf] = await Promise.all([page.waitForEvent('download'), downloadLink.click()]);
const pdfPath = `${out}/${pdf.suggestedFilename()}`;
await pdf.saveAs(pdfPath);
const { readFileSync } = await import('node:fs');
const bytes = readFileSync(pdfPath);
console.log('downloaded:', pdf.suggestedFilename(), `${bytes.length} bytes`, bytes.subarray(0, 5).toString(), bytes.includes(Buffer.from('/ByteRange')) ? 'digitally sealed' : 'NOT sealed');
const [cert] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: /Certificate of completion/ }).click()]);
console.log('certificate:', cert.suggestedFilename());

// 5. Send it back to HR
await page.getByLabel('Their email').fill(hrEmail);
await page.getByLabel('Message (optional)').fill('Hi, please find my signed joining letter attached. Regards, Priya');
await page.getByRole('button', { name: 'Send signed copy' }).click();
await page.getByText(`Sent to ${hrEmail}`, { exact: false }).waitFor();
await page.screenshot({ path: `${out}/4-sent.png`, fullPage: true });
console.log('send-back accepted by the app for', hrEmail);
if (!process.env.SKIP_HR_INBOX) {
  const hr = await mail(hrEmail, /Signed: Joining letter/);
  console.log('HR received:', hr.Subject, '| attachments:', hr.Attachments.map((a) => a.FileName).join(', '));
}
if (!process.env.HEADLESS) await pause(4000);
await browser.close();
