import type { EnvelopeStatus, RecipientStatus } from './types';

export function formatDate(iso: string | null | undefined) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "5 min ago", "Yesterday", or a date */
export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 172800) return 'Yesterday';
  return formatDate(iso);
}

export const statusLabel: Record<EnvelopeStatus, string> = {
  DRAFT: 'Draft',
  SENT: 'Waiting for others',
  COMPLETED: 'Completed',
  DECLINED: 'Declined',
  VOIDED: 'Voided',
  EXPIRED: 'Expired',
};

export const recipientLabel: Record<RecipientStatus, string> = {
  PENDING: 'Not sent yet',
  SENT: 'Waiting',
  VIEWED: 'Opened',
  SIGNED: 'Signed',
  DECLINED: 'Declined',
};

export const activityLabel: Record<string, string> = {
  'envelope.sent': 'sent',
  'recipient.viewed': 'opened',
  'recipient.signed': 'signed',
  'recipient.declined': 'declined',
  'envelope.completed': 'completed',
  'envelope.voided': 'voided',
};
