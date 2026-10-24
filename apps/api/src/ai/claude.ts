import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type * as z from 'zod/v4';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';

/** Max bytes of PDF sent in one request (API limit is 32 MB per request, base64 inflates by a third). */
export const MAX_AI_PDF_BYTES = 20 * 1024 * 1024;

let client: Anthropic | null = null;

/** Lazily created so the API starts without credentials; tests replace it. */
export function aiClient(): Anthropic {
  if (!config.ai.enabled) throw new HttpError(503, 'AI features are not configured on this server.', 'ai_unavailable');
  client ??= new Anthropic();
  return client;
}

export function setAiClientForTests(c: Anthropic | null) {
  client = c;
}

export type PdfInput = { name: string; data: Buffer };

/** PDF documents as content blocks; the last one carries a cache breakpoint so follow-up questions reuse it. */
export function pdfBlocks(docs: PdfInput[]): Anthropic.Beta.BetaContentBlockParam[] {
  const total = docs.reduce((n, d) => n + d.data.length, 0);
  if (total > MAX_AI_PDF_BYTES) throw new HttpError(413, 'These documents are too large for AI analysis.', 'ai_too_large');
  return docs.map((d, i) => ({
    type: 'document',
    title: d.name,
    source: { type: 'base64', media_type: 'application/pdf', data: d.data.toString('base64') },
    ...(i === docs.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
  }));
}

function checkStop(stop: string | null, details: { category?: string | null } | null | undefined) {
  if (stop === 'refusal') {
    throw new HttpError(422, `The AI declined to analyse this document${details?.category ? ` (${details.category})` : ''}.`, 'ai_refused');
  }
  if (stop === 'max_tokens') throw new HttpError(502, 'The AI response was cut off. Try again.', 'ai_truncated');
}

/**
 * One structured-output call. Opus is the default model; thinking is adaptive
 * (always on for this model) and effort is set explicitly. Refusals fall back
 * server-side to Anthropic's recommended model for that refusal category.
 */
export async function structuredCall<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  content: Anthropic.Beta.BetaContentBlockParam[];
  effort: 'low' | 'medium' | 'high';
  maxTokens?: number;
}): Promise<z.infer<S>> {
  let res;
  try {
    res = await aiClient().beta.messages.parse({
      model: config.ai.model,
      max_tokens: opts.maxTokens ?? 16_000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: opts.system,
      output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
      messages: [{ role: 'user', content: opts.content }],
    });
  } catch (err) {
    throw toHttpError(err);
  }
  checkStop(res.stop_reason, res.stop_details);
  if (!res.parsed_output) throw new HttpError(502, 'The AI returned an unexpected response. Try again.', 'ai_bad_output');
  return res.parsed_output as z.infer<S>;
}

export interface CitedAnswer {
  text: string;
  citations: { document: string; page: number | null; quote: string }[];
}

/** Free-text answer grounded in the documents, with page citations. */
export async function citedAnswer(opts: { system: string; docs: PdfInput[]; question: string }): Promise<CitedAnswer> {
  let res;
  try {
    res = await aiClient().beta.messages.create({
      model: config.ai.model,
      max_tokens: 8_000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: opts.system,
      output_config: { effort: 'medium' },
      messages: [
        {
          role: 'user',
          content: [
            ...pdfBlocks(opts.docs).map((b) => (b.type === 'document' ? { ...b, citations: { enabled: true } } : b)),
            { type: 'text', text: opts.question },
          ],
        },
      ],
    });
  } catch (err) {
    throw toHttpError(err);
  }
  checkStop(res.stop_reason, res.stop_details);
  let text = '';
  const citations: CitedAnswer['citations'] = [];
  for (const block of res.content) {
    if (block.type !== 'text') continue;
    text += block.text;
    for (const c of block.citations ?? []) {
      if (c.type === 'page_location') {
        citations.push({ document: c.document_title ?? opts.docs[c.document_index]?.name ?? 'Document', page: c.start_page_number, quote: c.cited_text });
      }
    }
  }
  return { text: text.trim(), citations };
}

function toHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof Anthropic.RateLimitError) return new HttpError(429, 'The AI service is busy. Try again in a minute.', 'ai_rate_limited');
  if (err instanceof Anthropic.AuthenticationError) return new HttpError(503, 'The AI service credentials are invalid.', 'ai_unavailable');
  if (err instanceof Anthropic.APIError) return new HttpError(502, 'The AI service returned an error. Try again.', 'ai_error');
  return new HttpError(502, 'Could not reach the AI service.', 'ai_error');
}
