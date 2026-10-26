import type { AuditEvent, Document, Envelope, Recipient } from '@prisma/client';
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import type { ResolvedPolicy } from '../policy/engine.js';

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 48;
const ACCENT = rgb(0.31, 0.27, 0.9);
const MUTED = rgb(0.42, 0.45, 0.5);
const TEXT = rgb(0.1, 0.1, 0.12);

const safe = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

/** Tiny flowing-text writer with automatic page breaks. */
class Writer {
  page!: PDFPage;
  y = 0;
  constructor(
    private doc: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont,
    private footer: string,
  ) {
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - MARGIN;
    this.page.drawText(safe(this.footer), { x: MARGIN, y: 24, size: 7, font: this.font, color: MUTED });
  }

  ensure(height: number) {
    if (this.y - height < MARGIN) this.newPage();
  }

  gap(h = 8) {
    this.y -= h;
  }

  text(s: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; indent?: number } = {}) {
    const size = opts.size ?? 9;
    const font = opts.bold ? this.bold : this.font;
    const maxW = A4[0] - MARGIN * 2 - (opts.indent ?? 0);
    for (const line of wrap(safe(s), font, size, maxW)) {
      this.ensure(size + 4);
      this.page.drawText(line, { x: MARGIN + (opts.indent ?? 0), y: this.y - size, size, font, color: opts.color ?? TEXT });
      this.y -= size + 4;
    }
  }

  heading(s: string) {
    this.ensure(40);
    this.gap(10);
    this.text(s, { size: 12, bold: true, color: ACCENT });
    this.page.drawLine({
      start: { x: MARGIN, y: this.y + 1 },
      end: { x: A4[0] - MARGIN, y: this.y + 1 },
      thickness: 0.5,
      color: rgb(0.85, 0.85, 0.9),
    });
    this.gap(6);
  }

  row(label: string, value: string) {
    const size = 9;
    const labelW = 130;
    const lines = wrap(safe(value), this.font, size, A4[0] - MARGIN * 2 - labelW);
    this.ensure((size + 4) * lines.length);
    this.page.drawText(safe(label), { x: MARGIN, y: this.y - size, size, font: this.bold, color: MUTED });
    for (const line of lines) {
      this.page.drawText(line, { x: MARGIN + labelW, y: this.y - size, size, font: this.font, color: TEXT });
      this.y -= size + 4;
    }
  }

  async image(dataUrl: string, maxW: number, maxH: number) {
    const png = await this.doc.embedPng(Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
    const scale = Math.min(maxW / png.width, maxH / png.height, 1);
    const h = png.height * scale;
    this.ensure(h + 6);
    this.page.drawRectangle({
      x: MARGIN + 130,
      y: this.y - h - 4,
      width: png.width * scale + 8,
      height: h + 8,
      borderColor: rgb(0.85, 0.85, 0.9),
      borderWidth: 0.5,
    });
    this.page.drawImage(png, { x: MARGIN + 134, y: this.y - h, width: png.width * scale, height: h });
    this.y -= h + 12;
  }
}

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxW) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      // Hard-break words longer than a line (hashes, URLs)
      let w = word;
      while (font.widthOfTextAtSize(w, size) > maxW) {
        let n = w.length;
        while (n > 1 && font.widthOfTextAtSize(w.slice(0, n), size) > maxW) n--;
        out.push(w.slice(0, n));
        w = w.slice(n);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}

const fmt = (d: Date | null | undefined) => (d ? `${d.toISOString().replace('T', ' ').slice(0, 19)} UTC` : '-');

export interface CertificateInput {
  envelope: Envelope;
  documents: Document[];
  recipients: Recipient[];
  /** recipientId → signature image (PNG data URL) */
  signatureImages: Map<string, string>;
  events: AuditEvent[];
  chainHead: string;
  policy: ResolvedPolicy;
  sealFormat: string;
}

const EVENT_LABELS: Record<string, string> = {
  'envelope.created': 'Envelope created',
  'document.added': 'Document added',
  'document.removed': 'Document removed',
  'envelope.sent': 'Envelope sent',
  'recipient.notified': 'Signing invitation emailed',
  'recipient.reminded': 'Reminder emailed',
  'recipient.viewed': 'Signing link opened',
  'recipient.otp_sent': 'Passcode sent',
  'recipient.otp_failed': 'Passcode rejected',
  'recipient.verified': 'Identity verified (email OTP)',
  'recipient.consented': 'Consent to electronic signing given',
  'recipient.signed': 'Signed',
  'recipient.approved': 'Approved',
  'payment.completed': 'Payment received',
  'document.stamped': 'e-Stamp attached',
  'recipient.esign_failed': 'Aadhaar eSign / DSC attempt failed',
  'recipient.corrected': 'Recipient corrected by sender',
  'recipient.reassigned': 'Reassigned by signer',
  'recipient.declined': 'Declined',
  'envelope.completed': 'Envelope completed',
  'envelope.voided': 'Envelope voided',
  'envelope.expired': 'Envelope expired',
  'document.sealed': 'Document sealed (PAdES)',
};

/** Builds the Certificate of Completion: who signed what, when, how and from where. */
export async function buildCertificate(input: CertificateInput): Promise<Uint8Array> {
  const { envelope, policy } = input;
  const doc = await PDFDocument.create();
  doc.setTitle(`Certificate of Completion - ${envelope.title}`);
  doc.setProducer('Nuronix eSign');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, font, bold, `Nuronix eSign Certificate of Completion  |  Envelope ${envelope.id}`);

  w.text('Certificate of Completion', { size: 20, bold: true });
  w.gap(4);
  w.text(envelope.title, { size: 12, color: MUTED });
  if ((envelope as { testMode?: boolean }).testMode) w.text('TEST AGREEMENT - created with a test API key. Not legally binding.', { size: 10, bold: true, color: rgb(0.8, 0.1, 0.1) });
  w.gap(6);

  w.heading('Envelope');
  w.row('Envelope ID', envelope.id);
  w.row('Status', envelope.status);
  w.row('Sent', fmt(envelope.sentAt));
  w.row('Completed', fmt(envelope.completedAt));
  w.row('Signing order', envelope.routing === 'SEQUENTIAL' ? 'Sequential' : 'Parallel');

  w.heading('Compliance profile');
  w.row('Jurisdiction', `${policy.jurisdictionName} (${policy.jurisdiction})`);
  w.row('Legal framework', policy.laws.join('; '));
  w.row('Signature level', `${policy.signatureLevel} - electronic signature with ${input.sealFormat} platform seal`);
  w.row('Signer authentication', 'Email one-time passcode');
  w.row('Data region', policy.dataRegion);
  w.row('Retention', `${policy.retentionYears} years (write-once storage)`);

  w.heading('Documents');
  for (const d of input.documents) {
    w.text(d.name, { bold: true });
    w.row('Pages', String(d.pageCount));
    w.row('Original SHA-256', d.sha256);
    w.row('Completed SHA-256', d.finalSha256 ?? '-');
    w.gap(4);
  }

  w.heading('Signers');
  const signers = input.recipients.filter((r) => r.role !== 'CC').sort((a, b) => a.routingOrder - b.routingOrder);
  for (const r of signers) {
    w.text(`${r.name} <${r.email}>`, { bold: true });
    const principal = (r as { witnessForId?: string | null }).witnessForId ? signers.find((x) => x.id === (r as { witnessForId?: string | null }).witnessForId) : null;
    w.row('Role', r.role === 'APPROVER' ? 'Approver' : principal ? `Witness to ${principal.name}` : r.hostUserId ? 'Signer (in person)' : 'Signer');
    w.row('Status', r.role === 'APPROVER' && r.status === 'SIGNED' ? 'APPROVED' : r.status);
    w.row('Identity verified', fmt(r.verifiedAt));
    w.row('Signed', fmt(r.signedAt));
    if (r.signedIp) w.row('IP address', r.signedIp);
    if (r.signedUserAgent) w.row('Device', r.signedUserAgent);
    const img = input.signatureImages.get(r.id);
    if (img) await w.image(img, 180, 50);
    w.gap(4);
  }
  const ccs = input.recipients.filter((r) => r.role === 'CC');
  if (ccs.length) {
    w.heading('Carbon copies');
    for (const r of ccs) w.text(`${r.name} <${r.email}>`);
  }

  w.heading('Consent disclosure');
  w.text(policy.consentText, { color: MUTED });

  w.heading('Audit trail');
  for (const e of input.events) {
    const actor = e.actor as { kind: string; name?: string; email?: string };
    const who = actor.kind === 'system' ? 'System' : `${actor.name ?? ''}${actor.email ? ` <${actor.email}>` : ''}`;
    w.text(`${fmt(e.createdAt)}   ${EVENT_LABELS[e.type] ?? e.type}`, { bold: true, size: 8.5 });
    w.text(`${who}${e.ip ? `   IP ${e.ip}` : ''}`, { size: 8, color: MUTED, indent: 12 });
    w.text(`#${e.seq}  hash ${e.hash}`, { size: 7, color: MUTED, indent: 12 });
    w.gap(2);
  }
  w.gap(6);
  w.row('Chain head', input.chainHead);
  w.text(
    'Each audit event includes the SHA-256 hash of the previous event. Altering, inserting or removing any event breaks the chain. Verify this envelope and its documents at the Nuronix eSign verification portal.',
    { size: 8, color: MUTED },
  );

  return doc.save({ useObjectStreams: false });
}
