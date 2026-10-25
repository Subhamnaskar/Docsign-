// Screenshots of the public website: home (desktop and phone), the Products
// menu open, and a solution page.
//   node site-shots.mjs [outDir]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const APP = process.env.APP ?? 'http://localhost:3000';
const out = process.argv[2] ?? 'site-shots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: process.env.BROWSER ?? 'msedge' });
const desk = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const settle = async (p) => {
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(1200);
};

await desk.goto(APP);
await settle(desk);
await desk.screenshot({ path: `${out}/home.png`, fullPage: true });
console.log('saved home');

await desk.evaluate(() => window.scrollTo(0, 0));
await desk.getByRole('button', { name: 'Products' }).click();
await desk.waitForTimeout(600);
await desk.screenshot({ path: `${out}/menu-products.png` });
console.log('saved menu-products');
await desk.getByRole('button', { name: 'Solutions' }).click();
await desk.waitForTimeout(600);
await desk.screenshot({ path: `${out}/menu-solutions.png` });
console.log('saved menu-solutions');

await desk.goto(`${APP}/solutions/banking`);
await settle(desk);
await desk.screenshot({ path: `${out}/solution-banking.png`, fullPage: true });
console.log('saved solution-banking');

await desk.goto(APP);
await settle(desk);
await desk.getByPlaceholder('name@company.com').fill('meera@kaveri-textiles.test');
await desk.getByRole('button', { name: 'Get started' }).click();
await desk.waitForURL('**/register?email=*');
await settle(desk);
console.log('register email prefilled:', await desk.getByLabel('Work email').inputValue());

const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await phone.goto(APP);
await settle(phone);
await phone.screenshot({ path: `${out}/home-mobile.png` });
await phone.getByRole('button', { name: 'Menu' }).click();
await phone.getByRole('button', { name: 'Products' }).click();
await phone.waitForTimeout(500);
await phone.screenshot({ path: `${out}/menu-mobile.png` });
console.log('saved mobile');
await browser.close();
