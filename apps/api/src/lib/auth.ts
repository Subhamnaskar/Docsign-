import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Actor } from '../audit/audit.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { hmacSha256Hex, randomToken, safeEqualHex, sha256Hex } from './crypto.js';
import { forbidden, HttpError, unauthorized } from './errors.js';
import { assertFeature } from '../billing/plans.js';
import { ipAllowed, orgIpAllowlist } from '../governance/delivery.js';

export const SESSION_COOKIE = 'ds_session';
export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
export const API_KEY_PREFIX = 'dsk_';
export const TEST_KEY_PREFIX = 'dsk_test_';

export type Role = 'OWNER' | 'ADMIN' | 'MEMBER';

export interface AuthContext {
  orgId: string;
  userId: string | null;
  /** API keys act with owner rights. */
  role: Role;
  actor: Actor;
  /** Present for cookie sessions */
  sessionId?: string;
  /** Departments this member manages (they see those agreements too) */
  managedDepartmentIds?: string[];
  /** API keys only: true for test keys, false for live keys (sessions see both) */
  testMode?: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext;
  }
}

export async function createSession(reply: FastifyReply, userId: string) {
  const token = randomToken();
  const ua = reply.request.headers['user-agent'];
  await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256Hex(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      ip: reply.request.ip,
      userAgent: typeof ua === 'string' ? ua.slice(0, 300) : null,
    },
  });
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    maxAge: SESSION_TTL_MS / 1000,
  });
}

/** Authenticates a sender by session cookie or `Authorization: Bearer dsk_...` API key. */
export async function requireAuth(request: FastifyRequest): Promise<void> {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const key = header.slice(7).trim();
    if (!key.startsWith(API_KEY_PREFIX)) throw unauthorized('Invalid API key');
    const apiKey = await prisma.apiKey.findUnique({ where: { keyHash: sha256Hex(key) } });
    if (!apiKey || apiKey.revokedAt) throw unauthorized('Invalid API key');
    await assertIpAllowed(request, apiKey.orgId);
    // Test keys work on every plan so developers can build before buying
    if (apiKey.mode !== 'test') await assertFeature(apiKey.orgId, 'api');
    // Best-effort usage tracking; not worth failing the request over
    prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    // API calls act on behalf of the org's owner for attribution of created envelopes
    const owner = await prisma.user.findFirst({ where: { orgId: apiKey.orgId, role: 'OWNER' } });
    request.auth = {
      orgId: apiKey.orgId,
      userId: owner?.id ?? null,
      role: 'OWNER',
      actor: { kind: 'api_key', id: apiKey.id, name: apiKey.name },
      testMode: apiKey.mode === 'test',
    };
    return;
  }

  const token = request.cookies[SESSION_COOKIE];
  if (!token) throw unauthorized();
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { user: { include: { org: { select: { require2fa: true } } } } },
  });
  if (!session || session.expiresAt < new Date()) throw unauthorized('Session expired');
  const { user } = session;
  if (user.disabledAt) throw unauthorized('This account has been deactivated.');
  await assertIpAllowed(request, user.orgId);
  // Organisation policy: password users must set up two-factor before doing anything else
  if (user.org.require2fa && !user.totpEnabledAt && !user.passwordHash.startsWith('sso:') && !MFA_SETUP_PATHS.test(request.url)) {
    throw new HttpError(403, 'Your organisation requires two-factor authentication. Set it up under Settings → Security.', 'mfa_setup_required');
  }
  if (Date.now() - session.lastSeenAt.getTime() > LAST_SEEN_RESOLUTION_MS) {
    prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  request.auth = {
    orgId: user.orgId,
    userId: user.id,
    role: user.role,
    actor: { kind: 'user', id: user.id, name: user.name, email: user.email },
    sessionId: session.id,
    managedDepartmentIds:
      user.role === 'MEMBER'
        ? (await prisma.departmentMember.findMany({ where: { userId: user.id, role: 'manager' }, select: { departmentId: true } })).map((d) => d.departmentId)
        : undefined,
  };
}

/** Organisation IP allowlist (signers are not restricted, only the organisation's own users and keys). */
async function assertIpAllowed(request: FastifyRequest, orgId: string) {
  const list = await orgIpAllowlist(orgId);
  if (!ipAllowed(request.ip, list)) throw new HttpError(403, `Access from ${request.ip} is not allowed by your organisation's IP allowlist.`, 'ip_not_allowed');
}

const LAST_SEEN_RESOLUTION_MS = 5 * 60_000;
/** Reachable before required two-factor setup is done */
const MFA_SETUP_PATHS = /^\/api\/v1\/auth\/(me|logout|2fa(\/|$|\?)|sessions|password\/change|verify-email)/;

/** Pre-handler factory restricting a route to the given roles. */
export function requireRole(...roles: Role[]) {
  return async (request: FastifyRequest) => {
    if (!roles.includes(request.auth.role)) throw forbidden('You need an administrator to do this.');
  };
}

export const isAdmin = (auth: AuthContext) => auth.role === 'OWNER' || auth.role === 'ADMIN';

/**
 * Signing links carry `<recipientId>.<hmac>`; nothing secret is stored
 * server-side. The recipient's tokenVersion is part of the MAC, so correcting
 * or reassigning a recipient invalidates links already sent.
 */
interface TokenSubject {
  id: string;
  tokenVersion: number;
}

const signingMac = (r: TokenSubject) => hmacSha256Hex(config.appSecret, `sign:${r.id}:${r.tokenVersion}`).slice(0, 48);

export function signingToken(r: TokenSubject): string {
  return `${r.id}.${signingMac(r)}`;
}

/** Splits a token; the MAC is checked with `signingTokenMatches` once the recipient is loaded. */
export function parseSigningToken(token: string): { id: string; mac: string } | null {
  const [id, mac] = token.split('.');
  if (!id || !mac || !/^[0-9a-f]{48}$/.test(mac)) return null;
  return { id, mac };
}

export function signingTokenMatches(r: TokenSubject, mac: string): boolean {
  return safeEqualHex(mac, signingMac(r));
}

/** `base` is the organisation's verified custom domain when it has one (see appBaseFor). */
export function signingUrl(r: TokenSubject, base = config.appUrl): string {
  return `${base}/sign/${signingToken(r)}`;
}

export function clientInfo(request: FastifyRequest) {
  return { ip: request.ip, userAgent: request.headers['user-agent']?.slice(0, 300) ?? null };
}
