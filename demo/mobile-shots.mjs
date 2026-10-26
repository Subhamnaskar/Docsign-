// Screenshots of the mobile app running in a browser at phone size (expo start --web).
//   node mobile-shots.mjs <outDir> <email> <password>
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [out = 'mobile-shots', email, password] = process.argv.slice(2);
const APP = process.env.APP ?? 'http://localhost:8081';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: process.env.BROWSER ?? 'msedge' });

async function phone(colorScheme) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme });
  const page = await ctx.newPage();
  page.setDefaultTimeout(180_000);
  page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text().slice(0, 200)));
  return page;
}

// Tab screens stay mounted when hidden, so pick the visible match
const visible = (page, text) => page.getByText(text, { exact: true }).filter({ visible: true }).first();

const shot = async (page, name) => {
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', name);
};

async function signIn(page) {
  await page.goto(APP);
  await page.getByText('Sign in', { exact: true }).waitFor();
  const inputs = page.locator('input');
  await inputs.nth(0).fill(email);
  await inputs.nth(1).fill(password);
}

const page = await phone('light');
await signIn(page);
await shot(page, '01-sign-in');
await page.getByText('Sign in', { exact: true }).click();
await page.getByText('Hi, Priya').waitFor();
await shot(page, '02-home');

await page.getByRole('tab', { name: /To sign/ }).click();
await page.getByText('Freelance design contract').waitFor();
await shot(page, '03-to-sign');

await page.getByRole('tab', { name: /Agreements/ }).click();
await page.getByText('Office lease – Bengaluru').waitFor();
await shot(page, '04-agreements');

await visible(page, 'Office lease – Bengaluru').click();
await visible(page, 'Send a reminder').waitFor();
await shot(page, '05-agreement-waiting');
await page.goBack();
await page.waitForTimeout(1200);
await page.getByRole('tab', { name: /Agreements/ }).click();

// Home's activity also names it (a hidden tab underneath); the list comes later in the page
await page.getByText('Joining letter', { exact: true }).last().click();
await visible(page, 'Share certificate of completion').waitFor();
await shot(page, '06-agreement-completed');
await page.goBack();
await page.waitForTimeout(1200);

await page.getByRole('tab', { name: /Home/ }).click();
await visible(page, 'Send for signature').click();
await visible(page, 'Who signs').waitFor();
await shot(page, '07-new-agreement');
await page.goBack();
await page.waitForTimeout(1200);

await page.getByRole('tab', { name: /Settings/ }).click();
await visible(page, 'Lock with Face ID / fingerprint').waitFor();
await shot(page, '08-settings');

const dark = await phone('dark');
await dark.goto(APP);
await dark.getByText('Hi, Priya').waitFor().catch(async () => {
  await signIn(dark);
  await dark.getByText('Sign in', { exact: true }).click();
  await dark.getByText('Hi, Priya').waitFor();
});
await shot(dark, '09-home-dark');

await browser.close();
