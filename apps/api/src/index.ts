import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { authRoutes } from './auth/routes.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { developerRoutes } from './developers/routes.js';
import { envelopeRoutes } from './envelopes/routes.js';
import { HttpError } from './lib/errors.js';
import { ensureBucket } from './lib/storage.js';
import { signingRoutes } from './signing/routes.js';
import { sealKeyProvider } from './trust/keys.js';
import { verifyRoutes } from './verify/routes.js';
import { startWorker } from './worker.js';

const app = Fastify({
  logger: { level: config.isProduction ? 'info' : 'debug', transport: undefined },
  trustProxy: true,
  bodyLimit: 2 * 1024 * 1024,
});

await app.register(cookie, { secret: config.appSecret });
await app.register(cors, { origin: config.corsOrigins, credentials: true });
await app.register(multipart);
await app.register(rateLimit, { global: false });

app.setErrorHandler((err, req, reply) => {
  if (err instanceof HttpError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
  }
  const status = (err as { statusCode?: number }).statusCode;
  if (status && status < 500) {
    return reply.code(status).send({ error: { code: 'request_error', message: (err as Error).message } });
  }
  req.log.error({ err }, 'unhandled error');
  return reply.code(500).send({ error: { code: 'internal', message: 'Something went wrong.' } });
});

app.get('/health', async () => {
  await prisma.$queryRaw`SELECT 1`;
  return { ok: true, cell: config.cellRegion };
});

await app.register(
  async (v1) => {
    await v1.register(authRoutes);
    await v1.register(signingRoutes);
    await v1.register(verifyRoutes);
    await v1.register(envelopeRoutes);
    await v1.register(developerRoutes);
  },
  { prefix: '/api/v1' },
);

await ensureBucket();
sealKeyProvider(); // generate dev seal keys on first boot rather than on first signature
const stopWorker = startWorker(app.log);

const shutdown = async () => {
  stopWorker();
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: '0.0.0.0' });
