// Screenshots of the public website and a check of its interactive parts:
// signature card, feature tabs, code tabs, email start and the phone menu.
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

// Draw a signature, insert it and complete on the phone
const pad = desk.getByLabel('Draw your signature here');
const box = await pad.boundingBox();
await desk.mouse.move(box.x + 20, box.y + 60);
await desk.mouse.down();
for (const [dx, dy] of [[50, 20], [80, 70], [120, 30], [160, 65], [200, 40], [230, 55]]) await desk.mouse.move(box.x + dx, box.y + dy, { steps: 6 });
await desk.mouse.up();
await desk.getByRole('button', { name: 'Insert signature' }).click();
await desk.getByRole('button', { name: 'Sign & complete' }).click();
console.log('phone after signing:', await desk.getByRole('button', { name: /Signed/ }).textContent());
await desk.screenshot({ path: `${out}/hero-signed.png` });

await desk.getByRole('tab', { name: 'Type' }).click();
await desk.getByLabel('Type your name').fill('Meera Iyer');
await desk.getByRole('button', { name: 'Insert signature' }).click();
console.log('typed signature on phone:', await desk.locator('text=Meera Iyer').count() > 1);

// Feature tabs and code tabs
await desk.getByRole('tab', { name: 'Security' }).click();
console.log('security tab cards:', await desk.locator('[role=tabpanel] h3').allTextContents());
await desk.getByRole('tab', { name: 'Security' }).scrollIntoViewIfNeeded();
await desk.screenshot({ path: `${out}/features-security.png` });
await desk.getByRole('button', { name: 'Python', exact: true }).click();
console.log('python sample shown:', await desk.locator('pre code', { hasText: 'create_envelope' }).count() === 1);
await desk.getByRole('button', { name: 'Python', exact: true }).scrollIntoViewIfNeeded();
await desk.screenshot({ path: `${out}/integrate.png` });

await desk.goto(APP);
await settle(desk);
await desk.locator('#hero-email').fill('meera@kaveri-textiles.test');
await desk.getByRole('button', { name: /Get started free/ }).first().click();
await desk.waitForURL('**/register?email=*');
await settle(desk);
console.log('register email prefilled:', await desk.getByLabel('Work email').inputValue());

await desk.goto(`${APP}/solutions/banking`);
await settle(desk);
await desk.screenshot({ path: `${out}/solution-banking.png`, fullPage: true });

const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await phone.goto(APP);
await settle(phone);
await phone.screenshot({ path: `${out}/home-mobile.png`, fullPage: true });
console.log('saved mobile');
await browser.close();
