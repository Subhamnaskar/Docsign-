// Screenshots of the console actions: a demo customer who grants support
// access and buys a plan, then the customer page, a support session and the
// Team tab. Run admin-shots.mjs first (it creates the staff account).
//   node admin-actions-shots.mjs [outDir]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const APP = process.env.APP ?? 'http://localhost:3000';
const MAIL = process.env.MAIL ?? 'http://localhost:8025';
const STAFF = { email: process.env.ADMIN_EMAIL ?? 'admin@nuronixai.test', password: process.env.ADMIN_PASSWORD ?? 'nuronix-console-demo' };
const out = process.argv[2] ?? 'admin-shots';
mkdirSync(out, { recursive: true });

async function confirmEmail(req, email) {
  for (let i = 0; i < 40; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
    const m = list.messages?.find((x) => /Confirm your email/.test(x.Subject));
    if (m) {
      const msg = await (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json();
      await req.post(`${APP}/api/v1/auth/verify-email`, { data: { token: msg.Text.match(/\/verify-email\/([\w-]+)/)[1] } });
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

const browser = await chromium.launch({ channel: process.env.BROWSER ?? 'msedge' });

// Demo customer: signs up, buys Starter in the sandbox, grants support access
const customer = await browser.newContext();
const creq = customer.request;
const email = `meera.${Date.now()}@kaveri-textiles.test`;
await creq.post(`${APP}/api/v1/auth/register`, { data: { name: 'Meera Iyer', email, password: 'demo-customer-pass', organizationName: 'Kaveri Textiles', jurisdiction: 'IN' } });
await confirmEmail(creq, email);
const { url } = await (await creq.post(`${APP}/api/v1/billing/checkout`, { data: { plan: 'starter', seats: 3, interval: 'month' } })).json();
const checkoutId = new URL(url).pathname.split('/').pop();
await creq.post(`${APP}/api/v1/dev/billing/${checkoutId}`, { form: { outcome: 'pay' }, maxRedirects: 0 });
await creq.post(`${APP}/api/v1/organization/support-access`, { data: { hours: 72 } });
const orgId = (await (await creq.get(`${APP}/api/v1/auth/me`)).json()).organization.id;
const cpage = await customer.newPage();
await cpage.setViewportSize({ width: 1280, height: 900 });
await cpage.goto(`${APP}/settings?tab=security`);
await cpage.getByText('NuronixAI support access').waitFor();
await cpage.getByText('NuronixAI support access').scrollIntoViewIfNeeded();
await cpage.waitForTimeout(800);
await cpage.screenshot({ path: `${out}/customer-support-access.png` });
console.log('saved customer-support-access');

// Staff
const staff = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await staff.newPage();
await staff.request.post(`${APP}/api/v1/auth/login`, { data: STAFF });
await page.goto(`${APP}/admin/orgs/${orgId}`);
await page.getByText('Support access').first().waitFor();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${out}/org-actions.png`, fullPage: true });
console.log('saved org-actions');

await page.getByRole('button', { name: 'Refund' }).first().click();
await page.getByLabel('Reason').fill('Charged for a seat they never used');
await page.getByLabel(/Amount/).fill('499');
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/refund-dialog.png` });
console.log('saved refund-dialog');
await page.getByRole('button', { name: 'Refund', exact: true }).last().click();
await page.getByText('Refund issued.').waitFor();

await page.getByRole('button', { name: 'View as customer' }).click();
await page.waitForURL('**/dashboard');
await page.getByText('Support session').first().waitFor();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${out}/support-session.png` });
console.log('saved support-session');
await page.getByRole('button', { name: 'End support session' }).click();
await page.waitForURL(`**/admin/orgs/${orgId}`);
await page.getByText('Console actions').waitFor();
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/org-after.png`, fullPage: true });
console.log('saved org-after');

await page.goto(`${APP}/admin?tab=team`);
await page.getByText('Console team').waitFor();
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/team.png` });
console.log('saved team');
await browser.close();
