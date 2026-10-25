import type { ContractMeta, Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import * as z4 from 'zod/v4';
import { z } from 'zod';
import { pdfBlocks, structuredCall } from '../ai/claude.js';
import { loadPdfs, requireAiEnabled } from '../ai/routes.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { envelopeScope, getVisibleEnvelope } from '../envelopes/service.js';
import { requireAuth } from '../lib/auth.js';
import { layout, sendMail } from '../lib/mailer.js';
import { parse } from '../lib/validate.js';

/**
 * Contract repository: completed (and in-flight) agreements with their key
 * terms, searchable by counterparty, tags and dates, with renewal reminders.
 */

const DAY_MS = 24 * 3600_000;
/** Reminder goes out this many days before the notice deadline */
const REMIND_DAYS_BEFORE_NOTICE = 14;

const metaInput = z.object({
  counterparty: z.string().trim().max(200).nullable().optional(),
  value: z.number().int().min(0).max(1e15).nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
  effectiveDate: z.coerce.date().nullable().optional(),
  expiryDate: z.coerce.date().nullable().optional(),
  renewalDate: z.coerce.date().nullable().optional(),
  noticeDays: z.number().int().min(0).max(3650).nullable().optional(),
  autoRenews: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  notes: z.string().max(5000).nullable().optional(),
});

const ExtractSchema = z4.object({
  counterparty: z4.string().nullable().describe('The other party (not the organisation sending), as named in the contract'),
  value: z4.number().nullable().describe('Total contract value in major currency units (e.g. rupees), or null'),
  currency: z4.string().nullable().describe('ISO 4217 code of the value, e.g. INR, USD'),
  effectiveDate: z4.string().nullable().describe('YYYY-MM-DD the contract takes effect'),
  expiryDate: z4.string().nullable().describe('YYYY-MM-DD the contract ends, if fixed'),
  renewalDate: z4.string().nullable().describe('YYYY-MM-DD of the next renewal, if it renews'),
  noticeDays: z4.number().nullable().describe('Days of notice required to terminate or prevent renewal'),
  autoRenews: z4.boolean().describe('True if the contract renews automatically unless notice is given'),
  tags: z4.array(z4.string()).describe('Up to 5 short labels, e.g. "NDA", "vendor", "lease"'),
});

export const serializeMeta = (m: ContractMeta | null) =>
  m && {
    counterparty: m.counterparty,
    value: m.value === null ? null : Number(m.value),
    currency: m.currency,
    effectiveDate: m.effectiveDate,
    expiryDate: m.expiryDate,
    renewalDate: m.renewalDate,
    noticeDays: m.noticeDays,
    autoRenews: m.autoRenews,
    tags: m.tags,
    notes: m.notes,
    source: m.source,
    updatedAt: m.updatedAt,
  };

/** The date that matters next: renewal if set, otherwise expiry. */
const keyDate = (m: Pick<ContractMeta, 'renewalDate' | 'expiryDate'>) => m.renewalDate ?? m.expiryDate;

const toDate = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null);

export async function contractRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  /** Search the repository. `expiring=N` lists agreements whose renewal/expiry falls within N days. */
  app.get('/repository', async (req) => {
    const q = parse(
      z.object({
        search: z.string().trim().max(200).optional(),
        tag: z.string().trim().max(40).optional(),
        expiring: z.coerce.number().int().min(1).max(3650).optional(),
        status: z.enum(['COMPLETED', 'ALL']).default('COMPLETED'),
      }),
      req.query,
    );
    const now = new Date();
    const contract: Prisma.ContractMetaWhereInput = {};
    if (q.tag) contract.tags = { has: q.tag };
    if (q.expiring) {
      const until = new Date(now.getTime() + q.expiring * DAY_MS);
      contract.OR = [{ renewalDate: { gte: now, lte: until } }, { renewalDate: null, expiryDate: { gte: now, lte: until } }];
    }
    const where: Prisma.EnvelopeWhereInput = {
      ...envelopeScope(req.auth),
      ...(q.status === 'COMPLETED' ? { status: 'COMPLETED' } : { status: { not: 'DRAFT' } }),
      ...(Object.keys(contract).length ? { contract } : {}),
      ...(q.search
        ? {
            OR: [
              { title: { contains: q.search, mode: 'insensitive' } },
              { contract: { counterparty: { contains: q.search, mode: 'insensitive' } } },
              { recipients: { some: { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }] } } },
            ],
          }
        : {}),
    };
    const rows = await prisma.envelope.findMany({
      where,
      include: { contract: true, recipients: { select: { name: true, role: true } } },
      orderBy: { completedAt: 'desc' },
      take: 200,
    });
    return rows.map((e) => ({
      id: e.id,
      title: e.title,
      status: e.status,
      completedAt: e.completedAt,
      parties: e.recipients.filter((r) => r.role !== 'CC').map((r) => r.name),
      contract: serializeMeta(e.contract),
      nextDate: e.contract ? keyDate(e.contract) : null,
    }));
  });

  app.get('/repository/tags', async (req) => {
    const rows = await prisma.contractMeta.findMany({ where: { envelope: envelopeScope(req.auth) }, select: { tags: true } });
    const counts = new Map<string, number>();
    for (const r of rows) for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count }));
  });

  app.get('/envelopes/:id/contract', async (req) => {
    const { id } = req.params as { id: string };
    const env = await getVisibleEnvelope(req.auth, id);
    return serializeMeta(await prisma.contractMeta.findUnique({ where: { envelopeId: env.id } }));
  });

  app.put('/envelopes/:id/contract', async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(metaInput, req.body);
    const env = await getVisibleEnvelope(req.auth, id);
    const data = { ...body, value: body.value === undefined ? undefined : body.value === null ? null : BigInt(body.value), source: 'manual', reminderSentAt: null };
    const meta = await prisma.contractMeta.upsert({ where: { envelopeId: env.id }, create: { envelopeId: env.id, ...data }, update: data });
    return serializeMeta(meta);
  });

  /** Reads key terms from the documents with the AI and fills in what is still empty. */
  app.post('/envelopes/:id/contract/extract', async (req) => {
    const { id } = req.params as { id: string };
    const env = await getVisibleEnvelope(req.auth, id);
    await requireAiEnabled(env.orgId);
    const docs = await loadPdfs(env.documents);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: env.orgId }, select: { name: true } });
    const out = await structuredCall({
      schema: ExtractSchema,
      system: `You extract key commercial terms from contracts for a contract repository. The organisation using this tool is "${org.name}"; the counterparty is the other side. Use null when a term is not stated; never guess dates.`,
      content: [...pdfBlocks(docs), { type: 'text', text: 'Extract the key terms of this agreement.' }],
      effort: 'medium',
      maxTokens: 4000,
    });
    const existing = await prisma.contractMeta.findUnique({ where: { envelopeId: env.id } });
    // Never overwrite what a person entered
    const keep = <T>(current: T | null | undefined, extracted: T | null) => (current !== null && current !== undefined ? current : extracted);
    const data = {
      counterparty: keep(existing?.counterparty, out.counterparty),
      value: keep(existing?.value, out.value === null ? null : BigInt(Math.round(out.value * 100))),
      currency: keep(existing?.currency, out.currency && /^[A-Z]{3}$/.test(out.currency) ? out.currency : null),
      effectiveDate: keep(existing?.effectiveDate, toDate(out.effectiveDate)),
      expiryDate: keep(existing?.expiryDate, toDate(out.expiryDate)),
      renewalDate: keep(existing?.renewalDate, toDate(out.renewalDate)),
      noticeDays: keep(existing?.noticeDays, out.noticeDays === null ? null : Math.round(out.noticeDays)),
      autoRenews: existing?.source === 'manual' ? existing.autoRenews : out.autoRenews,
      tags: existing?.tags.length ? existing.tags : out.tags.slice(0, 5).map((t) => t.slice(0, 40)),
      source: existing?.source === 'manual' ? 'manual' : 'ai',
    };
    const meta = await prisma.contractMeta.upsert({ where: { envelopeId: env.id }, create: { envelopeId: env.id, ...data }, update: data });
    return serializeMeta(meta);
  });
}

/**
 * Worker: emails the agreement's sender ahead of the notice deadline
 * (renewal/expiry date minus notice days), once per date.
 */
export async function sendRenewalReminders(now = new Date()) {
  const horizon = new Date(now.getTime() + (REMIND_DAYS_BEFORE_NOTICE + 3650) * DAY_MS);
  const due = await prisma.contractMeta.findMany({
    where: { reminderSentAt: null, OR: [{ renewalDate: { gte: now, lte: horizon } }, { renewalDate: null, expiryDate: { gte: now, lte: horizon } }] },
    include: { envelope: { include: { createdBy: { select: { name: true, email: true } } } } },
    take: 100,
  });
  let sent = 0;
  for (const m of due) {
    const date = keyDate(m)!;
    const deadline = new Date(date.getTime() - (m.noticeDays ?? 0) * DAY_MS);
    if (deadline.getTime() - now.getTime() > REMIND_DAYS_BEFORE_NOTICE * DAY_MS) continue;
    const what = m.renewalDate ? (m.autoRenews ? 'renews automatically' : 'is up for renewal') : 'expires';
    const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    const { html, text } = layout({
      heading: `"${m.envelope.title}" ${what} on ${fmt(date)}`,
      paragraphs: [
        m.noticeDays ? `The notice period is ${m.noticeDays} days, so any notice must be given by ${fmt(deadline)}.` : 'Decide whether to renew, renegotiate or let it end.',
        m.counterparty ? `Counterparty: ${m.counterparty}.` : '',
      ].filter(Boolean),
      button: { label: 'Open agreement', url: `${config.appUrl}/envelopes/${m.envelopeId}` },
    });
    await sendMail({ to: m.envelope.createdBy.email, subject: `Renewal reminder: ${m.envelope.title}`, html, text });
    await prisma.contractMeta.update({ where: { envelopeId: m.envelopeId }, data: { reminderSentAt: now } });
    sent += 1;
  }
  return sent;
}
