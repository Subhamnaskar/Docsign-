// Renders the app icons (apps/web/public/icons) from the logo mark.
//   node make-icons.mjs
import { chromium } from 'playwright-core';

const OUT = new URL('../apps/web/public/icons/', import.meta.url);
const mark = (maskable) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d4a24e"/><stop offset="1" stop-color="#b8860b"/></linearGradient></defs>
  <rect width="32" height="32" rx="${maskable ? 0 : 7}" fill="url(#g)"/>
  <g transform="${maskable ? 'translate(16 16) scale(.72) translate(-16 -16)' : ''}">
    <path d="M8 21c3-1 4.5-9 7-9s1 7 3 7 2.5-4 6-4" stroke="#14110b" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;

const browser = await chromium.launch({ channel: process.env.BROWSER ?? 'msedge' });
const page = await browser.newPage();
const jobs = [16, 32, 64, 80, 128, 180, 192, 512].map((s) => [s, `icon-${s}.png`, false]).concat([[512, 'maskable-512.png', true]]);
for (const [size, name, maskable] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${mark(maskable)}`);
  await page.screenshot({ path: new URL(name, OUT).pathname.replace(/^\/([A-Za-z]:)/, '$1'), omitBackground: true });
  console.log('wrote', name);
}
await browser.close();
