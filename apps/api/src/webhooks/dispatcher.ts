import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '../db.js';
import { hmacSha256Hex } from '../lib/crypto.js';

export const WEBHOOK_EVENTS = [
  'envelope.sent',
  'recipient.viewed',
  'recipient.signed',
  'recipient.declined',
  'envelope.completed',
  'envelope.voided',
  'envelope.expired',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const MAX_ATTEMPTS = 8;

/** Writes outbox rows in the caller's transaction; the worker delivers them. */
export async function enqueueWebhook(
  tx: Tx,
  orgId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<void> {
  const endpoints = await tx.webhookEndpoint.findMany({ where: { orgId, active: true } });
  const payload = { event, createdAt: new Date().toISOString(), data } as Prisma.JsonObject;
  const targets = endpoints.filter((e) => e.events.length === 0 || e.events.includes(event));
  if (targets.length === 0) return;
  await tx.webhookDelivery.createMany({
    data: targets.map((e) => ({ endpointId: e.id, event, payload })),
  });
}

/**
 * Signature header: `t=<unix>,v1=<hex hmac of "t.body">`, the same scheme as
 * Stripe so receivers can reuse familiar verification code.
 */
export function signPayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)) {
  return `t=${timestamp},v1=${hmacSha256Hex(secret, `${timestamp}.${body}`)}`;
}

export async function deliverPendingWebhooks(limit = 20): Promise<number> {
  const due = await prisma.webhookDelivery.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
    include: { endpoint: true },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
  });
  await Promise.all(due.map(deliverOne));
  return due.length;
}

async function deliverOne(d: Prisma.WebhookDeliveryGetPayload<{ include: { endpoint: true } }>) {
  const body = JSON.stringify({ id: d.id, ...(d.payload as object) });
  let responseCode: number | null = null;
  let error: string | null = null;
  try {
    const res = await fetch(d.endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'DocSign-Webhooks/1.0',
        'X-DocSign-Event': d.event,
        'X-DocSign-Delivery': d.id,
        'X-DocSign-Signature': signPayload(d.endpoint.secret, body),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    responseCode = res.status;
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (err) {
    error = (err as Error).message;
  }
  const attempts = d.attempts + 1;
  if (!error) {
    await prisma.webhookDelivery.update({
      where: { id: d.id },
      data: { status: 'DELIVERED', attempts, responseCode, deliveredAt: new Date(), lastError: null },
    });
    return;
  }
  // Exponential backoff: 30s, 1m, 2m, 4m ... capped at 1h
  const delayMs = Math.min(30_000 * 2 ** (attempts - 1), 3_600_000);
  await prisma.webhookDelivery.update({
    where: { id: d.id },
    data: {
      status: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
      attempts,
      responseCode,
      lastError: error,
      nextAttemptAt: new Date(Date.now() + delayMs),
    },
  });
}
