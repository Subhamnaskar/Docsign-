import type { AuditEvent, Prisma } from '@prisma/client';
import { prisma, type Tx } from '../db.js';
import { canonicalJson, sha256Hex } from '../lib/crypto.js';

export const GENESIS_HASH = '0'.repeat(64);

export type Actor =
  | { kind: 'user'; id: string; name: string; email: string }
  | { kind: 'recipient'; id: string; name: string; email: string }
  | { kind: 'api_key'; id: string; name: string }
  | { kind: 'system' };

export interface AuditInput {
  envelopeId: string;
  type: string;
  actor: Actor;
  data?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

function computeHash(prevHash: string, e: Omit<AuditEvent, 'id' | 'hash' | 'prevHash'>): string {
  const body = canonicalJson({
    envelopeId: e.envelopeId,
    seq: e.seq,
    type: e.type,
    actor: e.actor,
    data: e.data,
    ip: e.ip,
    userAgent: e.userAgent,
    createdAt: e.createdAt.toISOString(),
  });
  return sha256Hex(prevHash + body);
}

/**
 * Appends an event to the envelope's hash chain. Must run inside a transaction;
 * the row lock on the envelope serialises concurrent writers so seq stays gap-free.
 */
export async function appendAudit(tx: Tx, input: AuditInput): Promise<AuditEvent> {
  await tx.$executeRaw`SELECT 1 FROM "Envelope" WHERE id = ${input.envelopeId} FOR UPDATE`;
  const last = await tx.auditEvent.findFirst({
    where: { envelopeId: input.envelopeId },
    orderBy: { seq: 'desc' },
  });
  const prevHash = last?.hash ?? GENESIS_HASH;
  const event = {
    envelopeId: input.envelopeId,
    seq: (last?.seq ?? 0) + 1,
    type: input.type,
    actor: input.actor as Prisma.JsonObject,
    data: (input.data ?? {}) as Prisma.JsonObject,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    // JS dates are millisecond-precision, which Postgres timestamp(3) stores exactly
    createdAt: new Date(),
  };
  const hash = computeHash(prevHash, event);
  return tx.auditEvent.create({ data: { ...event, prevHash, hash } });
}

export interface ChainVerification {
  valid: boolean;
  count: number;
  headHash: string;
  brokenAtSeq?: number;
}

/** Recomputes every link of the chain; any edited, inserted or deleted row breaks it. */
export async function verifyChain(envelopeId: string): Promise<ChainVerification> {
  const events = await prisma.auditEvent.findMany({ where: { envelopeId }, orderBy: { seq: 'asc' } });
  let prev = GENESIS_HASH;
  for (const [i, e] of events.entries()) {
    if (e.seq !== i + 1 || e.prevHash !== prev || computeHash(prev, e) !== e.hash) {
      return { valid: false, count: events.length, headHash: prev, brokenAtSeq: e.seq };
    }
    prev = e.hash;
  }
  return { valid: true, count: events.length, headHash: prev };
}
