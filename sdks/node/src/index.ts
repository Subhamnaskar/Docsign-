import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * DocSign API client.
 *
 *   const ds = new DocSign({ apiKey: process.env.DOCSIGN_API_KEY!, baseUrl: 'https://app.example.com' });
 *   const env = await ds.envelopes.create({ title: 'Offer letter' });
 *   await ds.envelopes.uploadDocument(env.id, pdfBuffer, 'offer.pdf');
 *
 * Keys starting `dsk_test_` create watermarked test agreements that are not billed.
 */

export interface DocSignOptions {
  apiKey: string;
  /** Your DocSign URL, e.g. https://app.example.com (the /api/v1 prefix is added) */
  baseUrl: string;
  /** Per-request timeout in milliseconds (default 30 s) */
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class DocSignError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'DocSignError';
  }
}

export type EnvelopeStatus = 'DRAFT' | 'SENT' | 'COMPLETED' | 'DECLINED' | 'VOIDED' | 'EXPIRED';

export interface RecipientInput {
  id?: string;
  name: string;
  email: string;
  role?: 'SIGNER' | 'APPROVER' | 'CC';
  routingOrder?: number;
  locale?: string;
  authMethod?: 'EMAIL_OTP' | 'SMS_OTP' | 'WHATSAPP_OTP' | 'ACCESS_CODE';
  phone?: string;
  accessCode?: string;
  signatureMethod?: 'ELECTRONIC' | 'AADHAAR_ESIGN' | 'DSC';
  idChecks?: ('PAN' | 'BANK' | 'DIGILOCKER' | 'VIDEO')[];
  embedded?: boolean;
  clientUserId?: string;
}

export interface FieldInput {
  documentId: string;
  recipientId: string;
  type: 'SIGNATURE' | 'INITIALS' | 'DATE_SIGNED' | 'NAME' | 'EMAIL' | 'TEXT' | 'CHECKBOX' | 'DROPDOWN' | 'RADIO' | 'NUMBER' | 'FORMULA' | 'ATTACHMENT' | 'PAYMENT' | 'MANDATE';
  /** Zero-based page index */
  page: number;
  /** Fractions (0-1) of the page, from the top-left corner */
  x: number;
  y: number;
  width: number;
  height: number;
  required?: boolean;
  label?: string;
  options?: string[];
  formula?: string;
  amount?: number;
  currency?: string;
}

export interface Document {
  id: string;
  name: string;
  pageCount: number;
  sha256: string;
  finalSha256?: string | null;
  completed?: boolean;
}

export interface Recipient extends RecipientInput {
  id: string;
  status: string;
  signedAt: string | null;
}

export interface Envelope {
  id: string;
  title: string;
  message: string | null;
  status: EnvelopeStatus;
  jurisdiction: string;
  documentType: string;
  testMode?: boolean;
  sentAt: string | null;
  completedAt: string | null;
  documents: Document[];
  recipients: Recipient[];
  fields: (FieldInput & { id: string; filled: boolean })[];
  readiness: string[];
}

export interface EnvelopeInput {
  title: string;
  message?: string;
  jurisdiction?: string;
  documentType?: string;
  routing?: 'SEQUENTIAL' | 'PARALLEL';
  reminderDays?: number;
  expiresAt?: string;
}

export interface WebhookEvent {
  id: string;
  event: 'envelope.sent' | 'recipient.viewed' | 'recipient.signed' | 'recipient.declined' | 'envelope.completed' | 'envelope.voided' | 'envelope.expired';
  createdAt: string;
  data: Record<string, unknown>;
}

type Body = Record<string, unknown> | unknown[] | FormData | undefined;

export class DocSign {
  private base: string;
  private key: string;
  private timeoutMs: number;
  private doFetch: typeof fetch;

  constructor(opts: DocSignOptions) {
    if (!opts.apiKey) throw new Error('apiKey is required');
    this.key = opts.apiKey;
    this.base = `${opts.baseUrl.replace(/\/$/, '')}/api/v1`;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.doFetch = opts.fetch ?? fetch;
  }

  /** True when this client uses a test key. */
  get testMode() {
    return this.key.startsWith('dsk_test_');
  }

  async request<T>(method: string, path: string, body?: Body, raw = false): Promise<T> {
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    const res = await this.doFetch(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.key}`, ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; details?: unknown } } | null;
      throw new DocSignError(res.status, payload?.error?.code ?? 'http_error', payload?.error?.message ?? `HTTP ${res.status}`, payload?.error?.details);
    }
    if (raw) return Buffer.from(await res.arrayBuffer()) as T;
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  envelopes = {
    list: (q: { status?: EnvelopeStatus; search?: string; limit?: number; cursor?: string } = {}) => {
      const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
      return this.request<{ data: Envelope[]; nextCursor: string | null }>('GET', `/envelopes${qs.size ? `?${qs}` : ''}`);
    },
    create: (input: EnvelopeInput) => this.request<Envelope>('POST', '/envelopes', input as unknown as Body),
    get: (id: string) => this.request<Envelope>('GET', `/envelopes/${id}`),
    update: (id: string, input: Partial<EnvelopeInput>) => this.request<Envelope>('PATCH', `/envelopes/${id}`, input as unknown as Body),
    delete: (id: string) => this.request<void>('DELETE', `/envelopes/${id}`),
    /** Upload a file (PDF, Word, Excel, PowerPoint, ODT, RTF, TXT; up to 25 MB). */
    uploadDocument: (id: string, data: Uint8Array | Blob, filename: string) => {
      const form = new FormData();
      form.append('file', data instanceof Blob ? data : new Blob([new Uint8Array(data)]), filename);
      return this.request<Document>('POST', `/envelopes/${id}/documents`, form);
    },
    setRecipients: (id: string, recipients: RecipientInput[]) => this.request<Envelope>('PUT', `/envelopes/${id}/recipients`, recipients as unknown as Body),
    setFields: (id: string, fields: FieldInput[]) => this.request<Envelope>('PUT', `/envelopes/${id}/fields`, fields as unknown as Body),
    send: (id: string) => this.request<Envelope>('POST', `/envelopes/${id}/send`),
    remind: (id: string) => this.request<{ reminded: number }>('POST', `/envelopes/${id}/remind`),
    void: (id: string, reason: string) => this.request<Envelope>('POST', `/envelopes/${id}/void`, { reason }),
    audit: (id: string) => this.request<{ events: unknown[]; chain: { valid: boolean } }>('GET', `/envelopes/${id}/audit`),
    /** Sealed PDF once completed (or `original: true` for the uploaded version). */
    downloadDocument: (id: string, documentId: string, opts: { original?: boolean } = {}) =>
      this.request<Buffer>('GET', `/envelopes/${id}/documents/${documentId}/file${opts.original ? '?version=original' : ''}`, undefined, true),
    downloadCertificate: (id: string) => this.request<Buffer>('GET', `/envelopes/${id}/certificate`, undefined, true),
    /** One-time URL for signing inside your app (iframe). */
    embeddedSigningUrl: (id: string, recipientId: string, returnUrl?: string) =>
      this.request<{ url: string; expiresAt: string }>('POST', `/envelopes/${id}/recipients/${recipientId}/embedded-session`, returnUrl ? { returnUrl } : {}),
  };

  templates = {
    list: () => this.request<{ id: string; name: string; roles: { id: string; name: string }[] }[]>('GET', '/templates'),
    createEnvelope: (templateId: string, input: { recipients: { roleId: string; name: string; email: string; locale?: string }[]; send?: boolean; title?: string }) =>
      this.request<Envelope>('POST', `/templates/${templateId}/envelopes`, input as unknown as Body),
  };

  docTemplates = {
    list: () => this.request<{ id: string; name: string; variables: string[] }[]>('GET', '/doc-templates'),
    /** Fill a Word template; adds the PDF to `envelopeId` or a new draft. */
    generate: (templateId: string, input: { data: Record<string, unknown>; envelopeId?: string; title?: string }) =>
      this.request<{ envelopeId: string; document: Document }>('POST', `/doc-templates/${templateId}/generate`, input as unknown as Body),
  };

  webhooks = {
    create: (url: string, events: WebhookEvent['event'][] = []) => this.request<{ id: string; url: string; secret: string }>('POST', '/webhooks', { url, events }),
    delete: (id: string) => this.request<void>('DELETE', `/webhooks/${id}`),
  };
}

/**
 * Verifies `X-DocSign-Signature` (t=<unix>,v1=<hex HMAC-SHA256 of "t.body">) and
 * returns the parsed event. Pass the raw request body, not re-serialised JSON.
 */
export function verifyWebhook(rawBody: string | Buffer, header: string | undefined, secret: string, toleranceSec = 300): WebhookEvent {
  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const parts = Object.fromEntries((header ?? '').split(',').map((kv) => kv.split('=') as [string, string]));
  const ts = Number(parts.t);
  if (!ts || !parts.v1) throw new DocSignError(400, 'bad_signature', 'Missing or malformed signature header');
  if (Math.abs(Date.now() / 1000 - ts) > toleranceSec) throw new DocSignError(400, 'stale_signature', 'Signature timestamp is too old');
  const expected = createHmac('sha256', secret).update(`${ts}.${body}`).digest();
  const given = Buffer.from(parts.v1, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new DocSignError(400, 'bad_signature', 'Signature does not match');
  return JSON.parse(body) as WebhookEvent;
}

export default DocSign;
