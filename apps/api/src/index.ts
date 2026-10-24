import { buildApp } from './app.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { ensureBucket } from './lib/storage.js';
import { sealKeyProvider } from './trust/keys.js';
import { startWorker } from './worker.js';

const app = await buildApp();

await ensureBucket();
sealKeyProvider(); // generate dev seal keys on first boot rather than on first signature

// In development the worker runs inside the API process for convenience.
// With more than one API replica, set WORKER_MODE=off and run `npm run worker` once.
const stopWorker = config.workerMode === 'inline' ? startWorker(app.log) : () => {};

const shutdown = async () => {
  stopWorker();
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: '0.0.0.0' });
