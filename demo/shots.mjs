// Headless screenshots of the main screens, for UI review. Needs the app running.
//   node shots.mjs [outDir]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const APP = process.env.APP ?? 'http://localhost:3000';
const out = process.argv[2] ?? 'shots';
mkdirSync(out, { recursive: true });
const stamp = Date.now();

const browser = await chromium.launch({ channel: process.env.BROWSER ?? 'msedge' });
const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await desk.newPage();
page.setDefaultTimeout(60_000);
const shot = async (p, name, full = false) => {
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/${name}.png`, fullPage: full });
  console.log('saved', name);
};

for (const [path, name] of [['/', 'home'], ['/pricing', 'pricing'], ['/login', 'login'], ['/verify', 'verify']]) {
  await page.goto(APP + path);
  await shot(page, name, path === '/');
}

await page.goto(`${APP}/register`);
await page.getByLabel('Your name').fill('Asha Mehta');
await page.getByLabel('Work email').fill(`asha.${stamp}@acme.test`);
await page.getByLabel(/Password/).fill('correct-horse-battery');
await page.getByLabel('Organization').fill('Acme Lending');
await page.getByRole('button', { name: 'Create account' }).click();
await page.waitForURL('**/home');
await shot(page, 'dashboard');
await page.getByRole('button', { name: /New agreement/ }).click();
await page.waitForURL('**/edit');
await shot(page, 'builder');
await page.goto(`${APP}/settings`);
await shot(page, 'settings');

const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const m = await phone.newPage();
await m.goto(APP);
await shot(m, 'home-mobile');
await m.goto(`${APP}/login`);
await shot(m, 'login-mobile');

await browser.close();
