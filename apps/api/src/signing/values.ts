import type { Field, Recipient, SignerAttachment } from '@prisma/client';
import { badRequest } from '../lib/errors.js';
import { evaluateFormula } from '../lib/formula.js';
import { normalizeSignaturePng } from '../lib/image.js';

export const MAX_SIGNATURE_BYTES = 400 * 1024;

type Condition = { fieldLabel: string; equals: string };

const describe = (f: Field) => `${f.label ?? f.type.toLowerCase().replace('_', ' ')} on page ${f.page + 1}`;

export function parseNumber(v: string | null | undefined): number | null {
  if (v == null || v.trim() === '') return null;
  const n = Number(v.replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Validates and normalises the values a signer submits for their fields.
 * `others` are fields already completed by earlier signers, so conditions and
 * formulas can refer to them. Returns the value to store for every own field
 * (null for fields hidden by a condition).
 */
export function resolveFieldValues(
  r: Pick<Recipient, 'name' | 'email'>,
  own: Field[],
  others: Field[],
  submitted: Record<string, string>,
  attachments: Pick<SignerAttachment, 'id' | 'fieldId'>[],
  /** Aadhaar eSign / DSC signers: the cryptographic signature replaces drawn signatures and initials */
  opts: { crypto?: boolean } = {},
): { id: string; value: string | null }[] {
  const raw = new Map(own.map((f) => [f.id, submitted[f.id]?.trim() || null]));
  const byLabel = (label: string): string | null => {
    const mine = own.find((f) => f.label === label);
    if (mine) return raw.get(mine.id) ?? null;
    return others.find((f) => f.label === label)?.value ?? null;
  };
  const visible = (f: Field) => {
    const c = f.condition as Condition | null;
    return !c || (byLabel(c.fieldLabel) ?? '') === c.equals;
  };

  const out: { id: string; value: string | null }[] = [];
  for (const f of own) {
    if (!visible(f)) {
      out.push({ id: f.id, value: null });
      continue;
    }
    let value = raw.get(f.id) ?? null;
    switch (f.type) {
      case 'NAME':
        value = r.name;
        break;
      case 'EMAIL':
        value = r.email;
        break;
      case 'DATE_SIGNED':
        // Rendered from signedAt at sealing time
        value = new Date().toISOString().slice(0, 10);
        break;
      case 'SIGNATURE':
      case 'INITIALS':
        if (opts.crypto) {
          out.push({ id: f.id, value: null });
          continue;
        }
        if (value) {
          if (Buffer.byteLength(value) > MAX_SIGNATURE_BYTES * 1.4) throw badRequest('Signature image is too large.');
          value = normalizeSignaturePng(value);
        }
        break;
      case 'CHECKBOX':
        value = value === 'true' ? 'true' : f.required ? null : 'false';
        break;
      case 'TEXT':
        if (value && value.length > 500) throw badRequest('Text fields are limited to 500 characters.');
        break;
      case 'DROPDOWN':
      case 'RADIO':
        if (value && !f.options.includes(value)) throw badRequest(`Choose one of the options for ${describe(f)}.`);
        break;
      case 'NUMBER':
        if (value) {
          const n = parseNumber(value);
          if (n === null) throw badRequest(`Enter a number for ${describe(f)}.`);
          value = String(n);
        }
        break;
      case 'FORMULA': {
        // Always computed here; the client's value is ignored
        const result = evaluateFormula(f.formula ?? '', (label) => parseNumber(byLabel(label)));
        value = result === null ? null : String(result);
        break;
      }
      case 'ATTACHMENT':
        if (value && !attachments.some((a) => a.id === value && a.fieldId === f.id)) throw badRequest(`Upload the file again for ${describe(f)}.`);
        break;
    }
    if (f.required && !value && f.type !== 'FORMULA') throw badRequest(`Complete all required fields (${describe(f)}).`);
    out.push({ id: f.id, value });
  }
  return out;
}
