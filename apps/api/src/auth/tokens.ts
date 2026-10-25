import type { AuthTokenKind, User } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';
import { layout, sendMail } from '../lib/mailer.js';

const TTL_MS: Record<AuthTokenKind, number> = {
  VERIFY_EMAIL: 3 * 24 * 3600_000,
  RESET_PASSWORD: 3600_000,
  MFA_LOGIN: 5 * 60_000,
};
/** Wrong second-factor codes allowed per login attempt */
export const MFA_MAX_ATTEMPTS = 5;

/** Issues a single-use token, replacing any open token of the same kind. */
export async function issueToken(userId: string, kind: AuthTokenKind): Promise<string> {
  const token = randomToken();
  await prisma.$transaction([
    prisma.authToken.deleteMany({ where: { userId, kind, usedAt: null } }),
    prisma.authToken.create({ data: { userId, kind, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + TTL_MS[kind]) } }),
  ]);
  return token;
}

/** Finds an open token without using it up (for the MFA step, which allows retries). */
export async function peekToken(token: string, kind: AuthTokenKind) {
  const t = await prisma.authToken.findUnique({ where: { tokenHash: sha256Hex(token) }, include: { user: true } });
  if (!t || t.kind !== kind || t.usedAt || t.expiresAt < new Date()) return null;
  return t;
}

/** Uses up a token exactly once; returns its user, or null if invalid, expired or already used. */
export async function consumeToken(token: string, kind: AuthTokenKind) {
  const t = await peekToken(token, kind);
  if (!t) return null;
  const claimed = await prisma.authToken.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: new Date() } });
  return claimed.count ? t.user : null;
}

export async function sendVerificationEmail(user: Pick<User, 'id' | 'email' | 'name'>) {
  const token = await issueToken(user.id, 'VERIFY_EMAIL');
  const { html, text } = layout({
    heading: 'Confirm your email address',
    paragraphs: [`Hi ${user.name}, confirm this is your email address to start sending agreements.`, 'The link expires in 3 days.'],
    button: { label: 'Confirm email', url: `${config.appUrl}/verify-email/${token}` },
  });
  await sendMail({ to: user.email, subject: 'Confirm your email address', html, text });
}

/** Security notices (password changed, two-factor turned on or off). */
export async function sendSecurityNotice(user: Pick<User, 'email' | 'name'>, what: string) {
  const { html, text } = layout({
    heading: what,
    paragraphs: [
      `Hi ${user.name}, this is a confirmation that ${what.charAt(0).toLowerCase()}${what.slice(1)} on your account.`,
      "If this wasn't you, reset your password straight away and contact your administrator.",
    ],
    button: { label: 'Review account security', url: `${config.appUrl}/settings?tab=security` },
  });
  await sendMail({ to: user.email, subject: `Security notice: ${what.toLowerCase()}`, html, text });
}
