import type { Invoice } from '@prisma/client';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { invoiceNumber } from './service.js';

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 48;
const ACCENT = rgb(0.31, 0.27, 0.9);
const MUTED = rgb(0.42, 0.45, 0.5);
const TEXT = rgb(0.1, 0.1, 0.12);
const RULE = rgb(0.85, 0.85, 0.9);

const safe = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
// Standard PDF fonts have no rupee sign, so amounts use the ISO code
const money = (minor: number, currency: string) =>
  `${currency} ${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)}`;
const day = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

interface Party {
  name?: string | null;
  email?: string | null;
  address?: string | null;
  taxId?: string | null;
}

/** One-page tax invoice. */
export async function renderInvoicePdf(inv: Invoice): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const number = invoiceNumber(inv);
  doc.setTitle(`Invoice ${number}`);
  const page = doc.addPage(A4);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const right = A4[0] - MARGIN;
  let y = A4[1] - MARGIN;

  const text = (s: string, x: number, size = 9, f = font, color = TEXT) => page.drawText(safe(s), { x, y, size, font: f, color });
  const textRight = (s: string, x: number, size = 9, f = font, color = TEXT) =>
    page.drawText(safe(s), { x: x - f.widthOfTextAtSize(safe(s), size), y, size, font: f, color });
  const rule = () => page.drawLine({ start: { x: MARGIN, y: y + 4 }, end: { x: right, y: y + 4 }, thickness: 0.5, color: RULE });

  const seller = inv.seller as Party;
  const billTo = inv.billTo as Party;
  const isGst = inv.currency === 'INR' && inv.taxRate > 0;

  text(isGst ? 'TAX INVOICE' : 'INVOICE', MARGIN, 18, bold, ACCENT);
  textRight(number, right, 11, bold);
  y -= 16;
  textRight(`Date: ${day(inv.paidAt)}`, right, 9, font, MUTED);
  y -= 30;

  const block = (title: string, p: Party, x: number) => {
    let yy = y;
    page.drawText(title, { x, y: yy, size: 8, font: bold, color: MUTED });
    yy -= 14;
    const lines = [p.name ?? '', ...(p.address ?? '').split('\n'), p.email ?? '', p.taxId ? `${isGst ? 'GSTIN' : 'Tax ID'}: ${p.taxId}` : ''].filter(Boolean);
    for (const l of lines) {
      page.drawText(safe(l).slice(0, 60), { x, y: yy, size: 9, font: l === p.name ? bold : font, color: TEXT });
      yy -= 13;
    }
    return yy;
  };
  y = Math.min(block('FROM', seller, MARGIN), block('BILL TO', billTo, A4[0] / 2 + 10)) - 18;

  text('Description', MARGIN, 8, bold, MUTED);
  textRight('Amount', right, 8, bold, MUTED);
  y -= 8;
  rule();
  y -= 12;
  text(inv.description, MARGIN, 10);
  textRight(money(inv.subtotal, inv.currency), right, 10);
  y -= 13;
  text(`Service period: ${day(inv.periodStart)} to ${day(inv.periodEnd)}`, MARGIN, 8, font, MUTED);
  if (isGst) {
    y -= 12;
    text('SAC 998431 (online software services)', MARGIN, 8, font, MUTED);
  }
  y -= 22;
  rule();
  y -= 12;

  const totalRow = (label: string, value: string, strong = false) => {
    textRight(label, right - 130, strong ? 10 : 9, strong ? bold : font, strong ? TEXT : MUTED);
    textRight(value, right, strong ? 11 : 9, strong ? bold : font);
    y -= strong ? 18 : 14;
  };
  totalRow('Subtotal', money(inv.subtotal, inv.currency));
  if (inv.tax > 0) totalRow(inv.taxLabel ?? 'Tax', money(inv.tax, inv.currency));
  totalRow('Total paid', money(inv.total, inv.currency), true);

  y -= 20;
  text(`Paid on ${day(inv.paidAt)} via ${inv.provider === 'sandbox' ? 'test checkout (no money moved)' : inv.provider}.`, MARGIN, 8, font, MUTED);
  if (!isGst && inv.currency !== 'INR' && seller.taxId) {
    y -= 12;
    text('Export of services; no GST charged.', MARGIN, 8, font, MUTED);
  }

  page.drawText('This invoice was generated electronically and does not need a signature.', { x: MARGIN, y: 28, size: 7, font, color: MUTED });
  return doc.save();
}
