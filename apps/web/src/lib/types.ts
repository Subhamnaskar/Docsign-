export type EnvelopeStatus = 'DRAFT' | 'SENT' | 'COMPLETED' | 'DECLINED' | 'VOIDED' | 'EXPIRED';
export type RecipientStatus = 'CREATED' | 'SENT' | 'VIEWED' | 'SIGNED' | 'DECLINED';
export type FieldType = 'SIGNATURE' | 'INITIALS' | 'DATE_SIGNED' | 'NAME' | 'EMAIL' | 'TEXT' | 'CHECKBOX';

export interface PageInfo {
  width: number;
  height: number;
  rotation: number;
}

export interface DocumentInfo {
  id: string;
  name: string;
  order: number;
  sha256: string;
  pageCount: number;
  pages: PageInfo[];
  finalSha256: string | null;
  completed: boolean;
}

export interface Recipient {
  id: string;
  name: string;
  email: string;
  role: 'SIGNER' | 'CC';
  routingOrder: number;
  status: RecipientStatus;
  viewedAt: string | null;
  verifiedAt: string | null;
  signedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  lastNotifiedAt: string | null;
}

export interface Field {
  id: string;
  documentId: string;
  recipientId: string;
  type: FieldType;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
  label: string | null;
  filled?: boolean;
  value?: string | null;
}

export interface Policy {
  jurisdiction: string;
  jurisdictionName: string;
  documentType: string;
  laws: string[];
  signatureLevel: 'SES' | 'AES' | 'QES';
  identityAssurance: string;
  signatureProvider: string | null;
  identityProvider: string | null;
  signatureFormat: string;
  retentionYears: number;
  dataRegion: string;
  residencySatisfied: boolean;
  consentText: string;
  allowed: boolean;
  blockers: string[];
  warnings: string[];
}

export interface Envelope {
  id: string;
  title: string;
  message: string | null;
  status: EnvelopeStatus;
  routing: 'SEQUENTIAL' | 'PARALLEL';
  jurisdiction: string;
  documentType: string;
  reminderDays: number;
  expiresAt: string | null;
  sentAt: string | null;
  completedAt: string | null;
  voidReason: string | null;
  createdAt: string;
  updatedAt: string;
  hasCertificate: boolean;
  certificateSha256: string | null;
  policy: Policy;
  readiness: string[];
  documents: DocumentInfo[];
  recipients: Recipient[];
  fields: Field[];
}

export interface EnvelopeSummary {
  id: string;
  title: string;
  status: EnvelopeStatus;
  jurisdiction: string;
  sentAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  recipients: { name: string; email: string; role: string; status: RecipientStatus }[];
}

export interface AuditEvent {
  id: string;
  seq: number;
  type: string;
  actor: { kind: string; name?: string; email?: string };
  data: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  prevHash: string;
  hash: string;
}

export interface Me {
  user: { id: string; name: string; email: string; role: string } | null;
  organization: { id: string; name: string; jurisdiction: string; dataRegion: string };
  cell: string;
}

export interface Option {
  code: string;
  name: string;
}
