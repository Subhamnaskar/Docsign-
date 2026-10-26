import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { ensureBucket } from './lib/storage.js';
import { sealKeyProvider } from './trust/keys.js';

export { setBackgroundRunner } from './lib/background.js';

/**
 * The API inside a serverless function (Vercel): no port, no always-running
 * worker. One app instance per warm function; requests are handed to
 * Fastify's request handler. Background jobs run via /api/v1/internal/tick.
 */
let ready: Promise<FastifyInstance> | null = null;

function app() {
  ready ??= (async () => {
    await ensureBucket();
    sealKeyProvider();
    const instance = await buildApp({ logger: { level: 'info' } });
    await instance.ready();
    return instance;
  })().catch((err) => {
    ready = null; // retry on the next request
    throw err;
  });
  return ready;
}

export async function handle(req: IncomingMessage, res: ServerResponse) {
  const instance = await app();
  await new Promise<void>((resolve) => {
    res.on('finish', resolve);
    res.on('close', resolve);
    instance.server.emit('request', req, res);
  });
}
