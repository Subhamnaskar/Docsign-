// Screenshots of plan editing: the Plans tab, the Manage buttons and a
// customer's custom limits. Uses the staff account from admin-shots.mjs.
//   node plans-shots.mjs [outDir]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const APP = process.env.APP ?? 'http://localhost:3000';
const STAFF = { email: process.env.ADMIN_EMAIL ?? 'admin@nuronixai.test', password: process.env.ADMIN_PASSWORD ?? 'nuronix-console-demo' };
const out = process.argv[2] ?? 'admin-shots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: process.env.BROWSER ?? 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60_000);
await ctx.request.post(`${APP}/api/v1/auth/login`, { data: STAFF });
const shot = async (name, full = true) => {
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
  console.log('saved', name);
};

await page.goto(`${APP}/admin?tab=customers`);
await page.getByRole('link', { name: 'Manage' }).first().waitFor();
await shot('customers-manage', false);

await page.goto(`${APP}/admin?tab=plans`);
await page.getByText('How plan changes apply').waitFor();
await shot('plans');

// Custom deal on the Kaveri Textiles demo customer
await page.goto(`${APP}/admin?tab=customers`);
await page.getByPlaceholder('Search organisation, owner or user email').fill('kaveri');
await page.waitForTimeout(1200);
await page.getByRole('link', { name: 'Manage' }).first().click();
await page.getByText('Custom limits').first().waitFor();
await page.getByLabel('Agreements per period (whole account)').selectOption('number');
await page.getByLabel('Agreements per period (whole account) number').fill('500');
await page.getByLabel('Users', { exact: true }).selectOption('number');
await page.getByLabel('Users number').fill('40');
await page.getByLabel(/Bulk send/).check().catch(() => {});
await page.getByLabel(/Deal note/).fill('Pilot until March: 40 users, 500 agreements');
await page.getByRole('button', { name: 'Save custom limits' }).click();
await page.getByText('Custom limits saved.').waitFor();
await page.getByText('Custom limits').first().scrollIntoViewIfNeeded();
await shot('custom-limits', false);
await browser.close();
