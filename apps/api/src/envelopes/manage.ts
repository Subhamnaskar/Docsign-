import { zipSync } from 'fflate';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { appendAudit } from '../audit/audit.js';
import { prisma } from '../db.js';
import { clientInfo, requireAuth } from '../lib/auth.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { getObject } from '../lib/storage.js';
import { parse } from '../lib/validate.js';
import { serializeEnvelope } from './routes.js';
import { envelopeScope, getVisibleEnvelope, notifySigners } from './service.js';

const MAX_DOWNLOAD = 50;

const csvCell = (v: unknown) => {
  const s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
  // Prefix formula-like cells so spreadsheets don't execute them
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80).trim() || 'agreement';

export async function envelopeManageRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  /**
   * Fix a recipient's name or email after sending (e.g. a typo). Works for
   * anyone who hasn't signed yet. Their old link stops working; if it's their
   * turn they get a fresh invitation.
   */
  app.post('/envelopes/:id/recipients/:rid/correct', async (req) => {
    const { id, rid } = req.params as { id: string; rid: string };
    const body = parse(
      z.object({ name: z.string().trim().min(1).max(120).optional(), email: z.string().trim().toLowerCase().email().optional() }),
      req.body,
    );
    const env = await getVisibleEnvelope(req.auth, id);
    if (env.status !== 'SENT') throw conflict('Only envelopes that are out for signature can be corrected.');
    const r = env.recipients.find((x) => x.id === rid);
    if (!r) throw notFound('Recipient');
    if (r.status === 'SIGNED' || r.status === 'DECLINED') throw conflict('This recipient has already acted.');
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.recipient.update({
        where: { id: rid },
        data: {
          ...body,
          tokenVersion: { increment: 1 },
          // Whoever verified before must verify again
          signerSessionHash: null,
          verifiedAt: null,
          otpHash: null,
          ...(r.status === 'VIEWED' ? { status: 'SENT' } : {}),
        },
      });
      await appendAudit(tx, {
        envelopeId: id,
        type: 'recipient.corrected',
        actor: req.auth.actor,
        data: { recipientId: rid, from: { name: r.name, email: r.email }, to: { name: u.name, email: u.email } },
        ...clientInfo(req),
      });
      return u;
    });
    if (updated.status === 'SENT') await notifySigners(env, [updated], 'invite');
    return serializeEnvelope(await getVisibleEnvelope(req.auth, id));
  });

  app.patch('/envelopes/:id/folder', async (req) => {
    const { id } = req.params as { id: string };
    const { folderId } = parse(z.object({ folderId: z.string().nullable() }), req.body);
    await getVisibleEnvelope(req.auth, id);
    if (folderId && !(await prisma.folder.findFirst({ where: { id: folderId, orgId: req.auth.orgId } }))) throw notFound('Folder');
    await prisma.envelope.update({ where: { id }, data: { folderId } });
    return { id, folderId };
  });

  /** ZIP of completed agreements: sealed documents plus certificates. */
  app.post('/envelopes/download', async (req, reply) => {
    const { ids } = parse(z.object({ ids: z.array(z.string()).min(1).max(MAX_DOWNLOAD) }), req.body);
    const envelopes = await prisma.envelope.findMany({
      where: { id: { in: ids }, status: 'COMPLETED', ...envelopeScope(req.auth) },
      include: { documents: { orderBy: { order: 'asc' } } },
    });
    if (envelopes.length === 0) throw badRequest('None of the selected agreements are completed.');
    const files: Record<string, Uint8Array> = {};
    const used = new Set<string>();
    for (const env of envelopes) {
      let dir = fileSafe(env.title);
      if (used.has(dir)) dir = `${dir} (${env.id.slice(-6)})`;
      used.add(dir);
      for (const d of env.documents) {
        if (d.finalKey) files[`${dir}/${fileSafe(d.name.replace(/\.pdf$/i, ''))} (signed).pdf`] = await getObject(d.finalKey);
      }
      if (env.certificateKey) files[`${dir}/Certificate of Completion.pdf`] = await getObject(env.certificateKey);
    }
    reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="agreements-${new Date().toISOString().slice(0, 10)}.zip"`);
    // PDFs are already compressed; storing them is faster and barely larger
    return Buffer.from(zipSync(files, { level: 0 }));
  });

  app.get('/envelopes/export.csv', async (req, reply) => {
    const q = parse(z.object({ status: z.enum(['DRAFT', 'SENT', 'COMPLETED', 'DECLINED', 'VOIDED', 'EXPIRED']).optional() }), req.query);
    const envelopes = await prisma.envelope.findMany({
      where: { ...envelopeScope(req.auth), ...(q.status ? { status: q.status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 10_000,
      include: { createdBy: { select: { name: true, email: true } }, recipients: { orderBy: { routingOrder: 'asc' } }, folder: true },
    });
    const header = ['Envelope ID', 'Title', 'Status', 'Jurisdiction', 'Document type', 'Folder', 'Sender', 'Signers', 'Signed', 'Created', 'Sent', 'Completed', 'Hours to complete'];
    const rows = envelopes.map((e) => {
      const signers = e.recipients.filter((r) => r.role !== 'CC');
      const hours = e.sentAt && e.completedAt ? ((e.completedAt.getTime() - e.sentAt.getTime()) / 3_600_000).toFixed(1) : '';
      return [
        e.id,
        e.title,
        e.status,
        e.jurisdiction,
        e.documentType,
        e.folder?.name ?? '',
        `${e.createdBy.name} <${e.createdBy.email}>`,
        signers.map((r) => `${r.name} <${r.email}>`).join('; '),
        `${signers.filter((r) => r.status === 'SIGNED').length}/${signers.length}`,
        e.createdAt,
        e.sentAt,
        e.completedAt,
        hours,
      ];
    });
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="agreements-${new Date().toISOString().slice(0, 10)}.csv"`);
    // BOM so Excel opens UTF-8 names correctly
    return Buffer.from('﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n'));
  });
}

