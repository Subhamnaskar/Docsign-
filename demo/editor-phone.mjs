// The website pages the mobile app opens (field editor, sign it yourself) at phone
// size, reached the way the app reaches them: token sign-in, then the one-time link.
//   node editor-phone.mjs <outDir> <email> <password>
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [out = 'editor-phone', email, password] = process.argv.slice(2);
const WEB = process.env.WEB ?? 'http://localhost:3000';
mkdirSync(out, { recursive: true });

const call = async (method, path, token, body) => {
  const res = await fetch(`${WEB}/api/v1${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { 'x-session-token': token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
};

const { token } = await call('POST', '/mobile/login', null, { email, password, platform: 'android' });
const draft = (await call('GET', '/envelopes?status=DRAFT', token)).data.find((e) => !e.title.startsWith('Document to sign'));

const browser = await chromium.launch({ channel: process.env.BROWSER ?? 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.setDefaultTimeout(240_000);

async function open(next, name, ready) {
  const { path } = await call('POST', '/mobile/web-session', token, { next });
  await page.goto(`${WEB}${path}`);
  await ready();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${name}.png` });
  const overflow = await page.evaluate(() => {
    let widest = 0;
    for (const el of document.querySelectorAll('main *')) widest = Math.max(widest, el.getBoundingClientRect().right);
    return Math.round(widest - window.innerWidth);
  });
  console.log(name, 'url', new URL(page.url()).pathname + new URL(page.url()).search, '| content past the right edge (px):', Math.max(0, overflow));
}

await open(`/envelopes/${draft.id}/edit?step=fields`, 'editor-fields', () => page.locator('[data-page-surface]').first().waitFor());
await open('/sign-yourself', 'sign-yourself', () => page.getByText('Sign a document yourself').first().waitFor());
await browser.close();
