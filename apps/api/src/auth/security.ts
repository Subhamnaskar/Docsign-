import bcrypt from 'bcryptjs';
import type { User } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { logActivity } from '../lib/activity.js';
import { createSession, requireAuth } from '../lib/auth.js';
import { sha256Hex } from '../lib/crypto.js';
import { badRequest, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { layout, sendMail } from '../lib/mailer.js';
import { open, seal } from '../lib/secretbox.js';
import { newRecoveryCodes, newTotpSecret, normalizeRecoveryCode, otpauthUri, verifyTotp } from '../lib/totp.js';
import { parse } from '../lib/validate.js';
import { ssoOrgForEmail } from '../sso/routes.js';
import { consumeToken, issueToken, MFA_MAX_ATTEMPTS, peekToken, sendSecurityNotice, sendVerificationEmail } from './tokens.js';

export const passwordSchema = z.string().min(10, 'Use at least 10 characters').max(200);
const code = z.string().trim().min(6).max(20);

/** Users created through SSO or SCIM have no usable password. */
export const isSsoOnly = (u: Pick<User, 'passwordHash'>) => u.passwordHash.startsWith('sso:');

/** Checks a TOTP code or burns a recovery code. */
async function checkSecondFactor(user: User, input: string): Promise<boolean> {
  if (!user.totpSecretEnc) return false;
  if (/^\d{6}$/.test(input.replace(/\s/g, ''))) return verifyTotp(open(user.totpSecretEnc), input);
  const hash = sha256Hex(normalizeRecoveryCode(input));
  if (!user.recoveryCodeHashes.includes(hash)) return false;
  await prisma.user.update({ where: { id: user.id }, data: { recoveryCodeHashes: user.recoveryCodeHashes.filter((h) => h !== hash) } });
  return true;
}

const hashCodes = (codes: string[]) => codes.map((c) => sha256Hex(normalizeRecoveryCode(c)));

export async function securityRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } };

  // --- Email verification ------------------------------------------------------

  app.post('/auth/verify-email', strict, async (req) => {
    const { token } = parse(z.object({ token: z.string().min(10) }), req.body);
    const user = await consumeToken(token, 'VERIFY_EMAIL');
    if (!user) throw badRequest('This link is invalid or has expired. Sign in and request a new one.');
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: user.emailVerifiedAt ?? new Date() } });
    return { ok: true, email: user.email };
  });

  // --- Password reset ----------------------------------------------------------

  /** Always answers the same way, so it doesn't reveal which emails have accounts. */
  app.post('/auth/password/forgot', strict, async (req) => {
    const { email } = parse(z.object({ email: z.string().trim().toLowerCase().email() }), req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && !user.disabledAt) {
      const sso = await ssoOrgForEmail(email);
      if (sso?.ssoEnforced && sso.id === user.orgId && user.role !== 'OWNER') {
        const { html, text } = layout({
          heading: 'Sign in with single sign-on',
          paragraphs: ['Your organisation signs in through its identity provider, so there is no password to reset. Use "Sign in with SSO" on the login page.'],
          button: { label: 'Go to sign in', url: `${config.appUrl}/login` },
        });
        await sendMail({ to: email, subject: 'How to sign in', html, text });
      } else {
        const token = await issueToken(user.id, 'RESET_PASSWORD');
        const { html, text } = layout({
          heading: 'Reset your password',
          paragraphs: [`Hi ${user.name}, use the button below to choose a new password. The link expires in 1 hour.`, "If you didn't ask for this, you can ignore this email."],
          button: { label: 'Choose a new password', url: `${config.appUrl}/reset-password/${token}` },
        });
        await sendMail({ to: email, subject: 'Reset your password', html, text });
      }
    }
    return { ok: true };
  });

  app.post('/auth/password/reset', strict, async (req) => {
    const body = parse(z.object({ token: z.string().min(10), password: passwordSchema }), req.body);
    const user = await consumeToken(body.token, 'RESET_PASSWORD');
    if (!user) throw badRequest('This link is invalid or has expired. Request a new one.');
    // Following the emailed link also proves the address
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(body.password, 12), emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
    });
    // Signs out every device: whoever had the old password loses access
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await sendSecurityNotice(user, 'Your password was changed');
    return { ok: true };
  });

  // --- Second login step ---------------------------------------------------------

  app.post('/auth/login/mfa', strict, async (req, reply) => {
    const body = parse(z.object({ token: z.string().min(10), code }), req.body);
    const t = await peekToken(body.token, 'MFA_LOGIN');
    if (!t || t.attempts >= MFA_MAX_ATTEMPTS) throw unauthorized('This sign-in has expired. Enter your password again.');
    if (!(await checkSecondFactor(t.user, body.code))) {
      await prisma.authToken.update({ where: { id: t.id }, data: { attempts: { increment: 1 } } });
      throw unauthorized('That code is not correct.');
    }
    if (!(await consumeToken(body.token, 'MFA_LOGIN'))) throw unauthorized('This sign-in has expired. Enter your password again.');
    await createSession(reply, t.user.id);
    return { id: t.user.id, name: t.user.name, email: t.user.email };
  });

  // --- Signed-in account security ----------------------------------------------

  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);
    const me = async (userId: string | null) => {
      if (!userId) throw forbidden('Sign in as a user to manage account security.');
      return prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { org: true } });
    };

    r.post('/auth/verify-email/resend', strict, async (req) => {
      const user = await me(req.auth.userId);
      if (user.emailVerifiedAt) return { ok: true, alreadyVerified: true };
      await sendVerificationEmail(user);
      return { ok: true };
    });

    r.post('/auth/password/change', strict, async (req) => {
      const body = parse(z.object({ currentPassword: z.string(), newPassword: passwordSchema }), req.body);
      const user = await me(req.auth.userId);
      if (isSsoOnly(user)) throw badRequest('You sign in with single sign-on, so there is no password to change.');
      if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) throw badRequest('Your current password is not correct.');
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(body.newPassword, 12) } });
      // Other devices are signed out; this one stays signed in
      await prisma.session.deleteMany({ where: { userId: user.id, id: { not: req.auth.sessionId ?? '' } } });
      await sendSecurityNotice(user, 'Your password was changed');
      await logActivity(req, 'user.password_changed', { userId: user.id });
      return { ok: true };
    });

    r.get('/auth/2fa', async (req) => {
      const user = await me(req.auth.userId);
      return {
        enabled: Boolean(user.totpEnabledAt),
        enabledAt: user.totpEnabledAt,
        recoveryCodesLeft: user.recoveryCodeHashes.length,
        required: user.org.require2fa && !isSsoOnly(user),
        ssoOnly: isSsoOnly(user),
      };
    });

    /** Starts setup: a new secret to scan, confirmed by /enable. */
    r.post('/auth/2fa/setup', async (req) => {
      const user = await me(req.auth.userId);
      if (isSsoOnly(user)) throw badRequest('You sign in with single sign-on; two-factor authentication is handled by your identity provider.');
      if (user.totpEnabledAt) throw badRequest('Two-factor authentication is already on. Turn it off first to use a new device.');
      const secret = newTotpSecret();
      await prisma.user.update({ where: { id: user.id }, data: { totpPendingEnc: seal(secret) } });
      const uri = otpauthUri(secret, user.email, 'DocSign');
      return { secret, otpauthUri: uri, qrSvg: await QRCode.toString(uri, { type: 'svg', margin: 1, width: 200 }) };
    });

    r.post('/auth/2fa/enable', async (req) => {
      const body = parse(z.object({ code }), req.body);
      const user = await me(req.auth.userId);
      if (!user.totpPendingEnc) throw badRequest('Start setup first.');
      if (!verifyTotp(open(user.totpPendingEnc), body.code)) throw badRequest('That code is not correct. Check the time on your phone and try again.');
      const codes = newRecoveryCodes();
      await prisma.user.update({
        where: { id: user.id },
        data: { totpSecretEnc: user.totpPendingEnc, totpPendingEnc: null, totpEnabledAt: new Date(), recoveryCodeHashes: hashCodes(codes) },
      });
      await sendSecurityNotice(user, 'Two-factor authentication was enabled');
      await logActivity(req, 'user.2fa_enabled', { userId: user.id });
      return { recoveryCodes: codes };
    });

    r.post('/auth/2fa/recovery-codes', strict, async (req) => {
      const body = parse(z.object({ code }), req.body);
      const user = await me(req.auth.userId);
      if (!user.totpEnabledAt || !(await checkSecondFactor(user, body.code))) throw badRequest('That code is not correct.');
      const codes = newRecoveryCodes();
      await prisma.user.update({ where: { id: user.id }, data: { recoveryCodeHashes: hashCodes(codes) } });
      return { recoveryCodes: codes };
    });

    r.post('/auth/2fa/disable', strict, async (req) => {
      const body = parse(z.object({ password: z.string(), code }), req.body);
      const user = await me(req.auth.userId);
      if (!user.totpEnabledAt) return { ok: true };
      if (user.org.require2fa) throw forbidden('Your organisation requires two-factor authentication.');
      if (!(await bcrypt.compare(body.password, user.passwordHash)) || !(await checkSecondFactor(user, body.code))) {
        throw badRequest('Your password or code is not correct.');
      }
      await prisma.user.update({ where: { id: user.id }, data: { totpSecretEnc: null, totpPendingEnc: null, totpEnabledAt: null, recoveryCodeHashes: [] } });
      await sendSecurityNotice(user, 'Two-factor authentication was disabled');
      await logActivity(req, 'user.2fa_disabled', { userId: user.id });
      return { ok: true };
    });

    r.get('/auth/sessions', async (req) => {
      const user = await me(req.auth.userId);
      const sessions = await prisma.session.findMany({ where: { userId: user.id, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: 'desc' } });
      return sessions.map((s) => ({ id: s.id, ip: s.ip, userAgent: s.userAgent, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, current: s.id === req.auth.sessionId }));
    });

    r.delete('/auth/sessions/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const res = await prisma.session.deleteMany({ where: { id, userId: req.auth.userId ?? '' } });
      if (!res.count) throw notFound('Session');
      reply.code(204);
    });

    r.post('/auth/sessions/revoke-others', async (req) => {
      const res = await prisma.session.deleteMany({ where: { userId: req.auth.userId ?? '', id: { not: req.auth.sessionId ?? '' } } });
      return { revoked: res.count };
    });
  });
}
