import { generateKeyPairSync } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { appendAudit } from '../audit/audit.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { getVisibleEnvelope } from '../envelopes/service.js';
import { logActivity } from '../lib/activity.js';
import { clientInfo, requireAuth, requireRole } from '../lib/auth.js';
import { randomToken } from '../lib/crypto.js';
import { badRequest, conflict } from '../lib/errors.js';
import { seal } from '../lib/secretbox.js';
import { forgetCustomerKeys } from '../lib/storage.js';
import { parse } from '../lib/validate.js';
import type { ResolvedPolicy } from '../policy/engine.js';
import { forgetOrgSettings, ipAllowed, isCidr } from './delivery.js';
import { purgeEnvelope } from './retention.js';

const DOMAIN = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const KMS_ARN = /^arn:aws[\w-]*:kms:[a-z0-9-]+:\d{12}:(key|alias)\/[\w/-]+$/;
const csv = (v: unknown) => {
  const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** TXT records joined per record, lowercased; empty on lookup failure. */
async function txt(name: string): Promise<string[]> {
  try {
    return (await resolveTxt(name)).map((parts) => parts.join(''));
  } catch {
    return [];
  }
}

export const dkimRecordName = (selector: string, domain: string) => `${selector}._domainkey.${domain}`;
export const domainVerifyName = (domain: string) => `_docsign-verify.${domain}`;

export async function governanceRoutes(app: FastifyInstance) {
  /** For a TLS proxy (e.g. Caddy on-demand TLS): only verified custom domains get certificates. */
  app.get('/domains/check', async (req, reply) => {
    const { domain } = req.query as { domain?: string };
    const org = domain ? await prisma.organization.findUnique({ where: { customDomain: domain.toLowerCase() }, select: { customDomainVerifiedAt: true } }) : null;
    if (!org?.customDomainVerifiedAt) return reply.code(404).send({ ok: false });
    return { ok: true };
  });

  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);

    /** Any user who can see the agreement can export its audit trail. */
    r.get('/envelopes/:id/audit.csv', async (req, reply) => {
      const { id } = req.params as { id: string };
      const env = await getVisibleEnvelope(req.auth, id);
      const events = await prisma.auditEvent.findMany({ where: { envelopeId: env.id }, orderBy: { seq: 'asc' } });
      const rows = [['seq', 'time', 'type', 'actor', 'ip', 'user_agent', 'data', 'hash', 'prev_hash'].join(',')];
      for (const e of events) rows.push([e.seq, e.createdAt.toISOString(), e.type, e.actor, e.ip, e.userAgent, e.data, e.hash, e.prevHash].map(csv).join(','));
      reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="audit-${env.id}.csv"`);
      return rows.join('\n') + '\n';
    });
  });

  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);
    r.addHook('preHandler', requireRole('OWNER', 'ADMIN'));

    r.get('/governance', async (req) => {
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.auth.orgId } });
      return {
        retentionDays: org.retentionDays,
        purgeIncompleteDays: org.purgeIncompleteDays,
        ipAllowlist: org.ipAllowlist,
        yourIp: req.ip,
        email: {
          fromName: org.emailFromName,
          replyTo: org.emailReplyTo,
          domain: org.emailDomain,
          verified: Boolean(org.emailDomainVerifiedAt),
          dns:
            org.emailDomain && org.dkimSelector && org.dkimPublicKey
              ? [
                  { type: 'TXT', name: dkimRecordName(org.dkimSelector, org.emailDomain), value: `v=DKIM1; k=rsa; p=${org.dkimPublicKey}` },
                  { type: 'TXT', name: org.emailDomain, value: 'v=spf1 include:<your email provider> ~all', note: 'Add your SMTP provider to the existing SPF record' },
                ]
              : [],
        },
        customDomain: {
          domain: org.customDomain,
          verified: Boolean(org.customDomainVerifiedAt),
          dns: org.customDomain
            ? [
                { type: 'TXT', name: domainVerifyName(org.customDomain), value: org.customDomainToken },
                { type: 'CNAME', name: org.customDomain, value: new URL(config.appUrl).hostname },
              ]
            : [],
        },
        storageKmsKeyId: org.storageKmsKeyId,
      };
    });

    r.put('/governance/retention', async (req) => {
      const body = parse(z.object({ retentionDays: z.number().int().min(30).max(36_500).nullable(), purgeIncompleteDays: z.number().int().min(7).max(3650).nullable() }), req.body);
      await prisma.organization.update({ where: { id: req.auth.orgId }, data: body });
      await logActivity(req, 'governance.retention_updated', body);
      return body;
    });

    r.put('/governance/ip-allowlist', async (req) => {
      const { cidrs } = parse(z.object({ cidrs: z.array(z.string().trim()).max(100) }), req.body);
      const bad = cidrs.find((c) => !isCidr(c));
      if (bad) throw badRequest(`"${bad}" is not an IP address or CIDR range.`);
      // Saving a list that excludes you would lock you out on the next request
      if (cidrs.length && !ipAllowed(req.ip, cidrs)) throw badRequest(`Your current address (${req.ip}) is not in the list. Add it first.`);
      await prisma.organization.update({ where: { id: req.auth.orgId }, data: { ipAllowlist: cidrs } });
      forgetOrgSettings(req.auth.orgId);
      await logActivity(req, 'governance.ip_allowlist_updated', { cidrs });
      return { cidrs };
    });

    r.put('/governance/email', async (req) => {
      const body = parse(
        z.object({
          fromName: z.string().trim().max(80).nullable().optional(),
          replyTo: z.string().trim().toLowerCase().email().nullable().optional(),
          domain: z.string().trim().toLowerCase().regex(DOMAIN, 'Enter a domain like example.com').nullable().optional(),
        }),
        req.body,
      );
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.auth.orgId } });
      const data: Record<string, unknown> = { emailFromName: body.fromName, emailReplyTo: body.replyTo };
      if (body.domain !== undefined && body.domain !== org.emailDomain) {
        if (body.domain) {
          // New DKIM key per domain; the private key is sealed at rest
          const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'der' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
          const now = new Date();
          Object.assign(data, {
            emailDomain: body.domain,
            dkimSelector: `docsign${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`,
            dkimPublicKey: Buffer.from(publicKey).toString('base64'),
            dkimPrivateKeyEnc: seal(privateKey),
            emailDomainVerifiedAt: null,
          });
        } else {
          Object.assign(data, { emailDomain: null, dkimSelector: null, dkimPublicKey: null, dkimPrivateKeyEnc: null, emailDomainVerifiedAt: null });
        }
      }
      await prisma.organization.update({ where: { id: req.auth.orgId }, data });
      forgetOrgSettings(req.auth.orgId);
      await logActivity(req, 'governance.email_updated', { fromName: body.fromName, replyTo: body.replyTo, domain: body.domain });
      return { ok: true };
    });

    r.post('/governance/email/verify', async (req) => {
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.auth.orgId } });
      if (!org.emailDomain || !org.dkimSelector || !org.dkimPublicKey) throw badRequest('Set a sending domain first.');
      const records = await txt(dkimRecordName(org.dkimSelector, org.emailDomain));
      const found = records.some((r) => r.replace(/\s/g, '').includes(`p=${org.dkimPublicKey}`));
      if (!found) throw badRequest(`The DKIM record was not found at ${dkimRecordName(org.dkimSelector, org.emailDomain)}. DNS changes can take up to an hour.`);
      await prisma.organization.update({ where: { id: org.id }, data: { emailDomainVerifiedAt: new Date() } });
      forgetOrgSettings(org.id);
      await logActivity(req, 'governance.email_domain_verified', { domain: org.emailDomain });
      return { verified: true };
    });

    r.put('/governance/domain', async (req) => {
      const { domain } = parse(z.object({ domain: z.string().trim().toLowerCase().regex(DOMAIN, 'Enter a domain like sign.example.com').nullable() }), req.body);
      if (domain && domain === new URL(config.appUrl).hostname) throw badRequest('Use a domain of your own.');
      if (domain && (await prisma.organization.findFirst({ where: { customDomain: domain, id: { not: req.auth.orgId } } }))) throw conflict('That domain is used by another organisation.');
      await prisma.organization.update({
        where: { id: req.auth.orgId },
        data: { customDomain: domain, customDomainToken: domain ? `docsign-verify=${randomToken(18)}` : null, customDomainVerifiedAt: null },
      });
      forgetOrgSettings(req.auth.orgId);
      await logActivity(req, 'governance.domain_updated', { domain });
      return { domain };
    });

    r.post('/governance/domain/verify', async (req) => {
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.auth.orgId } });
      if (!org.customDomain || !org.customDomainToken) throw badRequest('Set a custom domain first.');
      const records = await txt(domainVerifyName(org.customDomain));
      if (!records.includes(org.customDomainToken)) throw badRequest(`The TXT record was not found at ${domainVerifyName(org.customDomain)}. DNS changes can take up to an hour.`);
      await prisma.organization.update({ where: { id: org.id }, data: { customDomainVerifiedAt: new Date() } });
      forgetOrgSettings(org.id);
      await logActivity(req, 'governance.domain_verified', { domain: org.customDomain });
      return { verified: true };
    });

    r.put('/governance/kms', async (req) => {
      const { storageKmsKeyId } = parse(z.object({ storageKmsKeyId: z.string().trim().regex(KMS_ARN, 'Use a KMS key or alias ARN').nullable() }), req.body);
      await prisma.organization.update({ where: { id: req.auth.orgId }, data: { storageKmsKeyId } });
      forgetCustomerKeys();
      await logActivity(req, 'governance.kms_updated', { storageKmsKeyId });
      return { storageKmsKeyId };
    });

    // --- Legal hold and deletion ------------------------------------------------

    r.post('/envelopes/:id/legal-hold', async (req) => {
      const { id } = req.params as { id: string };
      const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(500) }), req.body);
      const env = await getVisibleEnvelope(req.auth, id);
      await prisma.$transaction(async (tx) => {
        await tx.envelope.update({ where: { id: env.id }, data: { legalHoldAt: new Date(), legalHoldReason: reason, legalHoldBy: req.auth.userId } });
        await appendAudit(tx, { envelopeId: env.id, type: 'envelope.legal_hold_placed', actor: req.auth.actor, data: { reason }, ...clientInfo(req) });
      });
      await logActivity(req, 'envelope.legal_hold_placed', { envelopeId: env.id, reason });
      return { legalHold: true, reason };
    });

    r.delete('/envelopes/:id/legal-hold', async (req) => {
      const { id } = req.params as { id: string };
      const env = await getVisibleEnvelope(req.auth, id);
      if (!env.legalHoldAt) return { legalHold: false };
      await prisma.$transaction(async (tx) => {
        await tx.envelope.update({ where: { id: env.id }, data: { legalHoldAt: null, legalHoldReason: null, legalHoldBy: null } });
        await appendAudit(tx, { envelopeId: env.id, type: 'envelope.legal_hold_released', actor: req.auth.actor, ...clientInfo(req) });
      });
      await logActivity(req, 'envelope.legal_hold_released', { envelopeId: env.id });
      return { legalHold: false };
    });

    /** Permanently deletes an agreement (not on hold, and past the legal retention if it was completed). */
    r.delete('/envelopes/:id/permanently', async (req, reply) => {
      const { id } = req.params as { id: string };
      const env = await getVisibleEnvelope(req.auth, id);
      if (env.legalHoldAt) throw conflict('This agreement is on legal hold.');
      if (env.status === 'SENT') throw conflict('Void the agreement before deleting it.');
      const policy = env.policy as unknown as ResolvedPolicy | null;
      if (env.status === 'COMPLETED' && env.completedAt && policy?.retentionYears) {
        const until = new Date(env.completedAt.getTime() + policy.retentionYears * 365 * 24 * 3600_000);
        if (until > new Date()) throw conflict(`Signed agreements must be kept until ${until.toISOString().slice(0, 10)} under ${policy.jurisdictionName} rules.`);
      }
      const done = await purgeEnvelope(env, 'manual', req.auth.actor);
      if (!done) throw conflict('Some files are still under a storage retention lock. Try again after it expires.');
      reply.code(204);
    });

    // --- Exports ------------------------------------------------------------------

    r.get('/activity/export.csv', async (req, reply) => {
      const q = parse(z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }), req.query);
      const rows = await prisma.activityLog.findMany({
        where: { orgId: req.auth.orgId, createdAt: { gte: q.from, lte: q.to } },
        orderBy: { createdAt: 'asc' },
        take: 50_000,
      });
      const lines = [['time', 'type', 'actor', 'ip', 'data'].join(',')];
      for (const a of rows) lines.push([a.createdAt.toISOString(), a.type, a.actor, a.ip, a.data].map(csv).join(','));
      reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="activity.csv"');
      return lines.join('\n') + '\n';
    });

    /** Every agreement event in a period as JSON lines, for SIEM or archive tools. */
    r.get('/audit/export', async (req, reply) => {
      const q = parse(z.object({ from: z.coerce.date(), to: z.coerce.date().optional() }), req.query);
      const events = await prisma.auditEvent.findMany({
        where: { envelope: { orgId: req.auth.orgId }, createdAt: { gte: q.from, lte: q.to ?? new Date() } },
        orderBy: [{ createdAt: 'asc' }, { seq: 'asc' }],
        take: 100_000,
      });
      reply.header('Content-Type', 'application/x-ndjson').header('Content-Disposition', 'attachment; filename="audit.ndjson"');
      return events.map((e) => JSON.stringify({ envelopeId: e.envelopeId, seq: e.seq, time: e.createdAt, type: e.type, actor: e.actor, ip: e.ip, data: e.data, hash: e.hash, prevHash: e.prevHash })).join('\n') + '\n';
    });
  });

}
