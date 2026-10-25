import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { csvCell } from '../envelopes/manage.js';
import { envelopeScope } from '../envelopes/service.js';
import { requireAuth } from '../lib/auth.js';
import { conflict, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { parseContactsCsv } from './service.js';

const contactInput = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().max(40).nullish(),
  company: z.string().trim().max(120).nullish(),
  jobTitle: z.string().trim().max(120).nullish(),
  locale: z.string().trim().min(2).max(8).optional(),
  notes: z.string().trim().max(2000).nullish(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

/** The organisation's address book of signers. */
export async function contactRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  const where = (orgId: string, q?: string, tag?: string): Prisma.ContactWhereInput => ({
    orgId,
    ...(tag && { tags: { has: tag } }),
    ...(q && {
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q.toLowerCase() } },
        { company: { contains: q, mode: 'insensitive' } },
      ],
    }),
  });

  app.get('/contacts', async (req) => {
    const q = parse(
      z.object({ q: z.string().trim().max(100).optional(), tag: z.string().max(40).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) }),
      req.query,
    );
    const w = where(req.auth.orgId, q.q, q.tag);
    const [total, contacts, tags] = await Promise.all([
      prisma.contact.count({ where: w }),
      prisma.contact.findMany({ where: w, orderBy: [{ lastSentAt: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.contact.findMany({ where: { orgId: req.auth.orgId }, select: { tags: true } }),
    ]);
    // How many agreements each contact was on (within what this user can see)
    const counts = await prisma.recipient.groupBy({
      by: ['email'],
      where: { email: { in: contacts.map((c) => c.email) }, envelope: { ...envelopeScope(req.auth), sentAt: { not: null } } },
      _count: true,
    });
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      tags: [...new Set(tags.flatMap((t) => t.tags))].sort(),
      contacts: contacts.map((c) => ({ ...c, agreements: counts.find((x) => x.email === c.email)?._count ?? 0 })),
    };
  });

  /** Recipient autocomplete in the agreement editor. */
  app.get('/contacts/suggest', async (req) => {
    const { q } = parse(z.object({ q: z.string().trim().min(1).max(100) }), req.query);
    const contacts = await prisma.contact.findMany({
      where: where(req.auth.orgId, q),
      orderBy: [{ lastSentAt: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
      take: 8,
      select: { id: true, name: true, email: true, company: true, locale: true },
    });
    return { contacts };
  });

  app.get('/contacts.csv', async (req, reply) => {
    const contacts = await prisma.contact.findMany({ where: { orgId: req.auth.orgId }, orderBy: { name: 'asc' } });
    const header = ['Name', 'Email', 'Phone', 'Company', 'Job title', 'Language', 'Tags', 'Last sent'];
    const rows = contacts.map((c) => [c.name, c.email, c.phone, c.company, c.jobTitle, c.locale, c.tags.join('; '), c.lastSentAt]);
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="contacts.csv"');
    return Buffer.from('﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n'));
  });

  app.get('/contacts/:id', async (req) => {
    const contact = await prisma.contact.findFirst({ where: { id: (req.params as { id: string }).id, orgId: req.auth.orgId } });
    if (!contact) throw notFound('Contact');
    const agreements = await prisma.envelope.findMany({
      where: { ...envelopeScope(req.auth), recipients: { some: { email: contact.email } } },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true, title: true, status: true, sentAt: true, completedAt: true, recipients: { where: { email: contact.email }, select: { role: true, status: true } } },
    });
    return {
      ...contact,
      agreements: agreements.map((a) => ({ id: a.id, title: a.title, status: a.status, sentAt: a.sentAt, completedAt: a.completedAt, role: a.recipients[0]?.role, recipientStatus: a.recipients[0]?.status })),
    };
  });

  app.post('/contacts', async (req, reply) => {
    const body = parse(contactInput, req.body);
    if (await prisma.contact.findUnique({ where: { orgId_email: { orgId: req.auth.orgId, email: body.email } } })) throw conflict('A contact with this email already exists.');
    const contact = await prisma.contact.create({ data: { ...body, orgId: req.auth.orgId, source: 'manual' } });
    reply.code(201);
    return contact;
  });

  app.patch('/contacts/:id', async (req) => {
    const id = (req.params as { id: string }).id;
    const body = parse(contactInput.partial(), req.body);
    const existing = await prisma.contact.findFirst({ where: { id, orgId: req.auth.orgId } });
    if (!existing) throw notFound('Contact');
    if (body.email && body.email !== existing.email && (await prisma.contact.findUnique({ where: { orgId_email: { orgId: req.auth.orgId, email: body.email } } }))) {
      throw conflict('A contact with this email already exists.');
    }
    return prisma.contact.update({ where: { id }, data: body });
  });

  app.delete('/contacts/:id', async (req) => {
    const { count } = await prisma.contact.deleteMany({ where: { id: (req.params as { id: string }).id, orgId: req.auth.orgId } });
    if (!count) throw notFound('Contact');
    return { ok: true };
  });

  /** CSV import: new emails are added, existing contacts get the file's details. */
  app.post('/contacts/import', async (req) => {
    const { csv } = parse(z.object({ csv: z.string().min(1).max(2_000_000) }), req.body);
    const { rows, problems } = parseContactsCsv(csv);
    let created = 0;
    let updated = 0;
    for (const r of rows.slice(0, 5000)) {
      const details = { name: r.name, phone: r.phone, company: r.company, jobTitle: r.jobTitle, ...(r.locale && { locale: r.locale }), ...(r.tags && { tags: r.tags }) };
      const existing = await prisma.contact.findUnique({ where: { orgId_email: { orgId: req.auth.orgId, email: r.email } } });
      if (existing) {
        await prisma.contact.update({ where: { id: existing.id }, data: details });
        updated++;
      } else {
        await prisma.contact.create({ data: { ...details, orgId: req.auth.orgId, email: r.email, source: 'import' } });
        created++;
      }
    }
    return { created, updated, problems };
  });
}
