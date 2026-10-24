// Serves the pdf.js worker from /public so it loads the same way in dev and production builds.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const src = join(dirname(require.resolve('pdfjs-dist/package.json')), 'build', 'pdf.worker.min.mjs');
const dest = join(here, '..', 'public', 'pdf.worker.min.mjs');
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
