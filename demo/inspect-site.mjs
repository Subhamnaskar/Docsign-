// Screenshot a website and print its main colours and fonts (for matching a theme).
//   node inspect-site.mjs https://example.com [outDir]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const url = process.argv[2];
const out = process.argv[3] ?? 'site';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: process.env.BROWSER ?? 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {});
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/top.png` });
const height = await page.evaluate(() => document.documentElement.scrollHeight);
for (let y = 900, i = 2; y < Math.min(height, 900 * 8); y += 900, i++) {
  await page.evaluate((y) => window.scrollTo(0, y), y);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/part${i}.png` });
}

const report = await page.evaluate(() => {
  const count = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
  const bg = new Map(), fg = new Map(), fonts = new Map(), borders = new Map(), gradients = new Set();
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    if (s.backgroundColor !== 'rgba(0, 0, 0, 0)') count(bg, s.backgroundColor);
    if (s.backgroundImage.includes('gradient')) gradients.add(s.backgroundImage.slice(0, 200));
    count(fg, s.color);
    count(fonts, s.fontFamily.split(',')[0]);
    if (s.borderTopWidth !== '0px' && s.borderTopStyle !== 'none') count(borders, s.borderTopColor);
  }
  const top = (m, n = 10) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
  const b = getComputedStyle(document.body);
  const vars = [...document.styleSheets].flatMap((sh) => {
    try {
      return [...sh.cssRules].filter((r) => r.selectorText === ':root').map((r) => r.cssText.slice(0, 1500));
    } catch {
      return [];
    }
  });
  return {
    title: document.title,
    body: { bg: b.backgroundColor, color: b.color, font: b.fontFamily },
    backgrounds: top(bg),
    text: top(fg),
    fonts: top(fonts, 6),
    borders: top(borders, 6),
    gradients: [...gradients].slice(0, 8),
    rootVars: vars,
    headings: [...document.querySelectorAll('h1,h2')].slice(0, 8).map((h) => h.textContent.trim().slice(0, 80)),
  };
});
console.log(JSON.stringify(report, null, 2));
await browser.close();
