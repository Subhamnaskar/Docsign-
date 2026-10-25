import type { Envelope } from '@prisma/client';
import { prisma } from '../db.js';
import { deletePrefix } from '../lib/storage.js';
import type { ResolvedPolicy } from '../policy/engine.js';

const DAY_MS = 24 * 3600_000;

/**
 * Retention rules (worker). Completed agreements are deleted once both the
 * organisation's retention period and the jurisdiction's legal minimum have
 * passed; unsent or unfinished agreements after the organisation's purge
 * period. Agreements on legal hold are never deleted. Each deletion leaves a
 * record (title, dates, fingerprints) in the organisation's activity log.
 */
export async function purgeExpired(now = new Date(), limit = 25) {
  const orgs = await prisma.organization.findMany({
    where: { OR: [{ retentionDays: { not: null } }, { purgeIncompleteDays: { not: null } }] },
    select: { id: true, retentionDays: true, purgeIncompleteDays: true },
  });
  let purged = 0;
  for (const org of orgs) {
    const candidates: Envelope[] = [];
    if (org.retentionDays !== null) {
      candidates.push(
        ...(await prisma.envelope.findMany({
          where: { orgId: org.id, status: 'COMPLETED', legalHoldAt: null, completedAt: { lt: new Date(now.getTime() - org.retentionDays * DAY_MS) } },
          take: limit,
        })),
      );
    }
    if (org.purgeIncompleteDays !== null) {
      candidates.push(
        ...(await prisma.envelope.findMany({
          where: {
            orgId: org.id,
            status: { in: ['DRAFT', 'VOIDED', 'DECLINED', 'EXPIRED'] },
            legalHoldAt: null,
            updatedAt: { lt: new Date(now.getTime() - org.purgeIncompleteDays * DAY_MS) },
          },
          take: limit,
        })),
      );
    }
    for (const env of candidates) {
      // The legal minimum always wins over a shorter organisation setting
      const policy = env.policy as unknown as ResolvedPolicy | null;
      if (env.status === 'COMPLETED' && policy?.retentionYears && env.completedAt) {
        const legalUntil = env.completedAt.getTime() + policy.retentionYears * 365 * DAY_MS;
        if (legalUntil > now.getTime()) continue;
      }
      if (await purgeEnvelope(env, 'retention')) purged += 1;
    }
  }
  return purged;
}

/** Deletes an agreement's files and records; returns false if storage still holds locked versions. */
export async function purgeEnvelope(env: Envelope, reason: 'retention' | 'manual', actor: object = { kind: 'system' }): Promise<boolean> {
  const docs = await prisma.document.findMany({ where: { envelopeId: env.id }, select: { name: true, sha256: true, finalSha256: true } });
  const { deleted, locked } = await deletePrefix(`envelopes/${env.id}/`);
  if (locked) return false;
  const where = { envelopeId: env.id };
  await prisma.$transaction([
    // Rows that reference the envelope without a foreign key
    prisma.kycCheck.deleteMany({ where }),
    prisma.mandate.deleteMany({ where }),
    prisma.signerAttachment.deleteMany({ where }),
    prisma.esignTransaction.deleteMany({ where }),
    prisma.aiResult.deleteMany({ where }),
    prisma.payment.deleteMany({ where }),
    prisma.envelope.delete({ where: { id: env.id } }),
    prisma.activityLog.create({
      data: {
        orgId: env.orgId,
        type: 'envelope.purged',
        actor: actor as object,
        data: {
          envelopeId: env.id,
          title: env.title,
          status: env.status,
          sentAt: env.sentAt,
          completedAt: env.completedAt,
          reason,
          objectsDeleted: deleted,
          documents: docs.map((d) => ({ name: d.name, sha256: d.finalSha256 ?? d.sha256 })),
          certificateSha256: env.certificateSha256,
        },
      },
    }),
  ]);
  return true;
}
