import type { Envelope } from '@prisma/client';
import { appendAudit, type Actor } from '../audit/audit.js';
import { prisma } from '../db.js';
import { ingestDocument } from '../documents/ingest.js';
import { putObject } from '../lib/storage.js';

/** Scans, converts, fingerprints and stores a document on a draft envelope. */
export async function addDocument(
  env: Envelope & { documents: unknown[] },
  filename: string,
  data: Buffer,
  actor: Actor,
  client: { ip?: string | null; userAgent?: string | null },
  extra: Record<string, unknown> = {},
) {
  const ingested = await ingestDocument(filename, data);
  const name = filename.replace(/\.[^.]+$/, '') + '.pdf';
  const doc = await prisma.$transaction(
    async (tx) => {
      const created = await tx.document.create({
        data: {
          envelopeId: env.id,
          name,
          order: env.documents.length,
          storageKey: '',
          sha256: ingested.sha256,
          pageCount: ingested.pageCount,
          pages: ingested.pages,
        },
      });
      const storageKey = `envelopes/${env.id}/original/${created.id}.pdf`;
      await putObject(storageKey, ingested.pdf, 'application/pdf');
      await appendAudit(tx, {
        envelopeId: env.id,
        type: 'document.added',
        actor,
        data: { documentId: created.id, name, sha256: ingested.sha256, pages: ingested.pageCount, ...extra },
        ...client,
      });
      return tx.document.update({ where: { id: created.id }, data: { storageKey } });
    },
    { timeout: 30_000 },
  );
  return { id: doc.id, name: doc.name, sha256: doc.sha256, pageCount: doc.pageCount, pages: doc.pages };
}
