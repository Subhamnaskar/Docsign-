'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell, useMe } from '@/components/AppShell';
import { CompliancePanel } from '@/components/CompliancePanel';
import { AiReviewPanel } from '@/components/AiPanels';
import { FieldEditor, newFieldId } from '@/components/FieldEditor';
import { SaveTemplateModal } from '@/components/SaveTemplateModal';
import { Alert, Button, Card, cx, Input, Label, PageLoader, Select, Spinner, Textarea } from '@/components/ui';
import { api, ApiError, upload } from '@/lib/api';
import { FIELD_LABELS } from '@/lib/format';
import { LANGUAGES } from '@/lib/i18n';
import type { Envelope, Estamp, Field, Option } from '@/lib/types';

const STEPS = ['Documents', 'Recipients', 'Fields', 'Review & send'] as const;

interface Options {
  jurisdictions: Option[];
  documentTypes: Option[];
  indianStates?: Option[];
}

interface RecipientDraft {
  key: string;
  id?: string;
  name: string;
  email: string;
  role: 'SIGNER' | 'APPROVER' | 'CC';
  routingOrder: number;
  locale: string;
  inPerson: boolean;
  authMethod: 'EMAIL_OTP' | 'SMS_OTP' | 'WHATSAPP_OTP' | 'ACCESS_CODE';
  phone: string;
  /** New access code to set; empty keeps the existing one */
  accessCode: string;
  hasAccessCode: boolean;
  embedded: boolean;
  signatureMethod: 'ELECTRONIC' | 'AADHAAR_ESIGN' | 'DSC';
}

let keySeq = 0;
const newKey = () => `r${keySeq++}`;

function Stepper({ step, onStep, maxStep }: { step: number; onStep: (s: number) => void; maxStep: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm">
      {STEPS.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          <button
            disabled={i > maxStep}
            onClick={() => onStep(i)}
            className={cx(
              'flex items-center gap-2 rounded-full px-3 py-1.5 font-medium',
              i === step ? 'bg-brand-600 text-white' : i <= maxStep ? 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50' : 'text-gray-400',
            )}
          >
            <span className={cx('flex h-5 w-5 items-center justify-center rounded-full text-xs', i === step ? 'bg-white/20' : 'bg-gray-100')}>{i + 1}</span>
            {label}
          </button>
          {i < STEPS.length - 1 && <span className="hidden h-px w-6 bg-gray-300 sm:block" />}
        </li>
      ))}
    </ol>
  );
}

function DocumentsStep({ env, onEnvelope, options }: { env: Envelope; onEnvelope: (e: Envelope) => void; options: Options }) {
  const [uploading, setUploading] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [link, setLink] = useState('');
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function importLink(e: React.FormEvent) {
    e.preventDefault();
    setImporting(true);
    setError(null);
    try {
      await api(`/envelopes/${env.id}/documents/import`, { method: 'POST', json: { url: link.trim() } });
      setLink('');
      onEnvelope(await api<Envelope>(`/envelopes/${env.id}`));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  async function patch(data: Partial<Envelope>) {
    try {
      onEnvelope(await api<Envelope>(`/envelopes/${env.id}`, { method: 'PATCH', json: data }));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function addFiles(files: FileList | File[]) {
    setError(null);
    for (const file of Array.from(files)) {
      setUploading((u) => [...u, file.name]);
      try {
        await upload(`/envelopes/${env.id}/documents`, file);
      } catch (err) {
        setError(`${file.name}: ${(err as Error).message}`);
      } finally {
        setUploading((u) => u.filter((n) => n !== file.name));
      }
    }
    onEnvelope(await api<Envelope>(`/envelopes/${env.id}`));
  }

  async function removeDoc(id: string) {
    await api(`/envelopes/${env.id}/documents/${id}`, { method: 'DELETE' });
    onEnvelope(await api<Envelope>(`/envelopes/${env.id}`));
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <Card className="p-5">
          <h2 className="mb-4 font-semibold">Documents</h2>
          {error && (
            <div className="mb-4">
              <Alert>{error}</Alert>
            </div>
          )}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              addFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            className={cx(
              'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
              dragOver ? 'border-brand-500 bg-brand-50' : 'border-gray-300 hover:border-brand-500 hover:bg-gray-50',
            )}
          >
            <svg className="h-10 w-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />
            </svg>
            <p className="mt-2 text-sm font-medium text-gray-700">Drop files here or click to browse</p>
            <p className="text-xs text-gray-500">PDF, Word, Excel, PowerPoint, ODT, RTF or TXT, up to 25 MB</p>
            <input
              ref={inputRef}
              type="file"
              multiple
              hidden
              accept=".pdf,.doc,.docx,.odt,.rtf,.txt,.xls,.xlsx,.ods,.ppt,.pptx,.odp"
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
          </div>
          <form onSubmit={importLink} className="mt-3 flex gap-2">
            <Input
              type="url"
              placeholder="Or paste a Google Drive, Dropbox or OneDrive share link"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              aria-label="Import from a link"
            />
            <Button type="submit" variant="secondary" loading={importing} disabled={!link.trim()}>
              Import
            </Button>
          </form>
          <ul className="mt-4 space-y-2">
            {env.documents.map((d) => (
              <li key={d.id} className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2.5">
                <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600">PDF</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{d.name}</div>
                  <div className="truncate font-mono text-[11px] text-gray-400" title={d.sha256}>
                    {d.pageCount} page{d.pageCount === 1 ? '' : 's'} · SHA-256 {d.sha256.slice(0, 16)}…
                  </div>
                </div>
                <button onClick={() => removeDoc(d.id)} className="text-sm text-gray-400 hover:text-red-600">
                  Remove
                </button>
              </li>
            ))}
            {uploading.map((n) => (
              <li key={n} className="flex items-center gap-3 rounded-lg border border-dashed border-gray-200 px-3 py-2.5 text-sm text-gray-500">
                <Spinner className="h-4 w-4" /> Uploading {n}…
              </li>
            ))}
          </ul>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="font-semibold">Details</h2>
          <div>
            <Label htmlFor="title">Agreement title</Label>
            <Input id="title" defaultValue={env.title} maxLength={200} onBlur={(e) => e.target.value.trim() && e.target.value !== env.title && patch({ title: e.target.value.trim() })} />
          </div>
          <div>
            <Label htmlFor="message" hint="(optional, included in the email)">
              Message to recipients
            </Label>
            <Textarea id="message" rows={3} defaultValue={env.message ?? ''} maxLength={2000} onBlur={(e) => e.target.value !== (env.message ?? '') && patch({ message: e.target.value || null })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="jurisdiction">Governing jurisdiction</Label>
              <Select id="jurisdiction" value={env.jurisdiction} onChange={(e) => patch({ jurisdiction: e.target.value })}>
                {options.jurisdictions.map((j) => (
                  <option key={j.code} value={j.code}>
                    {j.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="doctype">Document type</Label>
              <Select id="doctype" value={env.documentType} onChange={(e) => patch({ documentType: e.target.value })}>
                {options.documentTypes.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="reminders">Automatic reminders</Label>
              <Select id="reminders" value={env.reminderDays} onChange={(e) => patch({ reminderDays: Number(e.target.value) })}>
                <option value={0}>Off</option>
                <option value={1}>Every day</option>
                <option value={2}>Every 2 days</option>
                <option value={3}>Every 3 days</option>
                <option value={7}>Every week</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="expires" hint="(optional)">
                Expires on
              </Label>
              <Input
                id="expires"
                type="date"
                min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
                defaultValue={env.expiresAt?.slice(0, 10) ?? ''}
                onChange={(e) => patch({ expiresAt: e.target.value ? new Date(`${e.target.value}T23:59:59`).toISOString() : null })}
              />
            </div>
          </div>
        </Card>
      </div>
      <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <CompliancePanel policy={env.policy} />
        {env.jurisdiction === 'IN' && <EstampCard env={env} onEnvelope={onEnvelope} states={options.indianStates ?? []} />}
      </div>
    </div>
  );
}

/** India: stamp duty details; the e-stamp is bought and attached as page 1 when the agreement is sent. */
function EstampCard({ env, onEnvelope, states }: { env: Envelope; onEnvelope: (e: Envelope) => void; states: Option[] }) {
  const [form, setForm] = useState<Estamp>(
    env.estamp ?? { state: states[0]?.code ?? 'MH', article: '', dutyAmount: 100, firstParty: '', secondParty: '', purpose: env.title },
  );
  const [enabled, setEnabled] = useState(Boolean(env.estamp) || Boolean(env.policy.stampDutyRequired));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (k: keyof Estamp) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: k === 'dutyAmount' ? Number(e.target.value) : e.target.value }));

  async function save(on: boolean) {
    setError(null);
    setSaved(false);
    try {
      onEnvelope(await api<Envelope>(`/envelopes/${env.id}`, { method: 'PATCH', json: { estamp: on ? form : null } }));
      setSaved(on);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Card className="p-4 text-sm">
      <label className="flex items-center gap-2 font-semibold">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            if (!e.target.checked) save(false);
          }}
        />
        e-Stamp (stamp duty)
      </label>
      {env.policy.stampDutyRequired && <p className="mt-1 text-xs text-amber-700">Required for this document type.</p>}
      {enabled && (
        <div className="mt-3 space-y-2">
          <Select value={form.state} onChange={set('state')} aria-label="State">
            {states.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </Select>
          <Input placeholder="Article, e.g. Article 5(h)" value={form.article} onChange={set('article')} />
          <Input type="number" min={1} placeholder="Duty amount (₹)" value={form.dutyAmount} onChange={set('dutyAmount')} />
          <Input placeholder="First party (pays duty)" value={form.firstParty} onChange={set('firstParty')} />
          <Input placeholder="Second party" value={form.secondParty} onChange={set('secondParty')} />
          <Input placeholder="Purpose" value={form.purpose} onChange={set('purpose')} />
          {error && <p className="text-red-600">{error}</p>}
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => save(true)}>
              Save stamp details
            </Button>
            {saved && <span className="text-green-700">Saved</span>}
          </div>
          <p className="text-xs text-gray-500">The e-stamp is purchased and added as page 1 when you send.</p>
        </div>
      )}
    </Card>
  );
}

function RecipientsStep({
  env,
  drafts,
  setDrafts,
  onRouting,
}: {
  env: Envelope;
  drafts: RecipientDraft[];
  setDrafts: (d: RecipientDraft[]) => void;
  onRouting: (routing: Envelope['routing']) => void;
}) {
  const me = useMe();
  const sequential = env.routing === 'SEQUENTIAL';
  const update = (key: string, patch: Partial<RecipientDraft>) => setDrafts(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const add = (r?: Partial<RecipientDraft>) =>
    setDrafts([
      ...drafts,
      { key: newKey(), name: '', email: '', role: 'SIGNER', locale: 'en', inPerson: false, authMethod: 'EMAIL_OTP', phone: '', accessCode: '', hasAccessCode: false, embedded: false, signatureMethod: env.jurisdiction === 'IN' && env.policy.signatureLevel !== 'SES' ? 'AADHAAR_ESIGN' : 'ELECTRONIC', routingOrder: Math.max(0, ...drafts.map((d) => d.routingOrder)) + 1, ...r },
    ]);

  return (
    <Card className="mx-auto max-w-3xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Who needs to sign?</h2>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={sequential}
            onChange={(e) => onRouting(e.target.checked ? 'SEQUENTIAL' : 'PARALLEL')}
          />
          Set signing order
        </label>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        {sequential ? 'Recipients sign in the order shown. Use the same number to let people sign at the same time.' : 'Everyone receives the request at once.'}
      </p>
      <div className="mt-5 space-y-3">
        {drafts.map((d, i) => (
          <div key={d.key} className={cx(`signer-${i % 6}`, 'flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 border-l-4 border-l-[var(--signer)] p-3')}>
            {sequential && (
              <div className="w-16">
                <Label>Order</Label>
                <Input type="number" min={1} max={50} value={d.routingOrder} onChange={(e) => update(d.key, { routingOrder: Math.max(1, Number(e.target.value) || 1) })} />
              </div>
            )}
            <div className="min-w-[140px] flex-1">
              <Label>Name</Label>
              <Input value={d.name} onChange={(e) => update(d.key, { name: e.target.value })} placeholder="Full name" />
            </div>
            <div className="min-w-[180px] flex-1">
              <Label>Email</Label>
              <Input type="email" value={d.email} onChange={(e) => update(d.key, { email: e.target.value })} placeholder="name@example.com" />
            </div>
            <div className="w-36">
              <Label>Role</Label>
              <Select value={d.role} onChange={(e) => update(d.key, { role: e.target.value as RecipientDraft['role'], inPerson: false })}>
                <option value="SIGNER">Needs to sign</option>
                <option value="APPROVER">Needs to approve</option>
                <option value="CC">Receives a copy</option>
              </Select>
              {d.role === 'SIGNER' && (
                <div className="mt-1.5 flex gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-gray-600" title="You hand your device to the signer; no email is sent">
                    <input type="checkbox" checked={d.inPerson} onChange={(e) => update(d.key, { inPerson: e.target.checked, embedded: false })} /> In person
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-gray-600" title="Signs inside your own app via the API; no email is sent">
                    <input type="checkbox" checked={d.embedded} onChange={(e) => update(d.key, { embedded: e.target.checked, inPerson: false })} /> Embedded
                  </label>
                </div>
              )}
            </div>
            <div className="w-32">
              <Label>Language</Label>
              <Select value={d.locale} onChange={(e) => update(d.key, { locale: e.target.value })}>
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </div>
            {d.role === 'SIGNER' && (
              <div className="w-48">
                <Label>Sign with</Label>
                <Select value={d.signatureMethod} onChange={(e) => update(d.key, { signatureMethod: e.target.value as RecipientDraft['signatureMethod'] })}>
                  <option value="ELECTRONIC">Electronic signature</option>
                  {env.jurisdiction === 'IN' && <option value="AADHAAR_ESIGN">Aadhaar eSign</option>}
                  <option value="DSC">DSC token</option>
                </Select>
              </div>
            )}
            {d.role !== 'CC' && !d.inPerson && !d.embedded && (
              <div className="flex w-full flex-wrap items-end gap-3">
                <div className="w-48">
                  <Label>Verify identity by</Label>
                  <Select value={d.authMethod} onChange={(e) => update(d.key, { authMethod: e.target.value as RecipientDraft['authMethod'] })}>
                    <option value="EMAIL_OTP">Email code</option>
                    <option value="SMS_OTP">SMS code</option>
                    <option value="WHATSAPP_OTP">WhatsApp code</option>
                    <option value="ACCESS_CODE">Access code I share</option>
                  </Select>
                </div>
                {(d.authMethod === 'SMS_OTP' || d.authMethod === 'WHATSAPP_OTP') && (
                  <div className="w-48">
                    <Label>Mobile number</Label>
                    <Input type="tel" placeholder="+919876543210" value={d.phone} onChange={(e) => update(d.key, { phone: e.target.value.replace(/[^\d+]/g, '') })} />
                  </div>
                )}
                {d.authMethod === 'ACCESS_CODE' && (
                  <div className="w-48">
                    <Label>Access code</Label>
                    <Input
                      placeholder={d.hasAccessCode ? 'Leave blank to keep' : 'e.g. BLUE-7731'}
                      value={d.accessCode}
                      onChange={(e) => update(d.key, { accessCode: e.target.value })}
                    />
                  </div>
                )}
              </div>
            )}
            <button onClick={() => setDrafts(drafts.filter((x) => x.key !== d.key))} className="mb-2 text-sm text-gray-400 hover:text-red-600" aria-label="Remove recipient">
              Remove
            </button>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => add()}>
          + Add recipient
        </Button>
        {me?.user && !drafts.some((d) => d.email.toLowerCase() === me.user!.email) && (
          <Button variant="ghost" onClick={() => add({ name: me.user!.name, email: me.user!.email })}>
            + Add me
          </Button>
        )}
      </div>
    </Card>
  );
}

function ReviewStep({ env }: { env: Envelope }) {
  const me = useMe();
  const ai = Boolean(me?.features?.ai && me.organization.aiEnabled);
  const signers = env.recipients.filter((r) => r.role === 'SIGNER');
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <Card className="p-5">
        <h2 className="text-lg font-semibold">{env.title}</h2>
        {env.message && <p className="mt-2 whitespace-pre-wrap text-sm text-gray-600">{env.message}</p>}
        <h3 className="mt-6 text-sm font-semibold text-gray-900">Documents</h3>
        <ul className="mt-2 space-y-1 text-sm text-gray-600">
          {env.documents.map((d) => (
            <li key={d.id}>
              {d.name} · {d.pageCount} page{d.pageCount === 1 ? '' : 's'}
            </li>
          ))}
        </ul>
        <h3 className="mt-6 text-sm font-semibold text-gray-900">Recipients {env.routing === 'SEQUENTIAL' ? '(in order)' : '(all at once)'}</h3>
        <ul className="mt-2 space-y-2 text-sm">
          {env.recipients.map((r) => {
            const fields = env.fields.filter((f) => f.recipientId === r.id);
            const counts = Object.entries(fields.reduce<Record<string, number>>((acc, f) => ({ ...acc, [f.type]: (acc[f.type] ?? 0) + 1 }), {}));
            return (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 rounded-lg bg-gray-50 px-3 py-2">
                {env.routing === 'SEQUENTIAL' && <span className="text-xs font-semibold text-gray-400">{r.routingOrder}.</span>}
                <span className="font-medium">{r.name}</span>
                <span className="text-gray-500">{r.email}</span>
                <span className="text-xs text-gray-400">
                  {r.role === 'CC'
                    ? 'Receives a copy'
                    : r.role === 'APPROVER'
                      ? 'Approves'
                      : counts.map(([t, n]) => `${n} ${FIELD_LABELS[t].toLowerCase()}`).join(', ')}
                  {r.inPerson && ' · in person'}
                </span>
              </li>
            );
          })}
        </ul>
        {env.readiness.length > 0 && (
          <div className="mt-6">
            <Alert tone="warning" title="Before you can send">
              <ul className="list-disc pl-4">
                {env.readiness.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Alert>
          </div>
        )}
        {signers.length > 0 && env.readiness.length === 0 && env.policy.allowed && (
          <p className="mt-6 text-sm text-gray-500">
            Each signer gets an email with a personal link and verifies their identity with a one-time passcode before signing.
          </p>
        )}
      </Card>
      <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <CompliancePanel policy={env.policy} />
        {ai && <AiReviewPanel envelopeId={env.id} />}
      </div>
    </div>
  );
}

function Builder() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [env, setEnv] = useState<Envelope | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [step, setStep] = useState(0);
  const [drafts, setDrafts] = useState<RecipientDraft[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; problems: string[] } | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<string | null>(null);

  async function detectFields() {
    setDetecting(true);
    setError(null);
    try {
      const res = await api<{ method: 'ai' | 'rules'; fields: Omit<Field, 'id' | 'required'>[] }>(`/envelopes/${id}/ai/detect-fields`, { method: 'POST' });
      // Skip suggestions that overlap a field already placed
      const overlaps = (a: Omit<Field, 'id' | 'required'>, b: Field) =>
        a.documentId === b.documentId && a.page === b.page && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      const fresh = res.fields.filter((f) => !fields.some((g) => overlaps(f, g)));
      setFields((current) => [...current, ...fresh.map((f) => ({ ...f, id: newFieldId(), required: f.type !== 'TEXT', options: [], formula: null, condition: null }))]);
      setDetected(fresh.length ? `Added ${fresh.length} suggested field${fresh.length === 1 ? '' : 's'} (${res.method === 'ai' ? 'AI' : 'layout rules'}). Review them before sending.` : 'No new fields found.');
    } catch (err) {
      setError({ message: (err as Error).message, problems: [] });
    } finally {
      setDetecting(false);
    }
  }

  const adopt = useCallback((e: Envelope) => {
    setEnv(e);
    setDrafts(
      e.recipients.map((r) => ({
        key: newKey(),
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role,
        routingOrder: r.routingOrder,
        locale: r.locale,
        inPerson: Boolean(r.inPerson),
        authMethod: r.authMethod && r.authMethod !== 'NONE' ? r.authMethod : 'EMAIL_OTP',
        phone: r.phone ?? '',
        accessCode: '',
        hasAccessCode: Boolean(r.hasAccessCode),
        embedded: Boolean(r.embedded),
        signatureMethod: r.signatureMethod ?? 'ELECTRONIC',
      })),
    );
    setFields(e.fields);
  }, []);

  useEffect(() => {
    api<Envelope>(`/envelopes/${id}`)
      .then((e) => {
        if (e.status !== 'DRAFT') router.replace(`/envelopes/${id}`);
        else adopt(e);
      })
      .catch((err) => setError({ message: err.message, problems: [] }));
    api<typeof options>('/policy/options').then(setOptions);
  }, [id, router, adopt]);

  if (!env || !options) return error ? <Alert>{error.message}</Alert> : <PageLoader />;

  const signers = env.recipients.filter((r) => r.role === 'SIGNER');
  const maxStep = env.documents.length === 0 ? 0 : signers.length === 0 ? 1 : 3;

  /** Persists the current step's local edits before moving. */
  async function saveStep(): Promise<boolean> {
    setError(null);
    setSaving(true);
    try {
      if (step === 1) {
        const invalid = drafts.find((d) => !d.name.trim() || !/^\S+@\S+\.\S+$/.test(d.email.trim()));
        if (invalid) throw new ApiError(400, 'Enter a name and a valid email for every recipient.');
        adopt(
          await api<Envelope>(`/envelopes/${id}/recipients`, {
            method: 'PUT',
            json: drafts.map(({ id: rid, name, email, role, routingOrder, locale, inPerson, authMethod, phone, accessCode, embedded, signatureMethod }) => ({
              id: rid,
              name: name.trim(),
              email: email.trim(),
              role,
              routingOrder,
              locale,
              inPerson,
              embedded,
              authMethod: role === 'CC' ? 'EMAIL_OTP' : authMethod,
              phone: phone.trim() || null,
              accessCode: accessCode.trim() || null,
              signatureMethod: role === 'SIGNER' ? signatureMethod : 'ELECTRONIC',
            })),
          }),
        );
      } else if (step === 2) {
        adopt(
          await api<Envelope>(`/envelopes/${id}/fields`, {
            method: 'PUT',
            json: fields.map(({ documentId, recipientId, type, page, x, y, width, height, required, label, options, formula, condition, amount, currency }) => ({
              documentId,
              recipientId,
              type,
              page,
              x,
              y,
              width,
              height,
              required,
              label,
              options: (options ?? []).map((o) => o.trim()).filter(Boolean),
              formula,
              condition,
              amount,
              currency,
            })),
          }),
        );
      } else {
        adopt(await api<Envelope>(`/envelopes/${id}`));
      }
      return true;
    } catch (err) {
      setError({ message: (err as Error).message, problems: err instanceof ApiError ? err.problems : [] });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function go(next: number) {
    if (await saveStep()) setStep(next);
  }

  async function send() {
    setSaving(true);
    setError(null);
    try {
      await api(`/envelopes/${id}/send`, { method: 'POST' });
      router.push(`/envelopes/${id}?sent=1`);
    } catch (err) {
      setError({ message: (err as Error).message, problems: err instanceof ApiError ? err.problems : [] });
      setSaving(false);
    }
  }

  async function discard() {
    if (!confirm('Delete this draft? This cannot be undone.')) return;
    await api(`/envelopes/${id}`, { method: 'DELETE' });
    router.push('/dashboard');
  }

  const canNext = step === 0 ? env.documents.length > 0 : step === 1 ? drafts.some((d) => d.role === 'SIGNER') : true;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Draft</p>
          <h1 className="truncate text-xl font-semibold">{env.title}</h1>
        </div>
        <Stepper step={step} maxStep={maxStep} onStep={(s) => s !== step && go(s)} />
      </div>

      {error && (
        <div className="mb-4">
          <Alert title={error.message}>
            {error.problems.length > 0 && (
              <ul className="list-disc pl-4">
                {error.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </Alert>
        </div>
      )}

      {step === 0 && <DocumentsStep env={env} onEnvelope={adopt} options={options} />}
      {step === 1 && (
        <RecipientsStep
          env={env}
          drafts={drafts}
          setDrafts={setDrafts}
          onRouting={async (routing) => {
            await api(`/envelopes/${id}`, { method: 'PATCH', json: { routing } });
            // Keep unsaved recipient edits; only the routing mode changes
            setEnv((e) => e && { ...e, routing });
          }}
        />
      )}
      {step === 2 && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="sm" loading={detecting} onClick={detectFields}>
              ✨ Detect fields
            </Button>
            {detected && <span className="text-sm text-gray-500">{detected}</span>}
          </div>
          <FieldEditor envelopeId={env.id} documents={env.documents} recipients={env.recipients} fields={fields} onChange={setFields} />
        </>
      )}
      {step === 3 && <ReviewStep env={env} />}

      {templateOpen && <SaveTemplateModal env={env} open onClose={() => setTemplateOpen(false)} />}

      <div className="sticky bottom-0 z-20 -mx-4 mt-8 flex items-center gap-3 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <Button variant="ghost" className="text-red-600" onClick={discard}>
          Delete draft
        </Button>
        <div className="ml-auto flex gap-2">
          {step === 3 && (
            <Button variant="secondary" onClick={() => setTemplateOpen(true)}>
              Save as template
            </Button>
          )}
          {step > 0 && (
            <Button variant="secondary" onClick={() => go(step - 1)} disabled={saving}>
              Back
            </Button>
          )}
          {step < 3 ? (
            <Button onClick={() => go(step + 1)} loading={saving} disabled={!canNext}>
              Next
            </Button>
          ) : (
            <Button onClick={send} loading={saving} disabled={env.readiness.length > 0 || !env.policy.allowed}>
              Send for signature
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

export default function EditEnvelopePage() {
  return (
    <AppShell wide>
      <Builder />
    </AppShell>
  );
}
