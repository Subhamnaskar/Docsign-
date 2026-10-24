import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { envelopeScope } from '../envelopes/service.js';
import { requireAuth } from '../lib/auth.js';
import { parse } from '../lib/validate.js';

const DAY_MS = 24 * 3600 * 1000;

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Monday 00:00 UTC of the week containing `d`. */
function weekStart(d: Date): string {
  const day = (d.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return start.toISOString().slice(0, 10);
}

const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

/** Agreement analytics: volume, turnaround, signer drop-off, per-sender usage. */
export async function reportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/reports', async (req) => {
    const { days } = parse(z.object({ days: z.coerce.number().int().min(7).max(365).default(90) }), req.query);
    const since = new Date(Date.now() - days * DAY_MS);
    const scope = envelopeScope(req.auth);

    const envelopes = await prisma.envelope.findMany({
      where: { ...scope, OR: [{ createdAt: { gte: since } }, { sentAt: { gte: since } }, { completedAt: { gte: since } }] },
      select: {
        id: true,
        title: true,
        status: true,
        sentAt: true,
        completedAt: true,
        createdAt: true,
        jurisdiction: true,
        createdBy: { select: { id: true, name: true, email: true } },
        recipients: {
          select: { role: true, status: true, lastNotifiedAt: true, viewedAt: true, verifiedAt: true, declineReason: true, declinedAt: true, name: true },
        },
      },
      take: 20_000,
    });

    const sentInRange = envelopes.filter((e) => e.sentAt && e.sentAt >= since);
    const completedInRange = envelopes.filter((e) => e.completedAt && e.completedAt >= since);
    const hours = completedInRange
      .filter((e) => e.sentAt)
      .map((e) => (e.completedAt!.getTime() - e.sentAt!.getTime()) / 3_600_000)
      .sort((a, b) => a - b);
    const finished = sentInRange.filter((e) => e.status !== 'SENT');

    // Weekly volume; every week in range is present so the line has no gaps
    const weeks = new Map<string, { sent: number; completed: number }>();
    for (let t = new Date(weekStart(since)).getTime(); t <= Date.now(); t += 7 * DAY_MS) {
      weeks.set(new Date(t).toISOString().slice(0, 10), { sent: 0, completed: 0 });
    }
    for (const e of sentInRange) weeks.get(weekStart(e.sentAt!))!.sent++;
    for (const e of completedInRange) {
      const w = weeks.get(weekStart(e.completedAt!));
      if (w) w.completed++;
    }

    // Signer funnel over everyone asked to act on agreements sent in range
    const actors = sentInRange.flatMap((e) => e.recipients.filter((r) => r.role !== 'CC' && r.status !== 'CREATED'));
    const funnel = {
      invited: actors.length,
      opened: actors.filter((r) => r.viewedAt).length,
      verified: actors.filter((r) => r.verifiedAt).length,
      signed: actors.filter((r) => r.status === 'SIGNED').length,
    };

    const bySenderMap = new Map<string, { name: string; email: string; sent: number; completed: number; hours: number[] }>();
    for (const e of sentInRange) {
      const s = bySenderMap.get(e.createdBy.id) ?? { name: e.createdBy.name, email: e.createdBy.email, sent: 0, completed: 0, hours: [] };
      s.sent++;
      if (e.status === 'COMPLETED' && e.completedAt) {
        s.completed++;
        s.hours.push((e.completedAt.getTime() - e.sentAt!.getTime()) / 3_600_000);
      }
      bySenderMap.set(e.createdBy.id, s);
    }

    const statusCounts: Record<string, number> = {};
    for (const e of sentInRange) statusCounts[e.status] = (statusCounts[e.status] ?? 0) + 1;

    const declines = sentInRange
      .flatMap((e) =>
        e.recipients
          .filter((r) => r.status === 'DECLINED')
          .map((r) => ({ envelopeId: e.id, title: e.title, signer: r.name, reason: r.declineReason, at: r.declinedAt })),
      )
      .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0))
      .slice(0, 20);

    return {
      days,
      totals: {
        sent: sentInRange.length,
        completed: completedInRange.length,
        // Of agreements sent in range that reached an outcome, how many completed
        completionRate: finished.length ? sentInRange.filter((e) => e.status === 'COMPLETED').length / finished.length : null,
        medianHours: round1(quantile(hours, 0.5)),
        p90Hours: round1(quantile(hours, 0.9)),
        outstanding: sentInRange.filter((e) => e.status === 'SENT').length,
      },
      weekly: [...weeks.entries()].map(([week, v]) => ({ week, ...v })),
      funnel,
      statusCounts,
      bySender: [...bySenderMap.values()]
        .map((s) => ({ name: s.name, email: s.email, sent: s.sent, completed: s.completed, medianHours: round1(quantile(s.hours.sort((a, b) => a - b), 0.5)) }))
        .sort((a, b) => b.sent - a.sent),
      declines,
    };
  });
}
