import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { safeEqualHex, sha256Hex } from '../lib/crypto.js';
import { notFound, unauthorized } from '../lib/errors.js';
import { runJobs } from '../worker.js';

/**
 * Serverless hosts have no always-running worker: a scheduler (Vercel Cron or
 * cron-job.org) calls this every few minutes with `Authorization: Bearer
 * <CRON_SECRET>`. Hidden (404) unless CRON_SECRET is set.
 */
export async function internalRoutes(app: FastifyInstance) {
  const run = async (req: FastifyRequest) => {
    if (!config.cronSecret) throw notFound('Page');
    const given = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!given || !safeEqualHex(sha256Hex(given), sha256Hex(config.cronSecret))) throw unauthorized();
    const started = Date.now();
    await runJobs();
    return { ok: true, ms: Date.now() - started };
  };
  app.get('/internal/tick', run);
  app.post('/internal/tick', run);
}
