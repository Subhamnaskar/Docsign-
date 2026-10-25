import type { User } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { layout, sendMail } from '../lib/mailer.js';

/**
 * Who may use the platform console. People in PLATFORM_ADMINS are owners and
 * manage the rest of the console team (PlatformAdmin rows): admins can do
 * everything else, viewers only look.
 */
export type PlatformRole = 'owner' | 'admin' | 'viewer';

const isOwnerEmail = (email: string) => config.platformAdmins.includes(email.toLowerCase());

/** The user's console role, or null. Requires a confirmed email (and two-factor in production). */
export async function platformRole(user: Pick<User, 'email' | 'emailVerifiedAt' | 'totpEnabledAt' | 'disabledAt'>): Promise<PlatformRole | null> {
  if (!user.emailVerifiedAt || user.disabledAt || (config.isProduction && !user.totpEnabledAt)) return null;
  if (isOwnerEmail(user.email)) return 'owner';
  const row = await prisma.platformAdmin.findUnique({ where: { email: user.email.toLowerCase() } });
  return row ? (row.role === 'admin' ? 'admin' : 'viewer') : null;
}

/** Console team members who get alert emails. */
async function alertRecipients(): Promise<string[]> {
  const rows = await prisma.platformAdmin.findMany({ where: { alerts: true }, select: { email: true } });
  return [...new Set([...config.platformAdmins, ...rows.map((r) => r.email)])];
}

/**
 * Emails the console team about something that needs attention. Never throws:
 * an alert must not break the request that triggered it.
 */
export async function notifyPlatform(subject: string, paragraphs: string[], link?: { label: string; path: string }) {
  try {
    const to = await alertRecipients();
    if (!to.length) return;
    const { html, text } = layout({
      heading: subject,
      paragraphs,
      button: link && { label: link.label, url: `${config.appUrl}${link.path}` },
      footer: 'You get this because you are on the NuronixAI console team. Turn alerts off in the platform console under Team.',
    });
    await Promise.all(to.map((email) => sendMail({ to: email, subject: `[Console] ${subject}`, html, text })));
  } catch {
    // Alerts are best-effort
  }
}
