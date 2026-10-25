'use client';

import { useEffect, useRef, useState } from 'react';
import { fileUrl } from '@/lib/api';
import { FIELD_LABELS } from '@/lib/format';
import type { DocumentInfo, Field, FieldType, Recipient } from '@/lib/types';
import { displaySize, PdfPages } from './PdfPages';
import { Button, cx, Input, Label, Select, Textarea } from './ui';

/** Default field sizes in PDF points. */
const DEFAULT_SIZE: Record<FieldType, [number, number]> = {
  SIGNATURE: [170, 48],
  INITIALS: [64, 40],
  DATE_SIGNED: [100, 20],
  NAME: [160, 20],
  EMAIL: [190, 20],
  TEXT: [160, 20],
  CHECKBOX: [16, 16],
  DROPDOWN: [140, 20],
  RADIO: [180, 20],
  NUMBER: [90, 20],
  FORMULA: [90, 20],
  ATTACHMENT: [160, 22],
  PAYMENT: [150, 24],
  MANDATE: [190, 24],
};
const MIN_SIZE_PT = 12;

const PALETTE: { type: FieldType; icon: string }[] = [
  { type: 'SIGNATURE', icon: 'M3 17c3-1 4-9 6.5-9S10 15 12 15s2-4 5-4' },
  { type: 'INITIALS', icon: 'M5 18V6m0 12h4M14 6v12l5-12v12' },
  { type: 'DATE_SIGNED', icon: 'M6 4v2m8-2v2M4 9h12M5 6h10a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z' },
  { type: 'NAME', icon: 'M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-6 7a6 6 0 0 1 12 0' },
  { type: 'EMAIL', icon: 'M3 6h14v9H3zm0 0 7 5 7-5' },
  { type: 'TEXT', icon: 'M4 6h12M10 6v10' },
  { type: 'CHECKBOX', icon: 'M4 4h12v12H4zm3 6 2 2 4-4' },
  { type: 'DROPDOWN', icon: 'M3 6h14v8H3zm9 3 2 2 2-2' },
  { type: 'RADIO', icon: 'M7 10a3 3 0 1 0 0-.01M14 10a3 3 0 1 0 0-.01' },
  { type: 'NUMBER', icon: 'M7 4 5 16m8-12-2 12M4 8h12M3 12h12' },
  { type: 'FORMULA', icon: 'M5 15c2 0 2-10 5-10M5 9h6m2 2 4 4m0-4-4 4' },
  { type: 'ATTACHMENT', icon: 'M14 9l-5 5a2.5 2.5 0 0 1-3.5-3.5L11 5a1.7 1.7 0 0 1 2.4 2.4L8 12.8' },
  { type: 'PAYMENT', icon: 'M3 6h14v9H3zM3 9h14M6 12h3' },
  { type: 'MANDATE', icon: 'M4 8l6-4 6 4M5 8v6m3-6v6m4-6v6m3-6v6M3 16h14' },
];

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'BRL', 'JPY'];

/** Types whose label others can reference in formulas and conditions. */
const NEEDS_LABEL: FieldType[] = ['TEXT', 'CHECKBOX', 'DROPDOWN', 'RADIO', 'NUMBER', 'FORMULA', 'ATTACHMENT', 'PAYMENT', 'MANDATE'];

const MANDATE_FREQUENCIES = [
  ['MONTHLY', 'Monthly'],
  ['QUARTERLY', 'Quarterly'],
  ['HALF_YEARLY', 'Half-yearly'],
  ['YEARLY', 'Yearly'],
  ['AS_PRESENTED', 'As presented'],
] as const;

function uniqueLabel(fields: Field[], base: string): string {
  const taken = new Set(fields.map((f) => f.label));
  for (let i = 1; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
}

function conditionDefault(fields: Field[], label: string): string {
  const f = fields.find((x) => x.label === label);
  if (f?.type === 'CHECKBOX') return 'true';
  return f?.options?.[0] ?? '';
}

let tmpCounter = 0;
export const newFieldId = () => `tmp_${Date.now().toString(36)}_${tmpCounter++}`;

export function FieldEditor({
  envelopeId,
  documents,
  recipients,
  fields,
  onChange,
}: {
  envelopeId: string;
  documents: DocumentInfo[];
  recipients: Recipient[];
  fields: Field[];
  onChange: (fields: Field[]) => void;
}) {
  const signers = recipients.filter((r) => r.role === 'SIGNER');
  const [docId, setDocId] = useState(documents[0]?.id);
  const [activeSigner, setActiveSigner] = useState(signers[0]?.id);
  const [placing, setPlacing] = useState<FieldType | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;

  const doc = documents.find((d) => d.id === docId) ?? documents[0];
  const signerIndex = (id: string) => Math.max(0, signers.findIndex((s) => s.id === id)) % 6;
  const selectedField = fields.find((f) => f.id === selected);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        onChange(fieldsRef.current.filter((f) => f.id !== selected));
        setSelected(null);
      }
      if (e.key === 'Escape') {
        setPlacing(null);
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, onChange]);

  if (!doc) return null;

  const update = (id: string, patch: Partial<Field>) =>
    onChange(fieldsRef.current.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  function place(page: number, clickX: number, clickY: number) {
    if (!placing || !activeSigner) {
      setSelected(null);
      return;
    }
    const size = displaySize(doc.pages[page]);
    const [wPt, hPt] = DEFAULT_SIZE[placing];
    const w = Math.min(wPt / size.width, 1);
    const h = Math.min(hPt / size.height, 1);
    const field: Field = {
      id: newFieldId(),
      documentId: doc.id,
      recipientId: activeSigner,
      type: placing,
      page,
      x: Math.min(Math.max(clickX - w / 2, 0), 1 - w),
      y: Math.min(Math.max(clickY - h / 2, 0), 1 - h),
      width: w,
      height: h,
      required: placing !== 'CHECKBOX' && placing !== 'FORMULA',
      label: NEEDS_LABEL.includes(placing) ? uniqueLabel(fieldsRef.current, FIELD_LABELS[placing]) : null,
      options: placing === 'DROPDOWN' || placing === 'RADIO' ? ['Option 1', 'Option 2'] : [],
      formula: placing === 'FORMULA' ? '' : null,
      condition: null,
      amount: placing === 'PAYMENT' ? 100_00 : placing === 'MANDATE' ? 5000_00 : null,
      currency: placing === 'PAYMENT' || placing === 'MANDATE' ? 'INR' : null,
      config: placing === 'MANDATE' ? { frequency: 'MONTHLY', months: 12 } : null,
    };
    onChange([...fieldsRef.current, field]);
    setSelected(field.id);
    setPlacing(null);
  }

  /** Shared pointer-drag logic for moving and resizing. */
  function startDrag(e: React.PointerEvent, f: Field, mode: 'move' | 'resize') {
    e.stopPropagation();
    e.preventDefault();
    setSelected(f.id);
    const pageEl = (e.currentTarget as HTMLElement).closest('[data-page]') as HTMLElement;
    const rect = pageEl.getBoundingClientRect();
    const size = displaySize(doc.pages[f.page]);
    const start = { px: e.clientX, py: e.clientY, x: f.x, y: f.y, w: f.width, h: f.height };
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.px) / rect.width;
      const dy = (ev.clientY - start.py) / rect.height;
      if (mode === 'move') {
        update(f.id, {
          x: Math.min(Math.max(start.x + dx, 0), 1 - start.w),
          y: Math.min(Math.max(start.y + dy, 0), 1 - start.h),
        });
      } else {
        update(f.id, {
          width: Math.min(Math.max(start.w + dx, MIN_SIZE_PT / size.width), 1 - start.x),
          height: Math.min(Math.max(start.h + dy, MIN_SIZE_PT / size.height), 1 - start.y),
        });
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  const countFor = (signerId: string) => fields.filter((f) => f.recipientId === signerId).length;

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <aside className="space-y-5 lg:sticky lg:top-20 lg:w-64 lg:self-start">
        <div>
          <Label>Fields for</Label>
          <div className="space-y-1.5">
            {signers.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setActiveSigner(s.id)}
                className={cx(
                  `signer-${i % 6} flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm`,
                  activeSigner === s.id ? 'border-[var(--signer)] bg-[var(--signer-bg)]' : 'border-gray-200 bg-white hover:bg-gray-50',
                )}
              >
                <span className="h-3 w-3 shrink-0 rounded-full bg-[var(--signer)]" />
                <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                <span className="text-xs text-gray-500">{countFor(s.id)}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label>Add a field</Label>
          <p className="mb-2 text-xs text-gray-500">Choose a field, then click on the page to place it.</p>
          <div className="grid grid-cols-2 gap-1.5">
            {PALETTE.map((p) => (
              <button
                key={p.type}
                onClick={() => setPlacing(placing === p.type ? null : p.type)}
                className={cx(
                  'flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs font-medium',
                  placing === p.type ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
                )}
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d={p.icon} />
                </svg>
                {FIELD_LABELS[p.type]}
              </button>
            ))}
          </div>
        </div>

        {selectedField && (
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="mb-3 text-sm font-semibold">{FIELD_LABELS[selectedField.type]} field</div>
            <div className="space-y-3">
              <div>
                <Label htmlFor="field-signer">Assigned to</Label>
                <Select id="field-signer" value={selectedField.recipientId} onChange={(e) => update(selectedField.id, { recipientId: e.target.value })}>
                  {signers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>
              {NEEDS_LABEL.includes(selectedField.type) && (
                <div>
                  <Label htmlFor="field-label">Label</Label>
                  <Input
                    id="field-label"
                    value={selectedField.label ?? ''}
                    placeholder={selectedField.type === 'CHECKBOX' ? 'e.g. I accept the terms' : 'e.g. Job title'}
                    onChange={(e) => update(selectedField.id, { label: e.target.value || null })}
                  />
                </div>
              )}
              {(selectedField.type === 'DROPDOWN' || selectedField.type === 'RADIO') && (
                <div>
                  <Label htmlFor="field-options" hint="(one per line)">
                    Options
                  </Label>
                  <Textarea
                    id="field-options"
                    rows={4}
                    value={(selectedField.options ?? []).join('\n')}
                    onChange={(e) => update(selectedField.id, { options: e.target.value.split('\n').map((o) => o.trimStart()).slice(0, 50) })}
                  />
                </div>
              )}
              {selectedField.type === 'PAYMENT' && (
                <div className="grid grid-cols-[1fr_90px] gap-2">
                  <div>
                    <Label htmlFor="field-amount">Amount</Label>
                    <Input
                      id="field-amount"
                      type="number"
                      min={0.01}
                      step={0.01}
                      value={selectedField.amount ? selectedField.amount / 100 : ''}
                      onChange={(e) => update(selectedField.id, { amount: Math.round(Number(e.target.value) * 100) || null })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="field-currency">Currency</Label>
                    <Select id="field-currency" value={selectedField.currency ?? 'INR'} onChange={(e) => update(selectedField.id, { currency: e.target.value })}>
                      {CURRENCIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </Select>
                  </div>
                </div>
              )}
              {selectedField.type === 'MANDATE' && (
                <div className="space-y-2">
                  <div>
                    <Label htmlFor="mandate-amount" hint="(₹ per debit)">
                      Maximum debit
                    </Label>
                    <Input
                      id="mandate-amount"
                      type="number"
                      min={1}
                      step={1}
                      value={selectedField.amount ? selectedField.amount / 100 : ''}
                      onChange={(e) => update(selectedField.id, { amount: Math.round(Number(e.target.value) * 100) || null })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label htmlFor="mandate-frequency">Frequency</Label>
                      <Select
                        id="mandate-frequency"
                        value={selectedField.config?.frequency ?? 'MONTHLY'}
                        onChange={(e) => update(selectedField.id, { config: { ...selectedField.config, frequency: e.target.value } })}
                      >
                        {MANDATE_FREQUENCIES.map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="mandate-months">Months</Label>
                      <Input
                        id="mandate-months"
                        type="number"
                        min={1}
                        max={360}
                        value={selectedField.config?.months ?? 12}
                        onChange={(e) => update(selectedField.id, { config: { ...selectedField.config, months: Math.max(1, Math.min(360, Number(e.target.value) || 1)) } })}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-gray-500">The signer authorises recurring debits from their bank account (eNACH) before finishing.</p>
                </div>
              )}
              {selectedField.type === 'FORMULA' && (
                <div>
                  <Label htmlFor="field-formula">Formula</Label>
                  <Input
                    id="field-formula"
                    className="font-mono"
                    placeholder="{Qty} * {Price}"
                    value={selectedField.formula ?? ''}
                    onChange={(e) => update(selectedField.id, { formula: e.target.value })}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Use + − × ÷ and number fields by label:{' '}
                    {fields.filter((f) => f.type === 'NUMBER' && f.label).map((f) => `{${f.label}}`).join(', ') || 'add a Number field first'}
                  </p>
                </div>
              )}
              {selectedField.type !== 'SIGNATURE' && (
                <div>
                  <Label htmlFor="field-cond" hint="(optional)">
                    Show only when
                  </Label>
                  <Select
                    id="field-cond"
                    value={selectedField.condition?.fieldLabel ?? ''}
                    onChange={(e) =>
                      update(selectedField.id, {
                        condition: e.target.value ? { fieldLabel: e.target.value, equals: conditionDefault(fields, e.target.value) } : null,
                      })
                    }
                  >
                    <option value="">Always shown</option>
                    {fields
                      .filter((f) => f.id !== selectedField.id && f.label && ['CHECKBOX', 'DROPDOWN', 'RADIO', 'TEXT'].includes(f.type))
                      .map((f) => (
                        <option key={f.id} value={f.label!}>
                          {f.label}
                        </option>
                      ))}
                  </Select>
                  {selectedField.condition && (
                    <Input
                      className="mt-2"
                      aria-label="Equals"
                      placeholder="equals…"
                      value={selectedField.condition.equals}
                      onChange={(e) => update(selectedField.id, { condition: { ...selectedField.condition!, equals: e.target.value } })}
                    />
                  )}
                  {selectedField.condition && <p className="mt-1 text-xs text-gray-500">For checkboxes use “true” (ticked) or “false”.</p>}
                </div>
              )}
              {!['NAME', 'EMAIL', 'DATE_SIGNED', 'FORMULA'].includes(selectedField.type) && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={selectedField.required} onChange={(e) => update(selectedField.id, { required: e.target.checked })} />
                  Required
                </label>
              )}
              <Button
                variant="secondary"
                size="sm"
                className="w-full text-red-600"
                onClick={() => {
                  onChange(fields.filter((f) => f.id !== selectedField.id));
                  setSelected(null);
                }}
              >
                Delete field
              </Button>
            </div>
          </div>
        )}
      </aside>

      <div className="min-w-0 flex-1">
        {documents.length > 1 && (
          <div className="mb-4 flex flex-wrap gap-1">
            {documents.map((d) => (
              <button
                key={d.id}
                onClick={() => setDocId(d.id)}
                className={cx(
                  'rounded-md px-3 py-1.5 text-sm font-medium',
                  d.id === doc.id ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50',
                )}
              >
                {d.name} <span className="opacity-60">({fields.filter((f) => f.documentId === d.id).length})</span>
              </button>
            ))}
          </div>
        )}
        <div className={cx(placing && '[&_[data-page-surface]]:cursor-crosshair')}>
          <PdfPages
            key={doc.id}
            url={fileUrl(`/envelopes/${envelopeId}/documents/${doc.id}/file?version=original`)}
            pages={doc.pages}
            onPageClick={place}
            overlay={(page) => (
              <div data-page className="pointer-events-none absolute inset-0">
                {fields
                  .filter((f) => f.documentId === doc.id && f.page === page)
                  .map((f) => (
                    <div
                      key={f.id}
                      onPointerDown={(e) => startDrag(e, f, 'move')}
                      className={cx(
                        `signer-${signerIndex(f.recipientId)} pointer-events-auto absolute flex cursor-move items-center overflow-hidden rounded border-2 border-[var(--signer)] bg-[var(--signer-bg)] px-1 text-[11px] font-medium leading-none text-[var(--signer)]`,
                        selected === f.id && 'ring-2 ring-offset-1 ring-[var(--signer)]',
                      )}
                      style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.width * 100}%`, height: `${f.height * 100}%` }}
                      title={`${FIELD_LABELS[f.type]} - ${signers.find((s) => s.id === f.recipientId)?.name ?? ''}`}
                    >
                      {f.type !== 'CHECKBOX' && <span className="truncate">{f.label || FIELD_LABELS[f.type]}{f.required ? '' : ' (optional)'}</span>}
                      {selected === f.id && (
                        <span
                          onPointerDown={(e) => startDrag(e, f, 'resize')}
                          className="absolute -bottom-1 -right-1 h-3 w-3 cursor-se-resize rounded-sm border border-white bg-[var(--signer)]"
                        />
                      )}
                    </div>
                  ))}
              </div>
            )}
          />
        </div>
      </div>
    </div>
  );
}
