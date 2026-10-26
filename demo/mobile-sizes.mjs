// The main app screens at several phone and tablet sizes (expo start --web).
//   node mobile-sizes.mjs <outDir> <email> <password>
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [out = 'mobile-sizes', email, password] = process.argv.slice(2);
const APP = process.env.APP ?? 'http://localhost:8081';
mkdirSync(out, { recursive: true });

const SIZES = [
  { name: 'android-small', width: 360, height: 640 },
  { name: 'iphone-se', width: 375, height: 667 },
  { name: 'iphone', width: 390, height: 844 },
  { name: 'iphone-pro-max', width: 430, height: 932 },
  { name: 'ipad-portrait', width: 820, height: 1180 },
  { name: 'ipad-landscape', width: 1180, height: 820 },
];

const browser = await chromium.launch({ channel: process.env.BROWSER ?? 'msedge' });
// Tab screens stay mounted when hidden, so pick the visible match
const visible = (page, text) => page.getByText(text, { exact: true }).filter({ visible: true }).first();

for (const size of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, isMobile: size.width < 700, hasTouch: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(180_000);
  const shot = async (screen) => {
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/${size.name}-${screen}.png` });
  };

  await page.goto(APP);
  await page.getByText('Sign in', { exact: true }).waitFor();
  await page.locator('input').nth(0).fill(email);
  await page.locator('input').nth(1).fill(password);
  await shot('sign-in');
  await page.getByText('Sign in', { exact: true }).click();
  await page.getByText('Hi, Priya').waitFor();
  await shot('home');

  await page.getByRole('tab', { name: /Agreements/ }).click();
  await visible(page, 'Office lease – Bengaluru').waitFor();
  await shot('agreements');
  await visible(page, 'Office lease – Bengaluru').click();
  await visible(page, 'Send a reminder').waitFor();
  await shot('agreement');
  await page.goBack();
  await page.waitForTimeout(1200);

  await page.getByRole('tab', { name: /Home/ }).click();
  await visible(page, 'Send for signature').click();
  await visible(page, 'Who signs').waitFor();
  await shot('new');
  console.log('done', size.name);
  await ctx.close();
}
await browser.close();
