'use client';

import { useEffect, useRef, useState } from 'react';
import { fileUrl } from '@/lib/api';
import { FIELD_LABELS } from '@/lib/format';
import type { DocumentInfo, Field, FieldType, Recipient } from '@/lib/types';
import { displaySize, PdfPages } from './PdfPages';
import { Button, cx, Input, Label, Select } from './ui';

/** Default field sizes in PDF points. */
const DEFAULT_SIZE: Record<FieldType, [number, number]> = {
  SIGNATURE: [170, 48],
  INITIALS: [64, 40],
  DATE_SIGNED: [100, 20],
  NAME: [160, 20],
  EMAIL: [190, 20],
  TEXT: [160, 20],
  CHECKBOX: [16, 16],
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
];

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
      required: placing !== 'CHECKBOX',
      label: null,
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
              {(selectedField.type === 'TEXT' || selectedField.type === 'CHECKBOX') && (
                <div>
                  <Label htmlFor="field-label">Label</Label>
                  <Input
                    id="field-label"
                    value={selectedField.label ?? ''}
                    placeholder={selectedField.type === 'TEXT' ? 'e.g. Job title' : 'e.g. I accept the terms'}
                    onChange={(e) => update(selectedField.id, { label: e.target.value || null })}
                  />
                </div>
              )}
              {!['NAME', 'EMAIL', 'DATE_SIGNED'].includes(selectedField.type) && (
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
