import type { FastifyInstance } from 'fastify';
import * as z4 from 'zod/v4';
import { z } from 'zod';
import { structuredCall } from '../ai/claude.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { requireAuth, SESSION_COOKIE } from '../lib/auth.js';
import { sha256Hex } from '../lib/crypto.js';
import { HttpError, notFound } from '../lib/errors.js';
import { layout, sendMail } from '../lib/mailer.js';
import { parse } from '../lib/validate.js';
import { ARTICLES, articleBySlug } from './articles.js';

const AnswerSchema = z4.object({
  answer: z4.string().describe('Plain-language answer in 1-6 short paragraphs or a short list. No markdown headings.'),
  articles: z4.array(z4.string()).describe('Slugs of the most relevant help articles (up to 3), only from the list given'),
  answered: z4.boolean().describe('False if the articles do not cover the question'),
});

const KNOWLEDGE = ARTICLES.map((a) => `<article slug="${a.slug}" title="${a.title}">\n${a.body}\n</article>`).join('\n\n');

/** Who is asking, if signed in (optional for public help). */
async function optionalUser(cookie: string | undefined) {
  if (!cookie) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256Hex(cookie) }, include: { user: true } });
  return session && session.expiresAt > new Date() ? session.user : null;
}

export async function helpRoutes(app: FastifyInstance) {
  app.get('/help/articles', async () => ARTICLES.map(({ body: _, ...a }) => a));

  app.get('/help/articles/:slug', async (req) => {
    const a = articleBySlug((req.params as { slug: string }).slug);
    if (!a) throw notFound('Article');
    return a;
  });

  app.get('/help/assistant', async () => ({ available: config.ai.enabled }));

  /** Answers from the help articles only; says so when they don't cover the question. */
  app.post('/help/ask', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    if (!config.ai.enabled) throw new HttpError(503, 'The help assistant is not available. Search the articles or contact support.', 'ai_unavailable');
    const { question } = parse(z.object({ question: z.string().trim().min(3).max(1000) }), req.body);
    const out = await structuredCall({
      schema: AnswerSchema,
      system: [
        {
          type: 'text',
          text: `You are the help assistant for Nuronix eSign, an e-signature product. Answer only from the help articles below, in plain language, addressed to the user ("you"). If the articles don't cover the question, say so briefly, set answered to false and suggest contacting support. Never invent features, prices or legal advice.\n\n${KNOWLEDGE}`,
          cache_control: { type: 'ephemeral' },
        },
      ],
      content: [{ type: 'text', text: question }],
      effort: 'low',
      maxTokens: 2000,
    });
    const valid = out.articles.filter((s) => articleBySlug(s)).slice(0, 3);
    return {
      answer: out.answer,
      answered: out.answered,
      articles: valid.map((s) => ({ slug: s, title: articleBySlug(s)!.title })),
    };
  });

  app.post('/support', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const body = parse(
      z.object({
        subject: z.string().trim().min(3).max(200),
        message: z.string().trim().min(10).max(5000),
        email: z.string().trim().toLowerCase().email().optional(),
        page: z.string().max(300).optional(),
      }),
      req.body,
    );
    const user = await optionalUser(req.cookies[SESSION_COOKIE]);
    const email = user?.email ?? body.email;
    if (!email) throw new HttpError(400, 'Enter your email so we can reply.', 'bad_request');
    const sr = await prisma.supportRequest.create({
      data: { email, subject: body.subject, message: body.message, page: body.page, userId: user?.id, orgId: user?.orgId },
    });
    const { html, text } = layout({
      heading: `Support: ${body.subject}`,
      paragraphs: [`From ${user ? `${user.name} <${email}> (org ${user.orgId})` : email}`, body.page ? `Page: ${body.page}` : '', body.message].filter(Boolean),
      footer: `Request ${sr.id}`,
    });
    await sendMail({ to: config.supportEmail, subject: `[Support] ${body.subject}`, html, text });
    const ack = layout({
      heading: 'We received your message',
      paragraphs: [`Thanks for getting in touch about "${body.subject}". We'll reply to this address.`, `Reference: ${sr.id}`],
    });
    await sendMail({ to: email, subject: `We received your message: ${body.subject}`, html: ack.html, text: ack.text }).catch(() => {});
    reply.code(201);
    return { id: sr.id };
  });

  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);

    /** Getting-started checklist, computed from what the organisation has done. */
    r.get('/onboarding', async (req) => {
      const user = req.auth.userId ? await prisma.user.findUnique({ where: { id: req.auth.userId } }) : null;
      const orgId = req.auth.orgId;
      const [docs, sent, org, users, invites, templates] = await Promise.all([
        prisma.document.count({ where: { envelope: { orgId } } }),
        prisma.envelope.count({ where: { orgId, status: { not: 'DRAFT' } } }),
        prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { logoKey: true, brandColor: true } }),
        prisma.user.count({ where: { orgId } }),
        prisma.invitation.count({ where: { orgId } }),
        prisma.template.count({ where: { orgId } }),
      ]);
      const admin = req.auth.role !== 'MEMBER';
      const steps = [
        { id: 'verify', label: 'Confirm your email address', done: Boolean(user?.emailVerifiedAt), href: null },
        { id: 'upload', label: 'Upload your first document', done: docs > 0, href: '/dashboard' },
        { id: 'send', label: 'Send an agreement for signature', done: sent > 0, href: '/dashboard' },
        ...(admin
          ? [
              { id: 'brand', label: 'Add your logo and colour', done: Boolean(org.logoKey || org.brandColor), href: '/settings?tab=branding' },
              { id: 'team', label: 'Invite a colleague', done: users > 1 || invites > 0, href: '/settings?tab=team' },
            ]
          : []),
        { id: 'template', label: 'Save a template for documents you send often', done: templates > 0, href: '/help/templates-and-bulk-send' },
      ];
      return { dismissed: Boolean(user?.onboardingDismissedAt), steps, done: steps.filter((s) => s.done).length };
    });

    r.post('/onboarding/dismiss', async (req) => {
      if (req.auth.userId) await prisma.user.update({ where: { id: req.auth.userId }, data: { onboardingDismissedAt: new Date() } });
      return { dismissed: true };
    });
  });
}
