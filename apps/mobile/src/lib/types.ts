/** Shapes returned by the Nuronix eSign API (apps/api) that the app uses. */

export type EnvelopeStatus = 'DRAFT' | 'SENT' | 'COMPLETED' | 'DECLINED' | 'VOIDED' | 'EXPIRED';
export type RecipientStatus = 'PENDING' | 'SENT' | 'VIEWED' | 'SIGNED' | 'DECLINED';

export interface Me {
  user: { id: string; name: string; email: string; role: string; emailVerified: boolean; twoFactor: boolean; guest: boolean } | null;
  organization: { id: string; name: string; jurisdiction: string };
}

export interface EnvelopeSummary {
  id: string;
  title: string;
  status: EnvelopeStatus;
  sentAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  sender: string;
  testMode: boolean;
  inReview: boolean;
  recipients: { name: string; email: string; role: string; status: RecipientStatus }[];
}

export interface Recipient {
  id: string;
  name: string;
  email: string;
  role: 'SIGNER' | 'CC' | 'APPROVER';
  status: RecipientStatus;
  routingOrder: number;
  signedAt?: string | null;
}

export interface DocumentInfo {
  id: string;
  name: string;
  pageCount: number;
}

export interface Envelope {
  id: string;
  title: string;
  status: EnvelopeStatus;
  message: string | null;
  sentAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  selfSign?: boolean;
  documents: DocumentInfo[];
  recipients: Recipient[];
  fields: { id: string; recipientId: string; type: string }[];
}

export interface ToSignItem {
  recipientId: string;
  envelopeId: string;
  title: string;
  role: string;
  from: string;
  organization: string;
  sentAt: string | null;
  expiresAt: string | null;
  testMode: boolean;
  signingUrl: string;
}

export interface Home {
  name: string | null;
  counts: { drafts: number; awaitingOthers: number; completedThisMonth: number; toSign: number };
  activity: { id: string; type: string; actor: { name?: string; email?: string } | null; createdAt: string; envelope: { id: string; title: string } }[];
}
