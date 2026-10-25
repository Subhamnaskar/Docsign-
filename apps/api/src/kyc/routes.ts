import formbody from '@fastify/formbody';
import type { KycCheck, Recipient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { appendAudit } from '../audit/audit.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { getVisibleEnvelope } from '../envelopes/service.js';
import { requireAuth, signingToken } from '../lib/auth.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';
import { badRequest, HttpError, notFound } from '../lib/errors.js';
import { assertClean } from '../lib/malware.js';
import { getObject, putObject } from '../lib/storage.js';
import { parse } from '../lib/validate.js';
import { actorOf, loadByToken, requireReady, requireSession } from '../signing/routes.js';
import { type IdCheck, NAME_MATCH_THRESHOLD, nameMatch } from './names.js';
import {
  type AadhaarKyc,
  digilockerAuthorizeUrl,
  digilockerExchange,
  IFSC_PATTERN,
  maskAccount,
  maskPan,
  PAN_PATTERN,
  pkcePair,
  sandboxDigilockerCode,
  verifyBankAccount,
  verifyPan,
} from './providers.js';


const MAX_VIDEO_BYTES = 15 * 1024 * 1024;
const VIDEO_CHALLENGE_TTL_MS = 10 * 60_000;
const ATTEMPTS_PER_CHECK = 5;

/** Latest result per check kind for a recipient. */
async function latestChecks(recipientId: string): Promise<Map<string, KycCheck>> {
  const rows = await prisma.kycCheck.findMany({ where: { recipientId, status: { not: 'PENDING' } }, orderBy: { createdAt: 'asc' } });
  return new Map(rows.map((r) => [r.kind, r]));
}

/** What the signing page shows: required checks and their outcome (no identifiers beyond masked ones). */
export async function kycSummary(r: Pick<Recipient, 'id' | 'idChecks'>) {
  if (!r.idChecks.length) return [];
  const latest = await latestChecks(r.id);
  return r.idChecks.map((kind) => {
    const c = latest.get(kind);
    return { kind, status: c?.status ?? 'NOT_STARTED', nameMatch: c?.nameMatch ?? null, data: c?.data ?? null };
  });
}

/** Signing can't finish until every required check has passed. */
export async function assertKycComplete(r: Pick<Recipient, 'id' | 'idChecks'>) {
  if (!r.idChecks.length) return;
  const latest = await latestChecks(r.id);
  const missing = r.idChecks.filter((k) => latest.get(k)?.status !== 'PASSED');
  if (missing.length) throw new HttpError(403, 'Complete the identity checks before signing.', 'kyc_required', { missing });
}

async function guardAttempts(recipientId: string, kind: string) {
  const failed = await prisma.kycCheck.count({ where: { recipientId, kind, status: 'FAILED' } });
  if (failed >= ATTEMPTS_PER_CHECK) throw new HttpError(429, 'Too many failed attempts. Contact the sender.', 'kyc_locked');
}

async function record(
  r: Recipient,
  kind: IdCheck,
  provider: string,
  outcome: { passed: boolean; nameMatch?: number | null; data: Record<string, unknown>; providerRef?: string | null; storageKey?: string; sha256?: string },
  client: { ip?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const check = await tx.kycCheck.create({
      data: {
        envelopeId: r.envelopeId,
        recipientId: r.id,
        kind,
        provider,
        status: outcome.passed ? 'PASSED' : 'FAILED',
        nameMatch: outcome.nameMatch ?? null,
        data: outcome.data as object,
        providerRef: outcome.providerRef ?? null,
        storageKey: outcome.storageKey,
        sha256: outcome.sha256,
      },
    });
    await appendAudit(tx, {
      envelopeId: r.envelopeId,
      type: outcome.passed ? 'recipient.id_check_passed' : 'recipient.id_check_failed',
      actor: actorOf(r),
      data: { check: kind, provider, nameMatch: outcome.nameMatch ?? null, ...outcome.data },
      ...client,
    });
    return check;
  });
}

const client = (req: { ip: string; headers: Record<string, unknown> }) => ({ ip: req.ip, userAgent: (req.headers['user-agent'] as string | undefined) ?? null });

/** Requires the check to be one the sender asked for. */
function requireCheck(r: Recipient, kind: IdCheck) {
  if (!r.idChecks.includes(kind)) throw badRequest('This check is not required for this signing request.');
}

export async function kycRoutes(app: FastifyInstance) {
  await app.register(formbody);

  app.post('/signing/:token/kyc/pan', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const { token } = req.params as { token: string };
    const body = parse(z.object({ pan: z.string().trim().toUpperCase().regex(PAN_PATTERN, 'Enter a 10-character PAN like ABCDE1234F'), name: z.string().trim().min(1).max(120) }), req.body);
    const r = await loadByToken(token);
    requireReady(r);
    requireSession(req, r);
    requireCheck(r, 'PAN');
    await guardAttempts(r.id, 'PAN');
    const res = await verifyPan(body.pan, body.name);
    const score = res.registeredName ? nameMatch(res.registeredName, r.name) : 0;
    const passed = res.valid && score >= NAME_MATCH_THRESHOLD;
    const check = await record(
      r,
      'PAN',
      config.kyc.provider,
      { passed, nameMatch: score, providerRef: res.ref, data: { pan: maskPan(body.pan), holderType: res.holderType, registeredName: res.registeredName, panValid: res.valid } },
      client(req),
    );
    return { status: check.status, nameMatch: score, reason: !res.valid ? 'PAN not found' : passed ? null : `Name on PAN doesn't match ${r.name}` };
  });

  app.post('/signing/:token/kyc/bank', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const { token } = req.params as { token: string };
    const body = parse(
      z.object({
        accountNumber: z.string().trim().regex(/^\d{9,18}$/, 'Enter the account number (9 to 18 digits)'),
        ifsc: z.string().trim().toUpperCase().regex(IFSC_PATTERN, 'Enter an 11-character IFSC like HDFC0001234'),
        name: z.string().trim().min(1).max(120).optional(),
      }),
      req.body,
    );
    const r = await loadByToken(token);
    requireReady(r);
    requireSession(req, r);
    requireCheck(r, 'BANK');
    await guardAttempts(r.id, 'BANK');
    const res = await verifyBankAccount(body.accountNumber, body.ifsc, body.name ?? r.name);
    const score = res.nameAtBank ? nameMatch(res.nameAtBank, r.name) : 0;
    const passed = res.valid && score >= NAME_MATCH_THRESHOLD;
    const check = await record(
      r,
      'BANK',
      config.kyc.provider,
      { passed, nameMatch: score, providerRef: res.ref, data: { account: maskAccount(body.accountNumber), ifsc: body.ifsc, bankName: res.bankName, nameAtBank: res.nameAtBank, accountValid: res.valid } },
      client(req),
    );
    return { status: check.status, nameMatch: score, reason: !res.valid ? 'Account could not be verified' : passed ? null : `Account holder name doesn't match ${r.name}` };
  });

  // --- DigiLocker (Aadhaar e-KYC) ------------------------------------------------

  app.post('/signing/:token/kyc/digilocker/start', async (req) => {
    const { token } = req.params as { token: string };
    const r = await loadByToken(token);
    requireReady(r);
    requireSession(req, r);
    requireCheck(r, 'DIGILOCKER');
    await guardAttempts(r.id, 'DIGILOCKER');
    const state = randomToken(24);
    const { verifier, challenge } = pkcePair();
    await prisma.kycCheck.create({
      data: { envelopeId: r.envelopeId, recipientId: r.id, kind: 'DIGILOCKER', provider: config.kyc.digilocker.mode, status: 'PENDING', providerRef: state, data: { codeVerifier: verifier } },
    });
    return { url: digilockerAuthorizeUrl(state, challenge) };
  });

  app.get('/kyc/digilocker/callback', async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    const pending = q.state ? await prisma.kycCheck.findFirst({ where: { providerRef: q.state, kind: 'DIGILOCKER', status: 'PENDING' } }) : null;
    if (!pending) throw notFound('DigiLocker request');
    const { codeVerifier } = pending.data as { codeVerifier: string };
    const r = await prisma.recipient.findUniqueOrThrow({ where: { id: pending.recipientId } });
    const back = (outcome: string) => reply.redirect(`${config.appUrl}/sign/${signingToken(r)}?kyc=${outcome}`, 303);
    // The pending row held only the PKCE verifier; it is replaced by the result
    await prisma.kycCheck.delete({ where: { id: pending.id } });
    if (q.error || !q.code) return back('cancelled');

    let kyc: AadhaarKyc;
    try {
      kyc = await digilockerExchange(q.code, codeVerifier);
    } catch {
      return back('failed');
    }
    const score = nameMatch(kyc.name, r.name);
    const passed = Boolean(kyc.name) && score >= NAME_MATCH_THRESHOLD;
    await record(
      r,
      'DIGILOCKER',
      pending.provider,
      {
        passed,
        nameMatch: score,
        data: { aadhaarName: kyc.name, aadhaar: kyc.aadhaarLast4 ? `XXXX XXXX ${kyc.aadhaarLast4}` : null, yearOfBirth: kyc.dob ? kyc.dob.slice(-4) : null, gender: kyc.gender },
      },
      { ip: req.ip, userAgent: (req.headers['user-agent'] as string) ?? null },
    );
    return back(passed ? 'passed' : 'mismatch');
  });

  // --- Video selfie with a spoken challenge ------------------------------------

  app.post('/signing/:token/kyc/video/challenge', async (req) => {
    const { token } = req.params as { token: string };
    const r = await loadByToken(token);
    requireReady(r);
    requireSession(req, r);
    requireCheck(r, 'VIDEO');
    const digits = Array.from({ length: 4 }, () => Math.floor(Math.random() * 10)).join(' ');
    await prisma.recipient.update({ where: { id: r.id }, data: { videoChallenge: digits, videoChallengeAt: new Date() } });
    return { challenge: digits, expiresInSeconds: VIDEO_CHALLENGE_TTL_MS / 1000 };
  });

  app.post('/signing/:token/kyc/video', async (req) => {
    const { token } = req.params as { token: string };
    const r = await loadByToken(token);
    requireReady(r);
    requireSession(req, r);
    requireCheck(r, 'VIDEO');
    await guardAttempts(r.id, 'VIDEO');
    if (!r.videoChallenge || !r.videoChallengeAt || Date.now() - r.videoChallengeAt.getTime() > VIDEO_CHALLENGE_TTL_MS) {
      throw badRequest('The code to read aloud has expired. Start the recording again.');
    }
    const file = await req.file({ limits: { fileSize: MAX_VIDEO_BYTES } });
    if (!file) throw badRequest('Attach the recording in the "file" field.');
    const data = await file.toBuffer();
    if (file.file.truncated) throw badRequest('Recordings are limited to 15 MB. Keep it under 20 seconds.');
    if (!/^video\/(webm|mp4|quicktime)/.test(file.mimetype)) throw badRequest('Upload a video recording.');
    await assertClean(file.filename || 'recording', data);
    const sha256 = sha256Hex(data);
    const ext = file.mimetype.includes('mp4') ? 'mp4' : file.mimetype.includes('quicktime') ? 'mov' : 'webm';
    const storageKey = `envelopes/${r.envelopeId}/kyc/${r.id}-${Date.now()}.${ext}`;
    await putObject(storageKey, data, file.mimetype);
    const challenge = r.videoChallenge;
    await prisma.recipient.update({ where: { id: r.id }, data: { videoChallenge: null, videoChallengeAt: null } });
    // Recorded as evidence for the sender to review; no automated face or speech analysis
    await record(r, 'VIDEO', 'in-app', { passed: true, storageKey, sha256, data: { challenge, bytes: data.length, contentType: file.mimetype } }, client(req));
    return { status: 'PASSED' };
  });

  // --- Sender side: review results and recordings ------------------------------

  await app.register(async (s) => {
    s.addHook('preHandler', requireAuth);
    s.get('/envelopes/:id/kyc', async (req) => {
      const { id } = req.params as { id: string };
      const env = await getVisibleEnvelope(req.auth, id);
      const checks = await prisma.kycCheck.findMany({ where: { envelopeId: env.id, status: { not: 'PENDING' } }, orderBy: { createdAt: 'asc' } });
      return checks.map((c) => ({
        id: c.id,
        recipientId: c.recipientId,
        kind: c.kind,
        provider: c.provider,
        status: c.status,
        nameMatch: c.nameMatch,
        data: c.data,
        hasRecording: Boolean(c.storageKey),
        sha256: c.sha256,
        createdAt: c.createdAt,
      }));
    });
    s.get('/envelopes/:id/kyc/:checkId/recording', async (req, reply) => {
      const { id, checkId } = req.params as { id: string; checkId: string };
      const env = await getVisibleEnvelope(req.auth, id);
      const c = await prisma.kycCheck.findFirst({ where: { id: checkId, envelopeId: env.id } });
      if (!c?.storageKey) throw notFound('Recording');
      reply.header('Content-Type', (c.data as { contentType?: string }).contentType ?? 'video/webm').header('Cache-Control', 'private, no-store');
      return getObject(c.storageKey);
    });
  });

  // --- DigiLocker sandbox (development and tests) -------------------------------
  if (config.kyc.digilocker.mode !== 'sandbox') return;

  const page = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DigiLocker (sandbox)</title>
<style>body{font-family:system-ui,sans-serif;background:#f6f7fb;margin:0;padding:24px;color:#111827}main{max-width:420px;margin:24px auto;background:#fff;border-radius:16px;padding:28px;box-shadow:0 1px 3px #0001}
label{display:block;font-size:14px;font-weight:600;margin:14px 0 4px}input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:16px}
button{margin-top:18px;width:100%;padding:12px;border:0;border-radius:8px;background:#1d4ed8;color:#fff;font-weight:600;font-size:15px}.warn{background:#fef3c7;color:#92400e;border-radius:8px;padding:10px;font-size:13px}</style></head><body><main>${body}</main></body></html>`;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

  app.get('/dev/digilocker', async (req, reply) => {
    const { state } = req.query as { state?: string };
    reply.type('text/html');
    return page(`<p class="warn">SANDBOX DigiLocker: enter any details. Nothing is checked against UIDAI.</p>
<h1 style="font-size:20px">Share your Aadhaar details</h1>
<form method="POST" action="${config.appUrl}/api/v1/dev/digilocker"><input type="hidden" name="state" value="${esc(state ?? '')}">
<label for="n">Name as per Aadhaar</label><input id="n" name="name" required>
<label for="d">Date of birth (DD-MM-YYYY)</label><input id="d" name="dob" placeholder="15-08-1990">
<label for="a">Last 4 digits of Aadhaar</label><input id="a" name="last4" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" required>
<button name="outcome" value="allow">Allow</button><button name="outcome" value="deny" style="background:#fff;color:#111827;border:1px solid #d1d5db">Deny</button></form>`);
  });

  app.post('/dev/digilocker', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, string>;
    const cb = `${config.appUrl}/api/v1/kyc/digilocker/callback`;
    if (b.outcome !== 'allow') return reply.redirect(`${cb}?state=${encodeURIComponent(b.state ?? '')}&error=access_denied`, 303);
    const code = sandboxDigilockerCode({ name: b.name ?? '', dob: b.dob || null, gender: null, aadhaarLast4: (b.last4 ?? '').slice(0, 4) || null });
    return reply.redirect(`${cb}?state=${encodeURIComponent(b.state ?? '')}&code=${encodeURIComponent(code)}`, 303);
  });
}
