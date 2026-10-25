import type { FastifyInstance } from 'fastify';
import * as z4 from 'zod/v4';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { getVisibleEnvelope } from '../envelopes/service.js';
import { LANGUAGES_BY_CODE } from '../i18n/languages.js';
import { requireAuth } from '../lib/auth.js';
import { sha256Hex } from '../lib/crypto.js';
import { badRequest, HttpError } from '../lib/errors.js';
import { getObject } from '../lib/storage.js';
import { parse } from '../lib/validate.js';
import { loadByToken, requireSession } from '../signing/routes.js';
import { citedAnswer, pdfBlocks, structuredCall, type PdfInput } from './claude.js';
import { aiAssign, extractCandidates, heuristicAssign } from './fields.js';

const NOT_LEGAL_ADVICE = 'This is an automated summary to help you read the document. It is not legal advice; the document itself is what you agree to.';

const SummarySchema = z4.object({
  summary: z4.string(),
  keyTerms: z4.array(z4.object({ term: z4.string(), detail: z4.string() })),
  yourObligations: z4.array(z4.string()),
  datesAndAmounts: z4.array(z4.string()),
  worthCheckingBeforeSigning: z4.array(z4.string()),
});

const ReviewSchema = z4.object({
  overallRisk: z4.enum(['low', 'medium', 'high']),
  overview: z4.string(),
  findings: z4.array(
    z4.object({
      clause: z4.string(),
      issue: z4.string(),
      severity: z4.enum(['low', 'medium', 'high']),
      suggestion: z4.string(),
      page: z4.number().int().nullable(),
    }),
  ),
  missingClauses: z4.array(z4.string()),
});

export async function requireAiEnabled(orgId: string) {
  if (!config.ai.enabled) throw new HttpError(503, 'AI features are not configured on this server.', 'ai_unavailable');
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { aiEnabled: true } });
  if (!org.aiEnabled) throw new HttpError(403, 'AI features are turned off for this organisation. An admin can turn them on in Settings.', 'ai_disabled');
}

export async function loadPdfs(docs: { name: string; storageKey: string; finalKey: string | null }[]): Promise<PdfInput[]> {
  return Promise.all(docs.map(async (d) => ({ name: d.name, data: await getObject(d.finalKey ?? d.storageKey) })));
}

/** Runs `compute` once per key and caches the JSON result. */
async function cached<T>(key: string, kind: string, envelopeId: string, compute: () => Promise<T>): Promise<T> {
  const hit = await prisma.aiResult.findUnique({ where: { key } });
  if (hit) return hit.data as T;
  const data = await compute();
  await prisma.aiResult.upsert({ where: { key }, create: { key, kind, envelopeId, data: data as Prisma.JsonObject }, update: {} });
  return data;
}

export async function aiRoutes(app: FastifyInstance) {
  // --- Signer: plain-language summary in the signer's language --------------
  app.post('/signing/:token/ai/summary', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const { token } = req.params as { token: string };
    const { locale } = parse(z.object({ locale: z.string().max(10).optional() }), req.body ?? {});
    const r = await loadByToken(token);
    requireSession(req, r);
    await requireAiEnabled(r.envelope.orgId);
    const lang = LANGUAGES_BY_CODE[locale ?? r.locale] ?? 'English';
    const docs = r.envelope.documents;
    const key = `summary:${sha256Hex(docs.map((d) => d.sha256).join(','))}:${lang}`;
    const result = await cached(key, 'summary', r.envelopeId, async () =>
      structuredCall({
        schema: SummarySchema,
        effort: 'medium',
        system:
          `You help someone understand a document before they sign it. Write in ${lang}, in plain language a non-lawyer understands. ` +
          'Be faithful to the text: do not add terms that are not there, and say so when something is unclear. Keep the summary under 150 words. ' +
          '"worthCheckingBeforeSigning" lists points a careful reader would double-check (unusual obligations, penalties, auto-renewals, one-sided terms); leave it empty if there are none.',
        content: [...pdfBlocks(await loadPdfs(docs)), { type: 'text', text: `Summarise ${docs.length > 1 ? 'these documents' : 'this document'} for ${r.name}, who is asked to sign it.` }],
      }),
    );
    return { ...result, disclaimer: NOT_LEGAL_ADVICE, language: lang };
  });

  await app.register(async (s) => {
    s.addHook('preHandler', requireAuth);

    /** Contract review for the sender: risks, one-sided clauses, missing clauses. */
    s.post('/envelopes/:id/ai/review', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
      const { id } = req.params as { id: string };
      const env = await getVisibleEnvelope(req.auth, id);
      await requireAiEnabled(env.orgId);
      if (env.documents.length === 0) throw badRequest('Add a document first.');
      const key = `review:${sha256Hex(env.documents.map((d) => d.sha256).join(','))}:${env.jurisdiction}:${env.documentType}`;
      const review = await cached(key, 'review', env.id, async () =>
        structuredCall({
          schema: ReviewSchema,
          effort: 'high',
          system:
            'You review agreements for the party sending them for signature. Identify clauses that are risky, ambiguous, one-sided, or likely unenforceable, ' +
            `considering the governing jurisdiction (${env.jurisdiction}) and document type (${env.documentType.replace(/_/g, ' ')}). ` +
            'Quote or name the clause in "clause", explain the issue briefly, and give a concrete suggested fix. Include the page number when you can. ' +
            'List standard clauses that are missing for this type of agreement. Do not invent problems; an empty findings list is a valid result. This is not legal advice.',
          content: [...pdfBlocks(await loadPdfs(env.documents)), { type: 'text', text: 'Review this agreement.' }],
        }),
      );
      return { ...review, disclaimer: 'Automated review to support, not replace, legal advice.' };
    });

    /** Questions about the agreement, answered with page citations. */
    s.post('/envelopes/:id/ai/ask', { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (req) => {
      const { id } = req.params as { id: string };
      const { question } = parse(z.object({ question: z.string().trim().min(3).max(1000) }), req.body);
      const env = await getVisibleEnvelope(req.auth, id);
      await requireAiEnabled(env.orgId);
      if (env.documents.length === 0) throw badRequest('Add a document first.');
      return citedAnswer({
        system: 'Answer questions about the provided agreement using only its text. Cite the passages you rely on. If the documents do not answer the question, say so.',
        docs: await loadPdfs(env.documents),
        question,
      });
    });

    /**
     * Suggests field placements for a draft. Uses AI when enabled for the
     * organisation, otherwise a rule-based fallback. Suggestions are not saved.
     */
    s.post('/envelopes/:id/ai/detect-fields', async (req) => {
      const { id } = req.params as { id: string };
      const env = await getVisibleEnvelope(req.auth, id);
      const signers = env.recipients.filter((r) => r.role === 'SIGNER');
      if (signers.length === 0) throw badRequest('Add signers first, so fields can be assigned to them.');
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: env.orgId }, select: { aiEnabled: true } });
      const useAi = config.ai.enabled && org.aiEnabled;
      const suggestions = [];
      for (const doc of env.documents) {
        const { candidates, text } = await extractCandidates(await getObject(doc.storageKey));
        const fields = useAi
          ? await aiAssign(candidates, text, signers.map((s2) => ({ name: s2.name, role: 'signer' })))
          : heuristicAssign(candidates, signers.length);
        suggestions.push(...fields.map((f) => ({ ...f, documentId: doc.id, recipientId: signers[f.recipientIndex].id })));
      }
      return { method: useAi ? 'ai' : 'rules', fields: suggestions };
    });
  });
}
