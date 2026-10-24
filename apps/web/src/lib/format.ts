export function formatDate(iso: string | null | undefined, withTime = true): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d ago`;
  return formatDate(iso, false);
}

export const FIELD_LABELS: Record<string, string> = {
  SIGNATURE: 'Signature',
  INITIALS: 'Initials',
  DATE_SIGNED: 'Date signed',
  NAME: 'Full name',
  EMAIL: 'Email',
  TEXT: 'Text',
  CHECKBOX: 'Checkbox',
  DROPDOWN: 'Dropdown',
  RADIO: 'Choice',
  NUMBER: 'Number',
  FORMULA: 'Formula',
  ATTACHMENT: 'Attachment',
  PAYMENT: 'Payment',
};

export const formatMoney = (minor: number, currency: string) => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 100);

export const AUDIT_LABELS: Record<string, string> = {
  'envelope.created': 'Envelope created',
  'document.added': 'Document added',
  'document.removed': 'Document removed',
  'envelope.sent': 'Sent for signature',
  'recipient.notified': 'Signing invitation emailed',
  'recipient.reminded': 'Reminder emailed',
  'recipient.viewed': 'Opened signing link',
  'recipient.otp_sent': 'Passcode sent',
  'recipient.otp_failed': 'Incorrect passcode entered',
  'recipient.verified': 'Identity verified',
  'recipient.consented': 'Agreed to sign electronically',
  'recipient.signed': 'Signed',
  'recipient.approved': 'Approved',
  'recipient.corrected': 'Recipient corrected',
  'recipient.reassigned': 'Reassigned by signer',
  'payment.completed': 'Payment received',
  'document.stamped': 'e-Stamp attached',
  'recipient.esign_failed': 'Aadhaar eSign / DSC attempt failed',
  'recipient.declined': 'Declined to sign',
  'document.sealed': 'Document sealed',
  'envelope.completed': 'Envelope completed',
  'envelope.voided': 'Envelope voided',
  'envelope.expired': 'Envelope expired',
};
