import { appendAudit } from '../audit/audit.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { sha256Hex } from '../lib/crypto.js';
import { getObject, putObject } from '../lib/storage.js';
import type { ResolvedPolicy } from '../policy/engine.js';
import { addLtv } from './ltv.js';

const DAY_MS = 24 * 3600_000;

/**
 * Archive-timestamp renewal (PAdES B-LTA). A document timestamp is only as
 * durable as the timestamp authority's certificate, so before it ages out the
 * file gets fresh validation data and a new timestamp on top. The renewed copy
 * is stored as a new object; earlier fingerprints stay verifiable.
 */
export async function renewArchiveTimestamps(opts: { olderThanDays?: number; now?: Date; limit?: number } = {}) {
  if (!config.tsaUrl) return { renewed: 0 };
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - (opts.olderThanDays ?? config.ltaRenewAfterDays) * DAY_MS);
  let renewed = 0;

  const docs = await prisma.document.findMany({
    where: { finalKey: { not: null }, archiveTimestampAt: { lt: cutoff } },
    include: { envelope: { select: { id: true, policy: true } } },
    take: opts.limit ?? 20,
  });
  for (const doc of docs) {
    const ltv = await addLtv(await getObject(doc.finalKey!));
    const stamped = ltv.documentTimestamp;
    if (ltv.level !== 'PAdES-B-LTA' || !stamped) continue;
    const finalSha256 = sha256Hex(ltv.pdf);
    const finalKey = `envelopes/${doc.envelopeId}/completed/${doc.id}-lta-${now.getTime()}.pdf`;
    const retention = (doc.envelope.policy as unknown as ResolvedPolicy | null)?.retentionYears;
    await putObject(finalKey, ltv.pdf, 'application/pdf', retention);
    await prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: doc.id },
        data: { finalKey, finalSha256, priorSha256: { push: doc.finalSha256! }, archiveTimestampAt: stamped, ltvLevel: ltv.level },
      });
      await appendAudit(tx, {
        envelopeId: doc.envelopeId,
        type: 'document.archive_timestamp_renewed',
        actor: { kind: 'system' },
        data: { documentId: doc.id, previousSha256: doc.finalSha256, sha256: finalSha256, archiveTimestamp: stamped.toISOString() },
      });
    });
    renewed += 1;
  }

  const certs = await prisma.envelope.findMany({
    where: { certificateKey: { not: null }, certificateArchiveTimestampAt: { lt: cutoff } },
    select: { id: true, certificateKey: true, certificateSha256: true, policy: true },
    take: opts.limit ?? 20,
  });
  for (const env of certs) {
    const ltv = await addLtv(await getObject(env.certificateKey!));
    if (ltv.level !== 'PAdES-B-LTA' || !ltv.documentTimestamp) continue;
    const key = `envelopes/${env.id}/completed/certificate-lta-${now.getTime()}.pdf`;
    await putObject(key, ltv.pdf, 'application/pdf', (env.policy as unknown as ResolvedPolicy | null)?.retentionYears);
    await prisma.envelope.update({
      where: { id: env.id },
      data: {
        certificateKey: key,
        certificateSha256: sha256Hex(ltv.pdf),
        certificatePriorSha256: { push: env.certificateSha256! },
        certificateArchiveTimestampAt: ltv.documentTimestamp,
      },
    });
    renewed += 1;
  }
  return { renewed };
}
