import pino from 'pino';
import { loadPlanSettings } from './billing/plans.js';
import { prisma } from './db.js';
import { ensureBucket } from './lib/storage.js';
import { sealKeyProvider } from './trust/keys.js';
import { startWorker } from './worker.js';

/** Standalone background worker: webhooks, reminders, expiry, sealing retries. */
const log = pino({ name: 'worker' });

await ensureBucket();
sealKeyProvider();
await loadPlanSettings();
setInterval(() => loadPlanSettings().catch((err) => log.error({ err }, 'plan settings refresh failed')), 60_000).unref();
const stop = startWorker(log);
log.info('worker started');

const shutdown = async () => {
  stop();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
