import { config } from '../config.js';
import { prisma } from '../db.js';

/**
 * Push notifications to the mobile app through the Expo push service, which
 * forwards to Apple and Google. Payloads carry no secrets (no signing links):
 * the app fetches details from the API when opened.
 */
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface PushMessage {
  title: string;
  body: string;
  /** Where the app opens: { screen: 'agreement', id } or { screen: 'to-sign' } */
  data?: Record<string, string>;
}

interface Ticket {
  status: 'ok' | 'error';
  details?: { error?: string };
}

/** Sends to every phone of the given users; tokens Expo reports as gone are removed. */
export async function pushToUsers(userIds: string[], message: PushMessage): Promise<number> {
  if (!userIds.length) return 0;
  const devices = await prisma.pushDevice.findMany({ where: { userId: { in: [...new Set(userIds)] } } });
  if (!devices.length) return 0;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (config.expoAccessToken) headers.Authorization = `Bearer ${config.expoAccessToken}`;
  let sent = 0;
  // Expo accepts up to 100 messages per request
  for (let i = 0; i < devices.length; i += 100) {
    const batch = devices.slice(i, i + 100);
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(batch.map((d) => ({ to: d.token, title: message.title, body: message.body, data: message.data ?? {}, sound: 'default' }))),
    });
    if (!res.ok) throw new Error(`Expo push failed: ${res.status} ${await res.text()}`);
    const tickets = ((await res.json()) as { data: Ticket[] }).data ?? [];
    const gone = batch.filter((_, j) => tickets[j]?.details?.error === 'DeviceNotRegistered').map((d) => d.token);
    if (gone.length) await prisma.pushDevice.deleteMany({ where: { token: { in: gone } } });
    sent += tickets.filter((t) => t.status === 'ok').length;
  }
  return sent;
}

/** App users whose confirmed email matches, in any organisation (a signer may have their own account). */
export async function pushToEmails(emails: string[], message: PushMessage): Promise<number> {
  const users = await prisma.user.findMany({
    where: { email: { in: emails.map((e) => e.toLowerCase()) }, emailVerifiedAt: { not: null }, disabledAt: null },
    select: { id: true },
  });
  return pushToUsers(users.map((u) => u.id), message);
}

/** Tells the sender about progress on their agreement (called for webhook events). */
export async function pushForEvent(event: string, data: Record<string, unknown>): Promise<void> {
  const envelopeId = typeof data.envelopeId === 'string' ? data.envelopeId : null;
  if (!envelopeId || !['recipient.signed', 'recipient.declined', 'envelope.completed'].includes(event)) return;
  const env = await prisma.envelope.findUnique({ where: { id: envelopeId }, select: { id: true, title: true, createdById: true, selfSign: true } });
  // Signing your own document needs no alert
  if (!env || env.selfSign) return;
  const recipient =
    typeof data.recipientId === 'string' ? await prisma.recipient.findUnique({ where: { id: data.recipientId }, select: { name: true } }) : null;
  const who = recipient?.name ?? 'A signer';
  const message =
    event === 'envelope.completed'
      ? { title: 'Completed', body: `Everyone has signed "${env.title}".` }
      : event === 'recipient.signed'
        ? { title: 'Signed', body: `${who} signed "${env.title}".` }
        : { title: 'Declined', body: `${who} declined to sign "${env.title}".` };
  await pushToUsers([env.createdById], { ...message, data: { screen: 'agreement', id: env.id } });
}
