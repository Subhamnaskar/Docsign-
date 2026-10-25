// Headed walkthrough of DocSign: a visible Edge window goes through the main
// journey with captions: website → register → confirm email → prepare an
// agreement → send → sign as the recipient → verify the sealed PDF.
//
// Needs the app running (npm run dev) and Mailpit on :8025.
//   cd demo && npm install && npm run walkthrough
// Options: SLOW=600 (ms between actions), APP=http://localhost:3000, BROWSER=chrome|msedge
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { chromium } from 'playwright-core';

const APP = process.env.APP ?? 'http://localhost:3000';
const MAIL = process.env.MAIL ?? 'http://localhost:8025';
const SLOW = Number(process.env.SLOW ?? 450);
const stamp = Date.now();
const sender = { name: 'Asha Mehta', email: `asha.${stamp}@acme.test`, password: 'correct-horse-battery', org: 'Acme Lending' };
const signer = { name: 'Ravi Kumar', email: `ravi.${stamp}@example.test` };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** A one-page sample agreement to upload. */
async function sampleAgreement() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('EQUIPMENT LEASE AGREEMENT', { x: 60, y: 770, size: 18, font: bold });
  const lines = [
    'This agreement is made between Acme Lending Pvt Ltd ("Lessor") and the Lessee named below.',
    '1. The Lessor leases to the Lessee one industrial printer for a term of 12 months.',
    '2. Rent of INR 25,000 is payable monthly in advance.',
    '3. The Lessee will keep the equipment insured and in good working order.',
    '4. This agreement is governed by the laws of India.',
  ];
  lines.forEach((l, i) => page.drawText(l, { x: 60, y: 730 - i * 22, size: 10.5, font }));
  page.drawText('Lessee signature:', { x: 60, y: 420, size: 11, font: bold });
  page.drawLine({ start: { x: 60, y: 360 }, end: { x: 300, y: 360 }, thickness: 0.6, color: rgb(0.5, 0.5, 0.5) });
  page.drawText('Date:', { x: 340, y: 420, size: 11, font: bold });
  return Buffer.from(await doc.save());
}

/** Latest email to `to` whose subject matches, from Mailpit. */
async function mail(to, subject) {
  for (let i = 0; i < 60; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json();
    const m = list.messages?.find((x) => subject.test(x.Subject));
    if (m) return (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json();
    await pause(500);
  }
  throw new Error(`No email to ${to} matching ${subject}`);
}

/** Caption bar at the top of the page explaining the current step. */
async function caption(page, step, text) {
  console.log(`[${step}] ${text}`);
  await page
    .evaluate(
      ([step, text]) => {
        let bar = document.getElementById('__demo_caption');
        if (!bar) {
          bar = document.createElement('div');
          bar.id = '__demo_caption';
          bar.style.cssText =
            'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;max-width:760px;width:calc(100% - 48px);' +
            'background:rgba(17,24,39,.92);color:#fff;font:15px/1.45 system-ui,sans-serif;padding:14px 18px;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.25);pointer-events:none';
          document.body.appendChild(bar);
        }
        bar.innerHTML = `<div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#a5b4fc;margin-bottom:2px">Step ${step}</div>${text}`;
      },
      [step, text],
    )
    .catch(() => {});
  await pause(SLOW * 4);
}

async function main() {
  const browser = await chromium.launch({ channel: process.env.BROWSER ?? 'msedge', headless: false, slowMo: SLOW, args: ['--start-maximized'] });
  const senderCtx = await browser.newContext({ viewport: null });
  const page = await senderCtx.newPage();
  page.setDefaultTimeout(60_000);

  // 1. Website
  await page.goto(APP);
  await caption(page, 1, 'This is the public website: product, compliance, pricing, help centre and developer pages.');
  await page.mouse.wheel(0, 900);
  await pause(SLOW * 3);

  // 2. Register
  await page.goto(`${APP}/register`);
  await caption(page, 2, 'A new customer creates an account. Every account starts with a 14-day free trial.');
  await page.getByLabel('Your name').fill(sender.name);
  await page.getByLabel('Work email').fill(sender.email);
  await page.getByLabel(/Password/).fill(sender.password);
  await page.getByLabel('Organization').fill(sender.org);
  await page.getByLabel(/jurisdiction/i).selectOption('IN').catch(() => {});
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/dashboard');
  await caption(page, 2, 'The dashboard. The blue banner asks to confirm the email address before sending.');

  // 3. Confirm email (the link arrives in Mailpit)
  const confirm = await mail(sender.email, /Confirm your email/);
  const verifyLink = confirm.Text.match(/https?:\/\/\S+\/verify-email\/[\w-]+/)[0];
  await caption(page, 3, 'The confirmation email arrived (local inbox: Mailpit). Opening its link.');
  await page.goto(verifyLink);
  await page.getByText('Email confirmed').waitFor();
  await pause(SLOW * 3);
  await page.goto(`${APP}/dashboard`);
  await caption(page, 3, 'Confirmed. The getting-started checklist tracks the first steps.');

  // 4. New agreement: document
  await page.getByRole('button', { name: /New agreement/ }).click();
  await page.waitForURL('**/edit');
  await caption(page, 4, 'Step 1 of the editor: add documents. PDF and Office files are accepted, or import from Google Drive, Dropbox or OneDrive.');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'equipment-lease.pdf', mimeType: 'application/pdf', buffer: await sampleAgreement() });
  await page.getByText('equipment-lease.pdf').waitFor();
  const title = page.getByLabel('Agreement title');
  await title.fill('Equipment lease - Ravi Kumar');
  await title.blur();
  await caption(page, 4, 'Uploaded, scanned for malware and fingerprinted (SHA-256). The compliance profile on the right shows what Indian law needs.');
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  // 5. Recipients
  await caption(page, 5, 'Step 2: who signs. Each signer can get their own language and identity check (email, SMS, WhatsApp code or PAN/Aadhaar checks).');
  if ((await page.getByPlaceholder('Full name').count()) === 0) await page.getByRole('button', { name: '+ Add recipient' }).click();
  await page.getByPlaceholder('Full name').first().fill(signer.name);
  await page.getByPlaceholder('name@example.com').first().fill(signer.email);
  await pause(SLOW * 2);
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  // 6. Fields
  await caption(page, 6, 'Step 3: place fields. Choose a field type, then click on the page where the signer should fill it in.');
  const surface = page.locator('[data-page-surface]').first();
  await surface.waitFor();
  const box = await surface.boundingBox();
  await page.getByRole('button', { name: /^Signature$/ }).click();
  await surface.click({ position: { x: box.width * 0.2, y: box.height * 0.53 } });
  await page.getByRole('button', { name: /^Date signed$/ }).click();
  await surface.click({ position: { x: box.width * 0.62, y: box.height * 0.5 } });
  await caption(page, 6, 'A signature field and a date field for Ravi. Fields can be dragged, resized, made optional or conditional.');
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  // 7. Review and send
  await caption(page, 7, 'Step 4: review everything, then send. Signers receive a personal link by email.');
  await page.getByRole('button', { name: 'Send for signature' }).click();
  await page.waitForURL(/\/envelopes\/[^/]+(\?sent=1)?$/);
  const envelopeUrl = page.url().replace(/\?.*$/, '');
  await caption(page, 7, 'Sent. The agreement page shows recipients, documents, comments and the tamper-evident audit trail.');
  await page.mouse.wheel(0, 700);
  await pause(SLOW * 3);

  // 8. The signer opens their email
  const inbox = await senderCtx.newPage();
  await inbox.goto(MAIL);
  await caption(inbox, 8, 'Ravi’s inbox (Mailpit stands in for real email): the "Please sign" email with his personal link.');
  await inbox.close();
  const invite = await mail(signer.email, /Please sign/);
  const signLink = invite.Text.match(/https?:\/\/\S+\/sign\/[\w.-]+/)[0];

  const signerCtx = await browser.newContext({ viewport: null });
  const s = await signerCtx.newPage();
  s.setDefaultTimeout(60_000);
  await s.goto(signLink);
  await caption(s, 9, 'Ravi opens the link. First he proves it is him with a one-time code.');
  await s.getByRole('button', { name: 'Email me a code' }).click();
  const codeMail = await mail(signer.email, /\d{6}/);
  const code = codeMail.Subject.match(/\d{6}/)[0];
  await s.getByLabel('Verification code').fill(code);
  await s.getByRole('button', { name: 'Verify and continue' }).click();

  await caption(s, 10, 'He agrees to sign electronically. The disclosure wording follows Indian law (IT Act 2000).');
  await s.getByLabel('I agree to use electronic records and signatures.').check();
  await s.getByRole('button', { name: 'Continue' }).click();

  await caption(s, 11, 'The document with his fields. "Next field" jumps to each one; the date fills itself.');
  await s.getByRole('button', { name: /Next field/ }).first().click();
  await s.locator('button[id^=field-]').first().click();
  await caption(s, 11, 'He can type, draw or upload a signature. Typing his name is enough here.');
  await s.getByRole('button', { name: 'Adopt and sign' }).click();
  await s.getByRole('button', { name: 'Finish signing' }).first().click();
  await s.getByText(/signed|complete/i).first().waitFor();
  await caption(s, 12, 'Done. Everyone gets the sealed PDF and a certificate of completion by email.');
  await signerCtx.close();

  // 9. Back to the sender: completed, then verify the sealed PDF
  await page.goto(envelopeUrl);
  for (let i = 0; i < 30 && !(await page.getByText('Completed').first().isVisible()); i++) {
    await pause(1000);
    await page.reload();
  }
  await caption(page, 13, 'Asha sees the agreement as completed, with the signed PDF and the certificate of completion ready to download.');
  const env = await (await page.request.get(`${APP}/api/v1/envelopes/${envelopeUrl.split('/').pop()}`)).json();
  const signed = await (await page.request.get(`${APP}/api/v1/envelopes/${env.id}/documents/${env.documents[0].id}/file`)).body();

  await page.goto(`${APP}/verify`);
  await caption(page, 14, 'Anyone who receives the PDF can check it on the public verification page.');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'equipment-lease-signed.pdf', mimeType: 'application/pdf', buffer: signed });
  await page.getByText(/Authentic and unaltered|Known document|Not recognised/).first().waitFor();
  await caption(page, 14, 'Authentic and unaltered: the digital seal, the long-term validation data and the audit trail all check out.');
  await page.mouse.wheel(0, 600);
  await pause(SLOW * 6);

  await caption(page, 15, 'End of the walkthrough. Close this window when you are done; it closes by itself in 60 seconds.');
  await pause(60_000);
  await browser.close();
}

main().catch(async (err) => {
  console.error('Walkthrough stopped:', err.message);
  process.exitCode = 1;
});
