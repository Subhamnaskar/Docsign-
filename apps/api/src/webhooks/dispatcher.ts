import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '../db.js';
import { hmacSha256Hex } from '../lib/crypto.js';
import { chatBody, describeEvent } from './chat.js';
import { enqueueCrmEvents } from '../crm/routes.js';
import { enqueueWorkflowRuns } from '../workflows/engine.js';
import { background } from '../lib/background.js';
import { pushForEvent } from '../lib/push.js';

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
  await enqueueCrmEvents(tx, orgId, event, data);
  await enqueueWorkflowRuns(tx, orgId, event, data);
  // Mobile app alerts for the sender; sent after the response, never failing the caller
  background(pushForEvent(event, data), (err) => console.error('push failed', err));
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

/** Body and headers for an endpoint: signed JSON, or a Slack/Teams chat message. */
type Payload = { data?: Record<string, unknown>; [key: string]: unknown };

export async function renderDelivery(
  endpoint: { format: string; secret: string },
  id: string,
  event: string,
  payload: Payload,
): Promise<{ body: string; headers: Record<string, string> }> {
  if (endpoint.format === 'slack' || endpoint.format === 'teams') {
    const body = JSON.stringify(chatBody(endpoint.format, await describeEvent(event, payload.data ?? {})));
    return { body, headers: { 'Content-Type': 'application/json', 'User-Agent': 'DocSign-Webhooks/1.0' } };
  }
  const body = JSON.stringify({ id, ...payload });
  return {
    body,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'DocSign-Webhooks/1.0',
      'X-DocSign-Event': event,
      'X-DocSign-Delivery': id,
      'X-DocSign-Signature': signPayload(endpoint.secret, body),
    },
  };
}

async function deliverOne(d: Prisma.WebhookDeliveryGetPayload<{ include: { endpoint: true } }>) {
  let responseCode: number | null = null;
  let error: string | null = null;
  try {
    const { body, headers } = await renderDelivery(d.endpoint, d.id, d.event, d.payload as Payload);
    const res = await fetch(d.endpoint.url, {
      method: 'POST',
      headers,
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
