// Screenshots of the platform console. Needs the app running and PLATFORM_ADMINS
// containing ADMIN_EMAIL (default admin@nuronixai.test) in apps/api/.env.
//   node admin-shots.mjs [outDir]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const APP = process.env.APP ?? 'http://localhost:3000';
const MAIL = process.env.MAIL ?? 'http://localhost:8025';
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@nuronixai.test';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'nuronix-console-demo';
const out = process.argv[2] ?? 'admin-shots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: process.env.BROWSER ?? 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60_000);
const req = page.request;
const shot = async (name) => {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  console.log('saved', name);
};

// Staff account: sign in, or create and confirm it the first time
let login = await req.post(`${APP}/api/v1/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
if (login.status() === 401) {
  await req.post(`${APP}/api/v1/auth/register`, { data: { name: 'NuronixAI Ops', email: EMAIL, password: PASSWORD, organizationName: 'NuronixAI', jurisdiction: 'IN' } });
  for (let i = 0; i < 40; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${EMAIL}`)}`)).json();
    const m = list.messages?.find((x) => /Confirm your email/.test(x.Subject));
    if (m) {
      const msg = await (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json();
      const token = msg.Text.match(/\/verify-email\/([\w-]+)/)[1];
      await req.post(`${APP}/api/v1/auth/verify-email`, { data: { token } });
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  login = await req.post(`${APP}/api/v1/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
}
// A couple of failed attempts so the sign-in security panels have data
await browser.newContext().then(async (c) => {
  await c.request.post(`${APP}/api/v1/auth/login`, { data: { email: EMAIL, password: 'wrong-password-1' } });
  await c.request.post(`${APP}/api/v1/auth/login`, { data: { email: 'someone@unknown.test', password: 'guess-123456' } });
  await c.close();
});

await page.goto(`${APP}/admin`);
await page.getByText('Platform console').first().waitFor();
await shot('admin-overview');
await page.goto(`${APP}/admin?tab=customers`);
await page.getByText('Export CSV').waitFor();
await shot('admin-customers');
const first = page.locator('a[href^="/admin/orgs/"]').first();
const href = await first.getAttribute('href');
await page.goto(`${APP}/admin?tab=logins`);
await page.getByText('How people sign in').waitFor();
await shot('admin-logins');
await page.goto(APP + href);
await page.getByText('Support actions').waitFor();
await shot('admin-org');
await browser.close();
