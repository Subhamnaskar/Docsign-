export type EnvelopeStatus = 'DRAFT' | 'SENT' | 'COMPLETED' | 'DECLINED' | 'VOIDED' | 'EXPIRED';
export type RecipientStatus = 'CREATED' | 'SENT' | 'VIEWED' | 'SIGNED' | 'DECLINED';
export type FieldType =
  | 'SIGNATURE'
  | 'INITIALS'
  | 'DATE_SIGNED'
  | 'NAME'
  | 'EMAIL'
  | 'TEXT'
  | 'CHECKBOX'
  | 'DROPDOWN'
  | 'RADIO'
  | 'NUMBER'
  | 'FORMULA'
  | 'ATTACHMENT'
  | 'PAYMENT'
  | 'MANDATE';

export interface FieldCondition {
  fieldLabel: string;
  equals: string;
}

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

export type IdCheck = 'PAN' | 'BANK' | 'DIGILOCKER' | 'VIDEO';

export interface Recipient {
  id: string;
  name: string;
  email: string;
  role: 'SIGNER' | 'APPROVER' | 'CC';
  routingOrder: number;
  locale: string;
  inPerson?: boolean;
  authMethod?: 'EMAIL_OTP' | 'SMS_OTP' | 'WHATSAPP_OTP' | 'ACCESS_CODE' | 'NONE';
  phone?: string | null;
  hasAccessCode?: boolean;
  embedded?: boolean;
  clientUserId?: string | null;
  signatureMethod?: 'ELECTRONIC' | 'AADHAAR_ESIGN' | 'DSC' | 'QES';
  idChecks?: IdCheck[];
  witnessForId?: string | null;
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
  options?: string[];
  formula?: string | null;
  condition?: FieldCondition | null;
  /** PAYMENT: minor units (paise, cents) */
  amount?: number | null;
  currency?: string | null;
  /** MANDATE: debit frequency and duration */
  config?: { frequency?: string; months?: number } | null;
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
  stampDutyRequired?: boolean;
  allowed: boolean;
  blockers: string[];
  warnings: string[];
}

export interface Envelope {
  id: string;
  departmentId?: string | null;
  legalHold?: { since: string; reason: string | null } | null;
  approval?: { status: 'PENDING' | 'APPROVED' | 'REJECTED'; requestedAt: string | null; requestedBy: string | null; decidedBy: string | null; note: string | null } | null;
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
  estamp?: Estamp | null;
  estampResult?: { certificateNumber: string; state: string; dutyAmount: number; sandbox: boolean; issuedAt: string } | null;
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
  sender?: string;
  folder?: { id: string; name: string } | null;
  approvalStatus?: string | null;
  testMode?: boolean;
  /** Out for signature with open signer comments */
  inReview?: boolean;
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
  user: { id: string; name: string; email: string; role: string; emailVerified?: boolean; twoFactor?: boolean; mfaSetupRequired?: boolean; locale?: string; platformAdmin?: boolean } | null;
  organization: {
    id: string;
    name: string;
    jurisdiction: string;
    dataRegion: string;
    brandColor: string | null;
    embedOrigins: string[];
    aiEnabled?: boolean;
    require2fa?: boolean;
    approvalPolicy?: 'off' | 'members' | 'all';
    approverIds?: string[];
  };
  /** Read-only NuronixAI support session */
  support?: { by: string; endsAt: string | null } | null;
  cell: string;
  features?: { ai: boolean; aadhaarEsign: string };
  billing?: {
    plan: string;
    planName: string;
    state: 'trialing' | 'trial_expired' | 'active' | 'past_due' | 'canceled';
    canSend: boolean;
    blockedReason: string | null;
    trialEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
    periodEnd: string | null;
    features: string[];
  };
}

export interface Estamp {
  state: string;
  article: string;
  dutyAmount: number;
  firstParty: string;
  secondParty: string;
  purpose: string;
}

export interface Option {
  code: string;
  name: string;
}

export interface TemplateRole {
  id: string;
  name: string;
  role: 'SIGNER' | 'CC';
  routingOrder: number;
  fieldCount?: number;
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  jurisdiction: string;
  updatedAt: string;
  documentCount: number;
  roles: Pick<TemplateRole, 'id' | 'name' | 'role'>[];
}

export interface Template {
  id: string;
  name: string;
  description: string | null;
  title: string;
  message: string | null;
  jurisdiction: string;
  documentType: string;
  routing: 'SEQUENTIAL' | 'PARALLEL';
  documents: { id: string; name: string; pageCount: number; pages: PageInfo[] }[];
  roles: TemplateRole[];
}
