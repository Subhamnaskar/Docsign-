import { appendAudit } from './audit/audit.js';
import { prisma } from './db.js';
import { finalizeEnvelope, notifySender, notifySigners } from './envelopes/service.js';
import { deliverPendingWebhooks, enqueueWebhook } from './webhooks/dispatcher.js';
import type { FastifyBaseLogger } from 'fastify';
import { renewSandboxSubscriptions } from './billing/service.js';
import { renewArchiveTimestamps } from './trust/archive.js';
import { sendRenewalReminders } from './contracts/routes.js';
import { purgeExpired } from './governance/retention.js';
import { deliverCrmEvents } from './crm/routes.js';
import { runPendingWorkflows } from './workflows/engine.js';

const DAY_MS = 24 * 3600 * 1000;

/** Expires envelopes past their deadline. */
async function expireEnvelopes() {
  const due = await prisma.envelope.findMany({ where: { status: 'SENT', expiresAt: { lt: new Date() } }, take: 50 });
  for (const env of due) {
    await prisma.$transaction(async (tx) => {
      const res = await tx.envelope.updateMany({ where: { id: env.id, status: 'SENT' }, data: { status: 'EXPIRED' } });
      if (res.count === 0) return;
      await appendAudit(tx, { envelopeId: env.id, type: 'envelope.expired', actor: { kind: 'system' } });
      await enqueueWebhook(tx, env.orgId, 'envelope.expired', { envelopeId: env.id });
    });
    await notifySender(env, `Expired: ${env.title}`, [`"${env.title}" expired before all parties signed.`]).catch(() => {});
  }
}

/** Automatic reminders every `reminderDays` for signers who haven't acted. */
async function sendReminders() {
  const envelopes = await prisma.envelope.findMany({
    where: { status: 'SENT', reminderDays: { gt: 0 } },
    include: { recipients: { where: { role: { in: ['SIGNER', 'APPROVER'] }, status: { in: ['SENT', 'VIEWED'] } } } },
    take: 200,
  });
  for (const env of envelopes) {
    const cutoff = Date.now() - env.reminderDays * DAY_MS;
    const due = env.recipients.filter((r) => r.lastNotifiedAt && r.lastNotifiedAt.getTime() < cutoff);
    if (due.length) await notifySigners(env, due, 'reminder');
  }
}

/** Retries sealing for envelopes whose signers are all done but sealing didn't finish. */
async function retryFinalization() {
  const stuck = await prisma.envelope.findMany({
    where: {
      status: 'SENT',
      recipients: { every: { OR: [{ role: 'CC' }, { status: 'SIGNED' }] } },
      updatedAt: { lt: new Date(Date.now() - 60_000) },
    },
    select: { id: true },
    take: 10,
  });
  for (const { id } of stuck) await finalizeEnvelope(id);
}

export function startWorker(log: FastifyBaseLogger) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await deliverPendingWebhooks();
      await deliverCrmEvents();
      await runPendingWorkflows();
      await expireEnvelopes();
      await sendReminders();
      await retryFinalization();
      await renewSandboxSubscriptions();
      await renewArchiveTimestamps();
      await sendRenewalReminders();
      await purgeExpired();
    } catch (err) {
      log.error({ err }, 'worker tick failed');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, 10_000);
  return () => clearInterval(timer);
}
