import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sendPasswordReset } from '../auth/tokens.js';
import { isSsoOnly } from '../auth/security.js';
import { CURRENCIES } from '../billing/plans.js';
import { billingProvider } from '../billing/providers.js';
import { creditNoteNumber, currencyOf, hasLiveSubscription, invoiceNumber } from '../billing/service.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { logActivity } from '../lib/activity.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { formatAmount } from '../payments/providers.js';
import { layout, sendMail } from '../lib/mailer.js';
import { parse } from '../lib/validate.js';
import { assertCanChange, record } from './routes.js';
import { startSupportSession } from './support.js';

/**
 * Platform console actions: users, suspension, billing corrections, support
 * sessions and the console team. Registered inside platformRoutes, so every
 * route here already requires console staff; changes also need admin or owner.
 */

const reason = z.string().trim().min(3, 'Give a short reason').max(500);

const staffEmail = (req: FastifyRequest) => (req.auth.actor.kind === 'user' ? req.auth.actor.email : 'console');

async function findUser(id: string) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw notFound('User');
  return user;
}

async function findOrg(id: string) {
  const org = await prisma.organization.findUnique({ where: { id } });
  if (!org) throw notFound('Organisation');
  return org;
}

/** Tells the organisation's owners and admins about a change to their account. */
async function emailOrgAdmins(orgId: string, subject: string, paragraphs: string[], button?: { label: string; url: string }) {
  const admins = await prisma.user.findMany({ where: { orgId, disabledAt: null, role: { in: ['OWNER', 'ADMIN'] } }, select: { email: true } });
  const { html, text } = layout({ heading: subject, paragraphs, button });
  await Promise.all(admins.map((a) => sendMail({ to: a.email, subject, html, text }).catch(() => {})));
}

export async function platformActions(app: FastifyInstance) {
  // --- Users -------------------------------------------------------------------

  app.post('/admin/users/:id/sign-out', async (req) => {
    assertCanChange(req);
    const user = await findUser((req.params as { id: string }).id);
    const { count } = await prisma.session.deleteMany({ where: { userId: user.id } });
    await record(req, user.orgId, 'platform.user_signed_out', { email: user.email, sessions: count });
    return { sessions: count };
  });

  app.post('/admin/users/:id/deactivate', async (req) => {
    assertCanChange(req);
    const user = await findUser((req.params as { id: string }).id);
    if (user.id === req.auth.userId) throw badRequest('You cannot deactivate yourself.');
    await prisma.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } });
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await record(req, user.orgId, 'platform.user_deactivated', { email: user.email });
    return { ok: true };
  });

  app.post('/admin/users/:id/reactivate', async (req) => {
    assertCanChange(req);
    const user = await findUser((req.params as { id: string }).id);
    await prisma.user.update({ where: { id: user.id }, data: { disabledAt: null } });
    await record(req, user.orgId, 'platform.user_reactivated', { email: user.email });
    return { ok: true };
  });

  app.post('/admin/users/:id/password-reset', async (req) => {
    assertCanChange(req);
    const user = await findUser((req.params as { id: string }).id);
    if (user.disabledAt) throw badRequest('Reactivate the user first.');
    if (isSsoOnly(user)) throw badRequest('This user signs in with single sign-on and has no password.');
    await sendPasswordReset(user);
    await record(req, user.orgId, 'platform.password_reset_sent', { email: user.email });
    return { ok: true };
  });

  // --- Organisation ------------------------------------------------------------

  app.post('/admin/orgs/:id/suspend', async (req) => {
    assertCanChange(req);
    const org = await findOrg((req.params as { id: string }).id);
    const body = parse(z.object({ reason, notify: z.boolean().default(true) }), req.body);
    if (org.id === req.auth.orgId) throw badRequest('You cannot suspend your own organisation.');
    if (org.suspendedAt) throw badRequest('This organisation is already suspended.');
    await prisma.organization.update({ where: { id: org.id }, data: { suspendedAt: new Date(), suspendedReason: body.reason } });
    const { count } = await prisma.session.deleteMany({ where: { user: { orgId: org.id } } });
    await record(req, org.id, 'platform.org_suspended', { reason: body.reason, signedOut: count });
    if (body.notify) {
      await emailOrgAdmins(org.id, 'Your account has been suspended', [
        `${org.name} has been suspended by NuronixAI. Reason: ${body.reason}`,
        `Signing in, the API and signing links are paused until it is restored. Contact ${config.smtp.from} if you think this is a mistake.`,
      ]);
    }
    return { signedOut: count };
  });

  app.post('/admin/orgs/:id/reactivate', async (req) => {
    assertCanChange(req);
    const org = await findOrg((req.params as { id: string }).id);
    if (!org.suspendedAt) throw badRequest('This organisation is not suspended.');
    await prisma.organization.update({ where: { id: org.id }, data: { suspendedAt: null, suspendedReason: null } });
    await record(req, org.id, 'platform.org_reactivated', {});
    await emailOrgAdmins(org.id, 'Your account is active again', [`${org.name} has been restored. You can sign in and send agreements as before.`], {
      label: 'Sign in',
      url: `${config.appUrl}/login`,
    });
    return { ok: true };
  });

  app.post('/admin/orgs/:id/sign-out-all', async (req) => {
    assertCanChange(req);
    const org = await findOrg((req.params as { id: string }).id);
    const { count } = await prisma.session.deleteMany({ where: { user: { orgId: org.id } } });
    await record(req, org.id, 'platform.org_signed_out', { sessions: count });
    return { sessions: count };
  });

  // --- Billing -----------------------------------------------------------------

  app.post('/admin/orgs/:id/cancel', async (req) => {
    assertCanChange(req);
    const org = await findOrg((req.params as { id: string }).id);
    const body = parse(z.object({ when: z.enum(['period_end', 'now']), reason }), req.body);
    const manual = org.billingProvider === 'manual' && org.plan !== 'trial' && org.billingStatus !== 'CANCELED';
    if (!hasLiveSubscription(org) && !manual) throw badRequest('There is no active subscription to cancel.');
    if (hasLiveSubscription(org)) await billingProvider(org.billingProvider!).cancel(org.subscriptionRef!, body.when === 'period_end');
    await prisma.organization.update({
      where: { id: org.id },
      data: body.when === 'now' ? { billingStatus: 'CANCELED', cancelAtPeriodEnd: false, currentPeriodEnd: new Date() } : { cancelAtPeriodEnd: true },
    });
    await record(req, org.id, 'platform.subscription_canceled', { when: body.when, reason: body.reason });
    return { ok: true };
  });

  /** Refunds part or all of an invoice: through the provider that took the payment, recorded as a credit note. */
  app.post('/admin/orgs/:id/refund', async (req) => {
    assertCanChange(req);
    const org = await findOrg((req.params as { id: string }).id);
    const body = parse(z.object({ invoiceId: z.string(), amount: z.coerce.number().int().positive(), reason }), req.body);
    const invoice = await prisma.invoice.findFirst({ where: { id: body.invoiceId, orgId: org.id } });
    if (!invoice) throw notFound('Invoice');
    const already = await prisma.creditNote.aggregate({ where: { invoiceId: invoice.id }, _sum: { amount: true } });
    const refundable = invoice.total - (already._sum.amount ?? 0);
    if (body.amount > refundable) throw badRequest(`At most ${formatAmount(refundable, invoice.currency)} of this invoice can still be refunded.`);

    const viaProvider = ['stripe', 'razorpay', 'sandbox'].includes(invoice.provider) && Boolean(invoice.providerRef);
    const providerRef = viaProvider ? await billingProvider(invoice.provider).refund(invoice.providerRef!, body.amount) : null;
    const note = await prisma.creditNote.create({
      data: {
        orgId: org.id,
        invoiceId: invoice.id,
        kind: 'refund',
        amount: body.amount,
        currency: invoice.currency,
        reason: body.reason,
        provider: viaProvider ? invoice.provider : null,
        providerRef,
        createdBy: staffEmail(req),
      },
    });
    const number = creditNoteNumber(note);
    await record(req, org.id, 'platform.refund_issued', { creditNote: number, invoice: invoiceNumber(invoice), amount: body.amount, currency: invoice.currency });
    const to = org.billingEmail ?? (await prisma.user.findFirst({ where: { orgId: org.id, role: 'OWNER' }, select: { email: true } }))?.email;
    if (to) {
      const { html, text } = layout({
        heading: 'Refund issued',
        paragraphs: [
          `We refunded ${formatAmount(body.amount, invoice.currency)} of invoice ${invoiceNumber(invoice)} for ${org.name} (credit note ${number}).`,
          viaProvider ? 'It goes back to the original payment method and usually arrives within 5–10 working days.' : 'Our team will transfer it to you directly.',
        ],
        button: { label: 'View billing', url: `${config.appUrl}/settings?tab=billing` },
      });
      await sendMail({ to, subject: `Refund issued: ${number}`, html, text }).catch(() => {});
    }
    return { creditNote: number, providerRef, viaProvider };
  });

  /** Goodwill or service credit towards future charges, recorded as a credit note. */
  app.post('/admin/orgs/:id/credit', async (req) => {
    assertCanChange(req);
    const org = await findOrg((req.params as { id: string }).id);
    const body = parse(
      z.object({ amount: z.coerce.number().int().positive().max(100_000_000), currency: z.enum(CURRENCIES).optional(), reason }),
      req.body,
    );
    const currency = body.currency ?? currencyOf(org);
    const note = await prisma.creditNote.create({
      data: { orgId: org.id, kind: 'credit', amount: body.amount, currency, reason: body.reason, createdBy: staffEmail(req) },
    });
    const number = creditNoteNumber(note);
    await record(req, org.id, 'platform.credit_issued', { creditNote: number, amount: body.amount, currency });
    return { creditNote: number };
  });

  // --- Support sessions --------------------------------------------------------

  app.post('/admin/orgs/:id/support-session', async (req, reply) => {
    assertCanChange(req);
    const org = await findOrg((req.params as { id: string }).id);
    const { userId } = parse(z.object({ userId: z.string().optional() }), req.body ?? {});
    const started = await startSupportSession(req, reply, org.id, userId);
    return { ...started, redirect: '/dashboard' };
  });

  // --- Console team --------------------------------------------------------------

  app.get('/admin/team', async (req) => {
    const rows = await prisma.platformAdmin.findMany({ orderBy: { createdAt: 'asc' } });
    const emails = [...config.platformAdmins, ...rows.map((r) => r.email)];
    const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { email: true, name: true, emailVerifiedAt: true, totpEnabledAt: true, lastLoginAt: true } });
    const account = (email: string) => {
      const u = users.find((x) => x.email === email);
      return u ? { name: u.name, emailVerified: Boolean(u.emailVerifiedAt), twoFactor: Boolean(u.totpEnabledAt), lastLoginAt: u.lastLoginAt } : null;
    };
    return {
      you: { email: staffEmail(req), role: req.platformRole },
      twoFactorRequired: config.isProduction,
      members: [
        ...config.platformAdmins.map((email) => ({ email, role: 'owner', alerts: true, addedBy: 'PLATFORM_ADMINS setting', createdAt: null, account: account(email) })),
        ...rows.map((r) => ({ email: r.email, role: r.role, alerts: r.alerts, addedBy: r.addedBy, createdAt: r.createdAt, account: account(r.email) })),
      ],
    };
  });

  const ownerOnly = (req: FastifyRequest) => {
    if (req.platformRole !== 'owner') throw forbidden('Only console owners (listed in PLATFORM_ADMINS) can manage the console team.');
  };
  const teamRole = z.enum(['admin', 'viewer']);

  app.post('/admin/team', async (req, reply) => {
    ownerOnly(req);
    const body = parse(z.object({ email: z.string().trim().toLowerCase().email(), role: teamRole, alerts: z.boolean().default(true) }), req.body);
    if (config.platformAdmins.includes(body.email)) throw badRequest('That person is already a console owner.');
    if (await prisma.platformAdmin.findUnique({ where: { email: body.email } })) throw badRequest('That person is already on the console team.');
    await prisma.platformAdmin.create({ data: { ...body, addedBy: staffEmail(req) } });
    await logActivity(req, 'platform.team_added', { email: body.email, role: body.role });
    reply.code(201);
    return { ok: true };
  });

  /** Owners change anyone's role or alerts; everyone else can only turn their own alerts on or off. */
  app.patch('/admin/team/:email', async (req) => {
    const email = decodeURIComponent((req.params as { email: string }).email).toLowerCase();
    const body = parse(z.object({ role: teamRole.optional(), alerts: z.boolean().optional() }), req.body);
    const self = email === staffEmail(req).toLowerCase();
    if (req.platformRole !== 'owner' && (!self || body.role !== undefined)) throw forbidden('You can only change your own alert setting.');
    const row = await prisma.platformAdmin.findUnique({ where: { email } });
    if (!row) throw config.platformAdmins.includes(email) ? badRequest('Owners are managed in the PLATFORM_ADMINS setting.') : notFound('Team member');
    await prisma.platformAdmin.update({ where: { email }, data: body });
    await logActivity(req, 'platform.team_changed', { email, ...body });
    return { ok: true };
  });

  app.delete('/admin/team/:email', async (req) => {
    ownerOnly(req);
    const email = decodeURIComponent((req.params as { email: string }).email).toLowerCase();
    const { count } = await prisma.platformAdmin.deleteMany({ where: { email } });
    if (!count) throw notFound('Team member');
    await logActivity(req, 'platform.team_removed', { email });
    return { ok: true };
  });
}
