import { BlockList, isIP } from 'node:net';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { open } from '../lib/secretbox.js';

/**
 * Per-organisation delivery settings: the base URL for signing links (custom
 * domain once verified), the email sender identity (DKIM-signed mail from the
 * organisation's own domain once verified), and the IP allowlist.
 * Lookups are cached briefly because they run for every email and request.
 */

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Drop cached settings after an admin changes them. */
export const forgetOrgSettings = (orgId: string) => {
  for (const k of cache.keys()) if (k.endsWith(`:${orgId}`)) cache.delete(k);
};

/** Origin for links in emails: the verified custom domain, or the app URL. */
export function appBaseFor(orgId: string): Promise<string> {
  return cached(`base:${orgId}`, async () => {
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { customDomain: true, customDomainVerifiedAt: true } });
    return org?.customDomain && org.customDomainVerifiedAt ? `https://${org.customDomain}` : config.appUrl;
  });
}

const platformAddress = () => /<([^>]+)>/.exec(config.smtp.from)?.[1] ?? config.smtp.from;
const quote = (name: string) => `"${name.replace(/["\\\r\n]/g, '')}"`;

export interface MailIdentity {
  from: string;
  replyTo?: string;
  dkim?: { domainName: string; keySelector: string; privateKey: string };
}

/**
 * Sender identity for an organisation's emails. Without a verified domain the
 * mail comes from the platform address with the organisation's name
 * ("Acme via Nuronix eSign"); with one it comes from no-reply@<their domain>, DKIM-signed.
 */
export function mailIdentityFor(orgId: string): Promise<MailIdentity> {
  return cached(`mail:${orgId}`, async () => {
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return { from: config.smtp.from };
    const name = org.emailFromName || org.name;
    const replyTo = org.emailReplyTo ?? undefined;
    if (org.emailDomain && org.emailDomainVerifiedAt && org.dkimPrivateKeyEnc && org.dkimSelector) {
      return {
        from: `${quote(name)} <no-reply@${org.emailDomain}>`,
        replyTo,
        dkim: { domainName: org.emailDomain, keySelector: org.dkimSelector, privateKey: open(org.dkimPrivateKeyEnc) },
      };
    }
    return { from: `${quote(`${name} via Nuronix eSign`)} <${platformAddress()}>`, replyTo };
  });
}

/** True when `ip` falls inside one of the CIDR ranges (or the list is empty). */
export function ipAllowed(ip: string, cidrs: string[]): boolean {
  if (!cidrs.length) return true;
  const list = new BlockList();
  for (const c of cidrs) {
    const [addr, bits] = c.split('/');
    const family = isIP(addr) === 6 ? 'ipv6' : 'ipv4';
    list.addSubnet(addr, Number(bits ?? (family === 'ipv6' ? 128 : 32)), family);
  }
  // IPv4 clients may appear as IPv4-mapped IPv6 addresses
  const plain = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const family = isIP(plain) === 6 ? 'ipv6' : 'ipv4';
  return list.check(plain, family);
}

/** Validates a CIDR (or single address) entry. */
export function isCidr(entry: string): boolean {
  const [addr, bits, extra] = entry.split('/');
  if (extra !== undefined) return false;
  const v = isIP(addr);
  if (!v) return false;
  if (bits === undefined) return true;
  const n = Number(bits);
  return Number.isInteger(n) && n >= 0 && n <= (v === 6 ? 128 : 32);
}

export function orgIpAllowlist(orgId: string): Promise<string[]> {
  return cached(`ip:${orgId}`, async () => (await prisma.organization.findUnique({ where: { id: orgId }, select: { ipAllowlist: true } }))?.ipAllowlist ?? []);
}
