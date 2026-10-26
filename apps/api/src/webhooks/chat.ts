import { config } from '../config.js';
import { prisma } from '../db.js';

/**
 * Slack and Microsoft Teams notifications. Both use incoming-webhook URLs the
 * customer creates in their workspace (Slack app "Incoming Webhooks"; Teams
 * Workflows "Post to a channel when a webhook request is received").
 */

export type ChatFormat = 'slack' | 'teams';

/** Hosts that issue incoming-webhook URLs; anything else is refused. */
export function isChatWebhookUrl(format: ChatFormat, raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (format === 'slack') return host === 'hooks.slack.com';
  return ['.logic.azure.com', '.webhook.office.com', '.powerplatform.com', '.powerautomate.com'].some((s) => host.endsWith(s));
}

const VERBS: Record<string, [string, string]> = {
  'envelope.sent': ['📤', 'was sent for signature'],
  'recipient.viewed': ['👀', 'was opened by {who}'],
  'recipient.signed': ['✍️', 'was signed by {who}'],
  'recipient.declined': ['⛔', 'was declined by {who}'],
  'envelope.completed': ['✅', 'is complete: everyone has signed'],
  'envelope.voided': ['🗑️', 'was voided'],
  'envelope.expired': ['⌛', 'expired before everyone signed'],
  ping: ['🔔', 'test notification from Nuronix eSign'],
};

export interface ChatMessage {
  text: string;
  url: string | null;
}

/** Plain-language message for an event, looking up titles and names it doesn't carry. */
export async function describeEvent(event: string, data: Record<string, unknown>): Promise<ChatMessage> {
  const [icon, verb] = VERBS[event] ?? ['🔔', event];
  if (event === 'ping') return { text: `${icon} This channel will receive Nuronix eSign notifications.`, url: null };
  const envelopeId = typeof data.envelopeId === 'string' ? data.envelopeId : null;
  const env = envelopeId ? await prisma.envelope.findUnique({ where: { id: envelopeId }, select: { title: true } }) : null;
  const recipient =
    typeof data.recipientId === 'string' ? await prisma.recipient.findUnique({ where: { id: data.recipientId }, select: { name: true, email: true } }) : null;
  const title = (typeof data.title === 'string' && data.title) || env?.title || 'An agreement';
  const who = recipient ? `${recipient.name} (${recipient.email})` : 'a recipient';
  let text = `${icon} "${title}" ${verb.replace('{who}', who)}`;
  if (event === 'recipient.declined' && typeof data.reason === 'string' && data.reason) text += `. Reason: ${data.reason}`;
  return { text, url: envelopeId ? `${config.appUrl}/envelopes/${envelopeId}` : null };
}

export function chatBody(format: ChatFormat, msg: ChatMessage): unknown {
  if (format === 'slack') {
    return {
      text: msg.text,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: msg.text } },
        ...(msg.url ? [{ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open agreement' }, url: msg.url }] }] : []),
      ],
    };
  }
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [{ type: 'TextBlock', text: msg.text, wrap: true }],
          ...(msg.url ? { actions: [{ type: 'Action.OpenUrl', title: 'Open agreement', url: msg.url }] } : {}),
        },
      },
    ],
  };
}
