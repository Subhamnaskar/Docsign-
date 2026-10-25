import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { aiRoutes } from './ai/routes.js';
import { authRoutes } from './auth/routes.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { developerRoutes } from './developers/routes.js';
import { envelopeRoutes } from './envelopes/routes.js';
import { integrationRoutes } from './integrations/routes.js';
import { HttpError } from './lib/errors.js';
import { mcpRoutes } from './mcp/routes.js';
import { paymentRoutes } from './payments/routes.js';
import { reportRoutes } from './reports/routes.js';
import { signingRoutes } from './signing/routes.js';
import { scimRoutes } from './sso/scim.js';
import { ssoRoutes } from './sso/routes.js';
import { envelopeManageRoutes } from './envelopes/manage.js';
import { esignRoutes } from './esign/routes.js';
import { organizationRoutes } from './organization/routes.js';
import { teamRoutes } from './team/routes.js';
import { formRoutes } from './templates/forms.js';
import { templateRoutes } from './templates/routes.js';
import { verifyRoutes } from './verify/routes.js';
import { websiteRoutes } from './website/routes.js';
import { billingRoutes } from './billing/routes.js';
import { securityRoutes } from './auth/security.js';
import { kycRoutes } from './kyc/routes.js';
import { enachRoutes } from './enach/routes.js';
import { docgenRoutes } from './docgen/routes.js';
import { contractRoutes } from './contracts/routes.js';
import { negotiationRoutes } from './negotiation/routes.js';

/** Builds the HTTP application without listening, so tests can drive it with inject(). */
export async function buildApp(opts: { logger?: FastifyServerOptions['logger'] } = {}) {
  const app = Fastify({
    logger: opts.logger ?? { level: config.isProduction ? 'info' : 'debug' },
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
      await v1.register(securityRoutes);
      await v1.register(signingRoutes);
      await v1.register(verifyRoutes);
      await v1.register(websiteRoutes);
      await v1.register(envelopeRoutes);
      await v1.register(templateRoutes);
      await v1.register(docgenRoutes);
      await v1.register(contractRoutes);
      await v1.register(negotiationRoutes);
      await v1.register(formRoutes);
      await v1.register(reportRoutes);
      await v1.register(esignRoutes);
      await v1.register(ssoRoutes);
      await v1.register(scimRoutes);
      await v1.register(integrationRoutes);
      await v1.register(aiRoutes);
      await v1.register(mcpRoutes);
      await v1.register(paymentRoutes);
      await v1.register(kycRoutes);
      await v1.register(enachRoutes);
      await v1.register(billingRoutes);
      await v1.register(envelopeManageRoutes);
      await v1.register(teamRoutes);
      await v1.register(organizationRoutes);
      await v1.register(developerRoutes);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
