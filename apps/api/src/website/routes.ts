import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { layout, sendMail } from '../lib/mailer.js';
import { parse } from '../lib/validate.js';
import { openApiSpec } from '../developers/openapi.js';

export const LEAD_INTERESTS = ['demo', 'pricing', 'partnership', 'api', 'other'] as const;

/** Public website endpoints (no authentication). */
export async function websiteRoutes(app: FastifyInstance) {
  /** Public OpenAPI description, for API clients and code generators. */
  app.get('/openapi.json', async () => openApiSpec());

  app.post('/leads', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(120),
        email: z.string().trim().toLowerCase().email(),
        company: z.string().trim().min(1).max(160),
        role: z.string().trim().max(120).optional(),
        country: z.string().trim().max(80).optional(),
        interest: z.enum(LEAD_INTERESTS),
        message: z.string().trim().max(3000).optional(),
        // Honeypot: hidden from people, filled in by naive bots
        website: z.string().optional(),
      }),
      req.body,
    );
    reply.code(201);
    // Pretend success to bots so they don't retry with variations
    if (body.website) return { ok: true };

    const { website: _, ...data } = body;
    const lead = await prisma.lead.create({ data: { ...data, ip: req.ip } });

    const { html, text } = layout({
      heading: `New ${data.interest} request from ${data.company}`,
      paragraphs: [
        `${data.name} <${data.email}>${data.role ? `, ${data.role}` : ''}`,
        `Company: ${data.company}${data.country ? ` (${data.country})` : ''}`,
        `Interest: ${data.interest}`,
        ...(data.message ? [`Message: ${data.message}`] : []),
      ],
      footer: `Lead ${lead.id}`,
    });
    await sendMail({ to: config.salesEmail, subject: `Website lead: ${data.company}`, html, text }).catch((err) =>
      req.log.error({ err }, 'lead notification failed'),
    );
    return { ok: true };
  });
}
