import type { Organization, Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { applyManualPlan } from '../billing/manual-plan.js';
import { CURRENCIES, type Currency, defaultCurrency, entitlement, isPlanId, planOf, PLANS, YEARLY_MONTHS } from '../billing/plans.js';
import { creditNoteNumber, hasLiveSubscription, invoiceNumber } from '../billing/service.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { csvCell } from '../envelopes/manage.js';
import { requireAuth } from '../lib/auth.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { type PlatformRole, platformRole } from './access.js';
import { platformActions } from './actions.js';

/**
 * Platform console for NuronixAI staff: every customer organisation, plan,
 * sign-in and revenue figure. Separate from the per-organisation admin
 * screens, which only ever see their own organisation.
 */

const DAY_MS = 24 * 3600 * 1000;
const BILLING_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED'] as const;

declare module 'fastify' {
  interface FastifyRequest {
    platformRole?: PlatformRole;
  }
}

/** Signed-in console staff only; API keys and support sessions never qualify. Answers 404 so the console's existence isn't revealed. */
async function requirePlatformAdmin(req: FastifyRequest) {
  await requireAuth(req);
  const user = req.auth.sessionId && req.auth.userId && !req.auth.support ? await prisma.user.findUnique({ where: { id: req.auth.userId } }) : null;
  const role = user && (await platformRole(user));
  if (!role) throw notFound('Page');
  req.platformRole = role;
}

/** Changes need admin or owner; viewers only look. */
export function assertCanChange(req: FastifyRequest) {
  if (req.platformRole === 'viewer') throw forbidden('Viewers can look but not make changes. Ask a console owner for admin access.');
}

const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const monthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const currencyOfOrg = (org: Pick<Organization, 'billingCurrency' | 'jurisdiction'>): Currency =>
  (CURRENCIES as readonly string[]).includes(org.billingCurrency ?? '') ? (org.billingCurrency as Currency) : defaultCurrency(org.jurisdiction);

/** Monthly recurring revenue of a paying self-serve subscription, minor units, before tax. Manual plans: 0. */
function mrrOf(org: Organization): { currency: Currency; amount: number } | null {
  if (org.billingStatus !== 'ACTIVE' && org.billingStatus !== 'PAST_DUE') return null;
  const plan = planOf(org);
  if (!plan.price) return null;
  const currency = currencyOfOrg(org);
  const monthly = plan.price[currency] * org.seats;
  return {
    currency,
    amount: org.billingInterval === 'year' ? Math.round((monthly * YEARLY_MONTHS) / 12) : monthly,
  };
}

const zeroMoney = (): Record<Currency, number> => ({ INR: 0, USD: 0 });

/** Distinct users active (used the app or signed in) on or after `since`. */
async function activeUsers(since: Date): Promise<number> {
  const rows = await prisma.activeDay.groupBy({
    by: ['userId'],
    where: { day: { gte: utcDay(since) } },
  });
  return rows.length;
}

/** One value per UTC day from `since` to today, filling gaps with 0. */
function series(since: Date, days: number, rows: { day: Date; n: bigint | number }[]) {
  const byDay = new Map(rows.map((r) => [r.day.toISOString().slice(0, 10), Number(r.n)]));
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(since.getTime() + i * DAY_MS).toISOString().slice(0, 10);
    return { day, value: byDay.get(day) ?? 0 };
  });
}

const orgFilter = z.object({
  q: z.string().trim().max(200).optional(),
  plan: z.string().refine(isPlanId, 'Unknown plan').optional(),
  status: z.enum(BILLING_STATUSES).optional(),
});

function orgWhere(f: z.infer<typeof orgFilter>): Prisma.OrganizationWhereInput {
  return {
    ...(f.plan && { plan: f.plan }),
    ...(f.status && { billingStatus: f.status }),
    ...(f.q && {
      OR: [{ name: { contains: f.q, mode: 'insensitive' } }, { id: f.q }, { users: { some: { email: { contains: f.q.toLowerCase() } } } }],
    }),
  };
}

/** Table rows: plan, seats, users, owner, last activity, usage and revenue per organisation. */
async function orgRows(orgs: (Organization & { _count: { users: number } })[]) {
  const ids = orgs.map((o) => o.id);
  const now = new Date();
  const [owners, lastLogin, lastActive, sent, revenue] = await Promise.all([
    prisma.user.findMany({
      where: { orgId: { in: ids }, role: 'OWNER' },
      select: { orgId: true, email: true, name: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.user.groupBy({
      by: ['orgId'],
      where: { orgId: { in: ids } },
      _max: { lastLoginAt: true },
    }),
    prisma.activeDay.groupBy({
      by: ['orgId'],
      where: { orgId: { in: ids } },
      _max: { day: true },
    }),
    prisma.envelope.groupBy({
      by: ['orgId'],
      where: {
        orgId: { in: ids },
        testMode: false,
        sentAt: { gte: monthStart(now) },
      },
      _count: true,
    }),
    prisma.invoice.groupBy({
      by: ['orgId', 'currency'],
      where: { orgId: { in: ids } },
      _sum: { subtotal: true },
    }),
  ]);
  return orgs.map((o) => {
    const owner = owners.find((u) => u.orgId === o.id);
    const login = lastLogin.find((r) => r.orgId === o.id)?._max.lastLoginAt ?? null;
    const active = lastActive.find((r) => r.orgId === o.id)?._max.day ?? null;
    const paid = zeroMoney();
    for (const r of revenue.filter((r) => r.orgId === o.id)) if (r.currency in paid) paid[r.currency as Currency] += r._sum.subtotal ?? 0;
    const ent = entitlement(o, now);
    return {
      id: o.id,
      name: o.name,
      createdAt: o.createdAt,
      jurisdiction: o.jurisdiction,
      plan: ent.plan.id,
      planName: ent.plan.name,
      billingStatus: o.billingStatus,
      state: ent.state,
      interval: o.billingInterval,
      managed: o.billingProvider === 'manual',
      trialEndsAt: ent.plan.id === 'trial' ? o.trialEndsAt : null,
      cancelAtPeriodEnd: o.cancelAtPeriodEnd,
      seats: o.seats,
      users: o._count.users,
      owner: owner ? { name: owner.name, email: owner.email } : null,
      lastLoginAt: login,
      lastActiveDay: active,
      envelopesThisMonth: sent.find((r) => r.orgId === o.id)?._count ?? 0,
      mrr: mrrOf(o),
      revenue: paid,
      suspended: Boolean(o.suspendedAt),
    };
  });
}

/** Support actions are recorded in the customer's own activity log. */
export const record = (req: FastifyRequest, orgId: string, type: string, data: Record<string, unknown>) =>
  prisma.activityLog.create({
    data: {
      orgId,
      type,
      actor: req.auth.actor as Prisma.JsonObject,
      data: { ...data, via: 'platform console' } as Prisma.JsonObject,
      ip: req.ip,
    },
  });

export async function platformRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requirePlatformAdmin);
  // Users, suspension, billing, support sessions and the console team (inherits the hook above)
  await app.register(platformActions);

  app.get('/admin/me', async (req) => ({
    admin: true,
    role: req.platformRole,
    email: req.auth.actor.kind === 'user' ? req.auth.actor.email : null,
  }));

  /** Headline numbers and daily trends. */
  app.get('/admin/overview', async (req) => {
    const { days } = parse(z.object({ days: z.coerce.number().int().min(7).max(365).default(30) }), req.query);
    const now = new Date();
    const today = utcDay(now);
    const since = new Date(today.getTime() - (days - 1) * DAY_MS);
    const ago = (n: number) => new Date(today.getTime() - (n - 1) * DAY_MS);

    const [orgCount, userCount, signupsToday, signups7, signupsPeriod, loginsToday, failedToday, dau, wau, mau, byPlan, payingOrgs, trialsEnding] =
      await Promise.all([
        prisma.organization.count(),
        prisma.user.count({ where: { disabledAt: null } }),
        prisma.organization.count({ where: { createdAt: { gte: today } } }),
        prisma.organization.count({ where: { createdAt: { gte: ago(7) } } }),
        prisma.organization.count({ where: { createdAt: { gte: since } } }),
        prisma.loginEvent.count({
          where: { success: true, createdAt: { gte: today } },
        }),
        prisma.loginEvent.count({
          where: { success: false, createdAt: { gte: today } },
        }),
        activeUsers(today),
        activeUsers(ago(7)),
        activeUsers(ago(30)),
        prisma.organization.groupBy({
          by: ['plan', 'billingStatus'],
          _count: true,
        }),
        prisma.organization.findMany({
          where: {
            billingStatus: { in: ['ACTIVE', 'PAST_DUE'] },
            plan: { not: 'trial' },
          },
        }),
        prisma.organization.findMany({
          where: {
            plan: 'trial',
            billingStatus: 'TRIALING',
            trialEndsAt: { gte: now, lte: new Date(now.getTime() + 7 * DAY_MS) },
          },
          orderBy: { trialEndsAt: 'asc' },
          take: 50,
          include: {
            users: { where: { role: 'OWNER' }, select: { email: true }, take: 1 },
          },
        }),
      ]);

    const mrr = zeroMoney();
    for (const o of payingOrgs) {
      const m = mrrOf(o);
      if (m) mrr[m.currency] += m.amount;
    }
    const revenueRows = await prisma.invoice.groupBy({
      by: ['currency'],
      where: { paidAt: { gte: since } },
      _sum: { subtotal: true, total: true },
      _count: true,
    });
    const revenue = zeroMoney();
    for (const r of revenueRows) if (r.currency in revenue) revenue[r.currency as Currency] = r._sum.subtotal ?? 0;

    const [sentPeriod, completedPeriod] = await Promise.all([
      prisma.envelope.count({
        where: { testMode: false, sentAt: { gte: since } },
      }),
      prisma.envelope.count({
        where: { testMode: false, completedAt: { gte: since } },
      }),
    ]);

    const [signupSeries, loginSeries, activeSeries, sentSeries] = await Promise.all([
      prisma.$queryRaw<
        { day: Date; n: bigint }[]
      >`SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC') AS day, count(*) AS n FROM "Organization" WHERE "createdAt" >= ${since} GROUP BY 1`,
      prisma.$queryRaw<
        { day: Date; n: bigint }[]
      >`SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC') AS day, count(*) AS n FROM "LoginEvent" WHERE success AND "createdAt" >= ${since} GROUP BY 1`,
      prisma.$queryRaw<{ day: Date; n: bigint }[]>`SELECT "day"::timestamp AS day, count(*) AS n FROM "ActiveDay" WHERE "day" >= ${since}::date GROUP BY 1`,
      prisma.$queryRaw<
        { day: Date; n: bigint }[]
      >`SELECT date_trunc('day', "sentAt" AT TIME ZONE 'UTC') AS day, count(*) AS n FROM "Envelope" WHERE NOT "testMode" AND "sentAt" >= ${since} GROUP BY 1`,
    ]);

    const plans = Object.values(PLANS).map((p) => {
      const rows = byPlan.filter((r) => r.plan === p.id);
      const status = Object.fromEntries(BILLING_STATUSES.map((s) => [s, rows.find((r) => r.billingStatus === s)?._count ?? 0]));
      return {
        plan: p.id,
        name: p.name,
        total: rows.reduce((n, r) => n + r._count, 0),
        status,
      };
    });

    return {
      days,
      totals: {
        organizations: orgCount,
        users: userCount,
        payingOrganizations: payingOrgs.length,
      },
      signups: { today: signupsToday, last7: signups7, period: signupsPeriod },
      logins: { today: loginsToday, failedToday },
      activeUsers: { day: dau, week: wau, month: mau },
      envelopes: { sent: sentPeriod, completed: completedPeriod },
      mrr,
      arr: { INR: mrr.INR * 12, USD: mrr.USD * 12 },
      revenue,
      plans,
      canceled: byPlan.filter((r) => r.billingStatus === 'CANCELED').reduce((n, r) => n + r._count, 0),
      cancelingAtPeriodEnd: await prisma.organization.count({
        where: { cancelAtPeriodEnd: true, billingStatus: 'ACTIVE' },
      }),
      trialsEnding: trialsEnding.map((o) => ({
        id: o.id,
        name: o.name,
        trialEndsAt: o.trialEndsAt,
        ownerEmail: o.users[0]?.email ?? null,
      })),
      series: {
        signups: series(since, days, signupSeries),
        logins: series(since, days, loginSeries),
        activeUsers: series(since, days, activeSeries),
        envelopesSent: series(since, days, sentSeries),
      },
    };
  });

  app.get('/admin/orgs', async (req) => {
    const q = parse(
      orgFilter.extend({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
      }),
      req.query,
    );
    const where = orgWhere(q);
    const [total, orgs] = await Promise.all([
      prisma.organization.count({ where }),
      prisma.organization.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { _count: { select: { users: true } } },
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      organizations: await orgRows(orgs),
    };
  });

  app.get('/admin/orgs.csv', async (req, reply) => {
    const where = orgWhere(parse(orgFilter, req.query));
    const orgs = await prisma.organization.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 20_000,
      include: { _count: { select: { users: true } } },
    });
    const rows = await orgRows(orgs);
    const header = [
      'Organisation',
      'ID',
      'Owner',
      'Country',
      'Plan',
      'Status',
      'Billing',
      'Seats',
      'Users',
      'Agreements this month',
      'MRR',
      'Revenue INR',
      'Revenue USD',
      'Trial ends',
      'Last sign-in',
      'Signed up',
    ];
    const lines = rows.map((r) => [
      r.name,
      r.id,
      r.owner?.email ?? '',
      r.jurisdiction,
      r.planName,
      r.state,
      r.managed ? 'manual' : r.interval,
      r.seats,
      r.users,
      r.envelopesThisMonth,
      r.mrr ? `${r.mrr.currency} ${(r.mrr.amount / 100).toFixed(2)}` : '',
      (r.revenue.INR / 100).toFixed(2),
      (r.revenue.USD / 100).toFixed(2),
      r.trialEndsAt,
      r.lastLoginAt,
      r.createdAt,
    ]);
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="customers-${new Date().toISOString().slice(0, 10)}.csv"`);
    return Buffer.from('﻿' + [header, ...lines].map((r) => r.map(csvCell).join(',')).join('\r\n'));
  });

  app.get('/admin/orgs/:id', async (req) => {
    const { id } = req.params as { id: string };
    const org = await prisma.organization.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!org) throw notFound('Organisation');
    const ent = entitlement(org);
    const [row] = await orgRows([org]);
    const [users, invoices, envelopesThisPeriod, envelopesAllTime, logins, actions, creditNotes] = await Promise.all([
      prisma.user.findMany({
        where: { orgId: id },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
          lastLoginAt: true,
          disabledAt: true,
          totpEnabledAt: true,
          emailVerifiedAt: true,
          _count: {
            select: { sessions: { where: { expiresAt: { gt: new Date() } } } },
          },
        },
      }),
      prisma.invoice.findMany({
        where: { orgId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.envelope.count({
        where: { orgId: id, testMode: false, sentAt: { gte: ent.periodStart } },
      }),
      prisma.envelope.count({
        where: { orgId: id, testMode: false, sentAt: { not: null } },
      }),
      prisma.loginEvent.findMany({
        where: { orgId: id },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
      prisma.activityLog.findMany({
        where: { orgId: id, type: { startsWith: 'platform.' } },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
      prisma.creditNote.findMany({ where: { orgId: id }, orderBy: { seq: 'desc' } }),
    ]);
    const refunded = (invoiceId: string) => creditNotes.filter((c) => c.invoiceId === invoiceId).reduce((n, c) => n + c.amount, 0);
    return {
      ...row,
      dataRegion: org.dataRegion,
      periodStart: ent.periodStart,
      periodEnd: ent.periodEnd,
      usage: {
        envelopes: envelopesThisPeriod,
        envelopeLimit: ent.envelopeLimit,
        seats: users.filter((u) => !u.disabledAt).length,
        seatLimit: ent.seatLimit,
      },
      envelopesAllTime,
      billingProvider: org.billingProvider,
      billingEmail: org.billingEmail,
      liveSubscription: hasLiveSubscription(org),
      suspendedAt: org.suspendedAt,
      suspendedReason: org.suspendedReason,
      supportAccessUntil: org.supportAccessUntil && org.supportAccessUntil > new Date() ? org.supportAccessUntil : null,
      users: users.map(({ _count, totpEnabledAt, emailVerifiedAt, disabledAt, ...u }) => ({
        ...u,
        twoFactor: Boolean(totpEnabledAt),
        emailVerified: Boolean(emailVerifiedAt),
        disabled: Boolean(disabledAt),
        activeSessions: _count.sessions,
      })),
      invoices: invoices.map((i) => ({
        id: i.id,
        number: invoiceNumber(i),
        description: i.description,
        currency: i.currency,
        total: i.total,
        paidAt: i.paidAt,
        provider: i.provider,
        refunded: refunded(i.id),
      })),
      creditNotes: creditNotes.map((c) => ({
        id: c.id,
        number: creditNoteNumber(c),
        kind: c.kind,
        amount: c.amount,
        currency: c.currency,
        reason: c.reason,
        provider: c.provider,
        providerRef: c.providerRef,
        invoiceId: c.invoiceId,
        createdBy: c.createdBy,
        createdAt: c.createdAt,
      })),
      logins: logins.map((l) => ({
        id: l.id,
        email: l.email,
        method: l.method,
        success: l.success,
        reason: l.reason,
        ip: l.ip,
        createdAt: l.createdAt,
      })),
      actions: actions.map((a) => ({
        id: a.id,
        type: a.type,
        actor: a.actor,
        data: a.data,
        createdAt: a.createdAt,
      })),
    };
  });

  app.post('/admin/orgs/:id/extend-trial', async (req) => {
    const { id } = req.params as { id: string };
    assertCanChange(req);
    const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(90) }), req.body);
    const org = await prisma.organization.findUnique({ where: { id } });
    if (!org) throw notFound('Organisation');
    if (org.plan !== 'trial') throw badRequest('Only organisations on the free trial can have their trial extended.');
    const from = org.trialEndsAt > new Date() ? org.trialEndsAt : new Date();
    const trialEndsAt = new Date(from.getTime() + days * DAY_MS);
    await prisma.organization.update({
      where: { id },
      data: { trialEndsAt, billingStatus: 'TRIALING' },
    });
    await record(req, id, 'platform.trial_extended', { days, trialEndsAt });
    return { trialEndsAt };
  });

  app.post('/admin/orgs/:id/plan', async (req) => {
    assertCanChange(req);
    const { id } = req.params as { id: string };
    const body = parse(
      z.object({
        plan: z.string().refine(isPlanId, 'Unknown plan'),
        seats: z.coerce.number().int().min(1).max(100_000).optional(),
        months: z.coerce.number().int().min(1).max(60).optional(),
      }),
      req.body,
    );
    if (
      !(await prisma.organization.findUnique({
        where: { id },
        select: { id: true },
      }))
    )
      throw notFound('Organisation');
    const { org, until } = await applyManualPlan(id, body.plan as Parameters<typeof applyManualPlan>[1], { seats: body.seats, months: body.months });
    await record(req, id, 'platform.plan_changed', {
      plan: org.plan,
      seats: org.seats,
      until,
    });
    return { plan: org.plan, seats: org.seats, until };
  });

  /** Sign-in log across all customers, with a summary for spotting attacks. */
  app.get('/admin/logins', async (req) => {
    const q = parse(
      z.object({
        result: z.enum(['all', 'success', 'failed']).default('all'),
        q: z.string().trim().max(200).optional(),
        page: z.coerce.number().int().min(1).default(1),
      }),
      req.query,
    );
    const pageSize = 50;
    const where: Prisma.LoginEventWhereInput = {
      ...(q.result !== 'all' && { success: q.result === 'success' }),
      ...(q.q && {
        OR: [{ email: { contains: q.q.toLowerCase() } }, { ip: q.q }],
      }),
    };
    const day = new Date(Date.now() - DAY_MS);
    const month = new Date(Date.now() - 30 * DAY_MS);
    const [total, events, byMethod, failuresByReason, failingIps] = await Promise.all([
      prisma.loginEvent.count({ where }),
      prisma.loginEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * pageSize,
        take: pageSize,
        include: {
          user: {
            select: { name: true, org: { select: { id: true, name: true } } },
          },
        },
      }),
      prisma.loginEvent.groupBy({
        by: ['method'],
        where: { success: true, createdAt: { gte: month } },
        _count: true,
      }),
      prisma.loginEvent.groupBy({
        by: ['reason'],
        where: { success: false, createdAt: { gte: month } },
        _count: true,
      }),
      prisma.loginEvent.groupBy({
        by: ['ip'],
        where: { success: false, createdAt: { gte: day } },
        _count: true,
        orderBy: { _count: { ip: 'desc' } },
        take: 10,
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize,
      events: events.map((e) => ({
        id: e.id,
        email: e.email,
        name: e.user?.name ?? null,
        organization: e.user?.org ?? null,
        method: e.method,
        success: e.success,
        reason: e.reason,
        ip: e.ip,
        userAgent: e.userAgent,
        createdAt: e.createdAt,
      })),
      summary: {
        byMethod: byMethod.map((r) => ({ method: r.method, count: r._count })),
        failuresByReason: failuresByReason.map((r) => ({
          reason: r.reason ?? 'unknown',
          count: r._count,
        })),
        failingIps: failingIps.filter((r) => r.ip).map((r) => ({ ip: r.ip!, count: r._count })),
      },
    };
  });
}
