import * as z from 'zod/v4';
import { structuredCall } from './claude.js';

/**
 * Field detection: pdf.js finds where things are (text positions, underline
 * runs, "Signature:" labels); the model only decides what each candidate is
 * and which signer it belongs to. Coordinates never come from the model.
 */

export interface Candidate {
  id: string;
  page: number;
  /** Fractions of the page from the top-left, ready to become a field */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The text on the same line, for context */
  line: string;
  kind: 'label' | 'underline';
}

export interface DetectedField {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  type: 'SIGNATURE' | 'INITIALS' | 'DATE_SIGNED' | 'NAME' | 'TEXT';
  recipientIndex: number;
  label: string | null;
}

const LABEL = /\b(signature|sign here|signed by|authori[sz]ed signatory|initials?|date|name|title|designation|witness)\b/i;

interface TextItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export async function extractCandidates(pdf: Buffer, maxPages = 50): Promise<{ candidates: Candidate[]; text: string }> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: new Uint8Array(pdf), isEvalSupported: false, useSystemFonts: true, verbosity: 0 }).promise;
  const candidates: Candidate[] = [];
  const textParts: string[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: TextItem[] = [];
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      // Convert to viewport (top-left origin) coordinates; handles rotation
      const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
      const h = Math.abs(it.transform[3]) || Math.abs(it.height) || 10;
      items.push({ str: it.str, x, y, w: it.width, h });
    }
    // Group into lines by baseline
    const lines: TextItem[][] = [];
    for (const it of items.sort((a, b) => a.y - b.y || a.x - b.x)) {
      const line = lines.find((l) => Math.abs(l[0].y - it.y) < it.h * 0.5);
      if (line) line.push(it);
      else lines.push([it]);
    }
    for (const line of lines) {
      line.sort((a, b) => a.x - b.x);
      const lineText = line.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
      textParts.push(`[p${p}] ${lineText}`);
      for (const it of line) {
        const under = /_{5,}/.exec(it.str);
        if (under) {
          // Width of the underline run within this text item
          const charW = it.w / Math.max(it.str.length, 1);
          const x = it.x + under.index * charW;
          const w = under[0].length * charW;
          const boxH = Math.max(it.h * 2.4, 18);
          candidates.push(box(`c${candidates.length}`, p, x, it.y - boxH + it.h * 0.25, w, boxH, vp, lineText, 'underline'));
        } else if (LABEL.test(it.str) && it.str.trim().length < 40 && !/_{5,}/.test(lineText)) {
          // A label with blank space after it: place the box to its right
          const x = it.x + it.w + 6;
          const w = Math.min(vp.width * 0.3, vp.width - x - 24);
          if (w > 40) candidates.push(box(`c${candidates.length}`, p, x, it.y - it.h * 1.8, w, it.h * 2.4, vp, lineText, 'label'));
        }
      }
    }
  }
  return { candidates, text: textParts.join('\n').slice(0, 60_000) };
}

function box(id: string, page: number, x: number, top: number, w: number, h: number, vp: { width: number; height: number }, line: string, kind: Candidate['kind']): Candidate {
  const clamp = (v: number) => Math.min(Math.max(v, 0), 1);
  const fx = clamp(x / vp.width);
  const fy = clamp(top / vp.height);
  return {
    id,
    page: page - 1,
    x: fx,
    y: fy,
    width: Math.min(w / vp.width, 1 - fx),
    height: Math.min(h / vp.height, 1 - fy),
    line: line.slice(0, 160),
    kind,
  };
}

/** Rule-based fallback: signature lines go to signers in order of appearance. */
export function heuristicAssign(candidates: Candidate[], signers: number): DetectedField[] {
  let next = 0;
  const out: DetectedField[] = [];
  for (const c of candidates) {
    const l = c.line.toLowerCase();
    const type: DetectedField['type'] | null = /initial/.test(l)
      ? 'INITIALS'
      : /signature|sign here|signed|signatory/.test(l)
        ? 'SIGNATURE'
        : /date/.test(l)
          ? 'DATE_SIGNED'
          : /name/.test(l)
            ? 'NAME'
            : c.kind === 'underline'
              ? 'SIGNATURE'
              : null;
    if (!type) continue;
    const recipientIndex = Math.min(next, Math.max(signers - 1, 0));
    if (type === 'SIGNATURE') next++;
    out.push({ page: c.page, x: c.x, y: c.y, width: c.width, height: c.height, type, recipientIndex, label: null });
  }
  return out;
}

const AssignmentSchema = z.object({
  fields: z.array(
    z.object({
      candidateId: z.string(),
      type: z.enum(['SIGNATURE', 'INITIALS', 'DATE_SIGNED', 'NAME', 'TEXT']),
      recipientIndex: z.number().int(),
      label: z.string().nullable(),
    }),
  ),
});

export async function aiAssign(
  candidates: Candidate[],
  text: string,
  recipients: { name: string; role: string }[],
): Promise<DetectedField[]> {
  if (candidates.length === 0) return [];
  const result = await structuredCall({
    schema: AssignmentSchema,
    effort: 'low',
    system:
      'You prepare documents for electronic signature. You receive the document text (prefixed by page) and a list of candidate locations found by a PDF parser. ' +
      'Decide which candidates are places where a party must sign, initial, write the date, write their name, or fill in a short text value, and which party each belongs to. ' +
      'Skip candidates that are not input locations (headings, clauses that merely mention a signature). Use recipientIndex from the recipient list (0-based). ' +
      'For TEXT fields give a short label (e.g. "Job title"); otherwise label is null.',
    content: [
      {
        type: 'text',
        text:
          `Recipients:\n${recipients.map((r, i) => `${i}: ${r.name} (${r.role})`).join('\n')}\n\n` +
          `Candidates:\n${candidates.map((c) => `${c.id} | page ${c.page + 1} | ${c.kind} | line: "${c.line}"`).join('\n')}\n\n` +
          `Document text:\n${text}`,
      },
    ],
  });
  const byId = new Map(candidates.map((c) => [c.id, c]));
  return result.fields.flatMap((f) => {
    const c = byId.get(f.candidateId);
    if (!c || f.recipientIndex < 0 || f.recipientIndex >= recipients.length) return [];
    return [{ page: c.page, x: c.x, y: c.y, width: c.width, height: c.height, type: f.type, recipientIndex: f.recipientIndex, label: f.label }];
  });
}
