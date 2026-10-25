import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { appendAudit } from '../audit/audit.js';
import { TRIAL } from '../billing/plans.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { startHostSession } from '../envelopes/manage.js';
import { serializeEnvelope } from '../envelopes/routes.js';
import { getVisibleEnvelope, sendEnvelope } from '../envelopes/service.js';
import { clientInfo, createSession, requireAuth } from '../lib/auth.js';
import { numericCode, randomToken, sha256Hex } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { layout, sendMail } from '../lib/mailer.js';
import { getObject } from '../lib/storage.js';
import { parse } from '../lib/validate.js';
import { actorOf, loadByToken, requireSession } from '../signing/routes.js';
import { ssoOrgForEmail } from '../sso/routes.js';

/**
 * "Sign it yourself": someone uploads a document they received (a joining
 * letter, say), signs it in their browser, downloads the sealed PDF and sends
 * it back. Free on every plan. People without an account verify their email
 * with a code and get a personal account they can keep by setting a password.
 */

const GUEST_CODE_TTL_MS = 15 * 60_000;
const GUEST_MAX_ATTEMPTS = 5;
/** Accounts created by the guest flow have no usable password until they set one */
export const GUEST_PASSWORD_PREFIX = 'guest:';
export const isGuest = (u: { passwordHash: string }) => u.passwordHash.startsWith(GUEST_PASSWORD_PREFIX);

export async function selfSignRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } };

  // --- Without an account: verify the email, get a personal account -----------

  app.post('/self-sign/guest/code', strict, async (req) => {
    const body = parse(z.object({ email: z.string().trim().toLowerCase().email(), name: z.string().trim().min(1).max(120) }), req.body);
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing && !isGuest(existing)) throw conflict('You already have an account with this email. Sign in to continue.');
    if (await ssoOrgForEmail(body.email)) throw conflict('Your company signs in with single sign-on. Sign in with SSO to continue.');
    const code = numericCode();
    await prisma.guestCode.upsert({
      where: { email: body.email },
      create: { email: body.email, codeHash: sha256Hex(code), expiresAt: new Date(Date.now() + GUEST_CODE_TTL_MS) },
      update: { codeHash: sha256Hex(code), attempts: 0, expiresAt: new Date(Date.now() + GUEST_CODE_TTL_MS) },
    });
    const { html, text } = layout({
      heading: `${code} is your code`,
      paragraphs: [`Hi ${body.name}, enter this code to sign your document. It expires in 15 minutes.`, "If you didn't ask for this, you can ignore this email."],
    });
    await sendMail({ to: body.email, subject: `${code} is your signing code`, html, text });
    return { ok: true };
  });

  app.post('/self-sign/guest/verify', strict, async (req, reply) => {
    const body = parse(z.object({ email: z.string().trim().toLowerCase().email(), name: z.string().trim().min(1).max(120), code: z.string().trim().regex(/^\d{6}$/) }), req.body);
    const row = await prisma.guestCode.findUnique({ where: { email: body.email } });
    if (!row || row.expiresAt < new Date() || row.attempts >= GUEST_MAX_ATTEMPTS) throw unauthorized('This code has expired. Ask for a new one.');
    if (row.codeHash !== sha256Hex(body.code)) {
      await prisma.guestCode.update({ where: { email: body.email }, data: { attempts: { increment: 1 } } });
      throw unauthorized('That code is not correct.');
    }
    await prisma.guestCode.delete({ where: { email: body.email } });
    let user = await prisma.user.findUnique({ where: { email: body.email } });
    if (user && !isGuest(user)) throw conflict('You already have an account with this email. Sign in to continue.');
    if (!user) {
      user = await prisma.user.create({
        data: {
          name: body.name,
          email: body.email,
          passwordHash: `${GUEST_PASSWORD_PREFIX}${randomToken(16)}`,
          role: 'OWNER',
          emailVerifiedAt: new Date(),
          org: { create: { name: `${body.name} (personal)`, jurisdiction: 'IN', dataRegion: config.cellRegion, trialEndsAt: new Date(Date.now() + TRIAL.days * 86_400_000) } },
        },
      });
    }
    await createSession(reply, user.id, 'guest');
    return { id: user.id, name: user.name, email: user.email };
  });

  // --- Signed in (any plan, including guests) ----------------------------------

  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);

    /** A draft the signed-in person will sign themselves. Upload documents and place fields with the usual endpoints. */
    r.post('/self-sign', async (req, reply) => {
      const { title } = parse(z.object({ title: z.string().trim().max(200).optional() }), req.body ?? {});
      if (!req.auth.userId || req.auth.support) throw forbidden('Sign in as yourself to sign a document.');
      const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth.userId }, include: { org: { select: { jurisdiction: true } } } });
      const env = await prisma.$transaction(async (tx) => {
        const created = await tx.envelope.create({
          data: {
            orgId: req.auth.orgId,
            createdById: user.id,
            title: title || 'Document to sign',
            jurisdiction: user.org.jurisdiction,
            routing: 'PARALLEL',
            selfSign: true,
            recipients: { create: { name: user.name, email: user.email, locale: user.locale, role: 'SIGNER', routingOrder: 1, hostUserId: user.id } },
          },
        });
        await appendAudit(tx, { envelopeId: created.id, type: 'envelope.created', actor: req.auth.actor, data: { title: created.title, selfSign: true }, ...clientInfo(req) });
        return created;
      });
      reply.code(201);
      return serializeEnvelope(await getVisibleEnvelope(req.auth, env.id));
    });

    /** Sends the self-sign draft (free, no emails) and opens a signing session in this browser. */
    r.post('/self-sign/:id/start', async (req, reply) => {
      const { id } = req.params as { id: string };
      const env = await getVisibleEnvelope(req.auth, id);
      if (!env.selfSign) throw badRequest('This agreement is not one you sign yourself.');
      const me = env.recipients.find((x) => x.hostUserId === req.auth.userId);
      if (!me) throw forbidden('Only the person who started this can sign it.');
      if (env.status === 'DRAFT') {
        if (!env.fields.some((f) => f.recipientId === me.id && f.type === 'SIGNATURE')) throw badRequest('Place at least one signature field first.');
        await sendEnvelope(req.auth.orgId, id, req.auth.actor, clientInfo(req));
      }
      const fresh = await prisma.recipient.findUniqueOrThrow({ where: { id: me.id } });
      if (fresh.status === 'SIGNED') throw conflict('You have already signed this document.');
      return startHostSession(req, reply, id, fresh);
    });
  });

  // --- Signer, after completion: certificate and "send it back" ------------------

  app.get('/signing/:token/certificate', async (req, reply) => {
    const r = await loadByToken((req.params as { token: string }).token);
    requireSession(req, r);
    if (r.envelope.status !== 'COMPLETED' || !r.envelope.certificateKey) throw notFound('Certificate');
    reply.header('Content-Type', 'application/pdf').header('Cache-Control', 'private, no-store');
    return getObject(r.envelope.certificateKey);
  });

  /** Self-signers email the sealed PDF and certificate to whoever asked for it (e.g. HR). */
  app.post('/signing/:token/share', strict, async (req) => {
    const { token } = req.params as { token: string };
    const body = parse(
      z.object({ to: z.array(z.string().trim().toLowerCase().email()).min(1).max(5), message: z.string().trim().max(1000).optional() }),
      req.body,
    );
    const r = await loadByToken(token);
    requireSession(req, r);
    if (!r.envelope.selfSign) throw forbidden('Only documents you signed yourself can be sent from here.');
    if (r.envelope.status !== 'COMPLETED' || r.envelope.documents.some((d) => !d.finalKey)) throw conflict('The signed copy is still being sealed. Try again in a moment.');
    const attachments = [
      ...(await Promise.all(r.envelope.documents.map(async (d) => ({ filename: `${d.name.replace(/\.[^.]+$/, '')} (signed).pdf`, content: await getObject(d.finalKey!), contentType: 'application/pdf' })))),
      ...(r.envelope.certificateKey ? [{ filename: 'Certificate of Completion.pdf', content: await getObject(r.envelope.certificateKey), contentType: 'application/pdf' }] : []),
    ];
    const { html, text } = layout({
      heading: `${r.name} signed "${r.envelope.title}"`,
      paragraphs: [
        `${r.name} (${r.email}) signed the attached document electronically.`,
        ...(body.message ? [body.message] : []),
        'The signed PDF carries a digital seal and a certificate of completion. You can check it is authentic on our verification page.',
      ],
      button: { label: 'Verify the document', url: `${config.appUrl}/verify` },
    });
    for (const to of body.to) {
      await sendMail({ to, subject: `Signed: ${r.envelope.title}`, html, text, attachments, orgId: r.envelope.orgId });
    }
    await prisma.$transaction((tx) =>
      appendAudit(tx, { envelopeId: r.envelopeId, type: 'envelope.shared', actor: actorOf(r), data: { to: body.to }, ...clientInfo(req) }),
    );
    return { sent: body.to.length };
  });
}
