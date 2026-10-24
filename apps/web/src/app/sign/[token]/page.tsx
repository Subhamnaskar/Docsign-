'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SignerSummary } from '@/components/AiPanels';
import { PdfPages } from '@/components/PdfPages';
import { SignaturePad } from '@/components/SignaturePad';
import { Alert, Button, Card, cx, Input, Logo, Modal, PageLoader, Textarea } from '@/components/ui';
import { api, fileUrl, upload } from '@/lib/api';
import { evaluateFormula } from '@/lib/formula';
import { FIELD_LABELS } from '@/lib/format';
import { isRtl, LANGUAGES, signerT, type SignerKey, type Translate } from '@/lib/i18n';
import type { Field, PageInfo } from '@/lib/types';

interface SigningSession {
  state: 'ready' | 'waiting' | 'signed' | 'completed' | 'declined' | 'voided' | 'expired' | 'unavailable';
  verified: boolean;
  envelope: { id: string; title: string; message: string | null; sender: { name: string; email: string }; organization: string; expiresAt: string | null };
  recipient: {
    id: string;
    name: string;
    email: string;
    maskedEmail: string;
    status: string;
    locale: string;
    role: string;
    canReassign: boolean;
    authMethod: 'EMAIL_OTP' | 'SMS_OTP' | 'WHATSAPP_OTP' | 'ACCESS_CODE' | 'NONE';
    maskedPhone: string | null;
    embedded: boolean;
    returnUrl: string | null;
    signatureMethod: 'ELECTRONIC' | 'AADHAAR_ESIGN' | 'DSC';
    esignSandbox: boolean;
  };
  branding: { name: string; color: string | null; logoUrl: string | null };
  aiAvailable: boolean;
  compliance: { jurisdiction: string; laws: string[]; signatureLevel: string; consentText: string };
  documents: { id: string; name: string; pageCount: number; pages: PageInfo[] }[];
  fields: Field[];
  /** Labelled values entered by earlier signers (for conditions and formulas) */
  context: Record<string, string>;
}

const STATE_KEYS: Record<string, [SignerKey, SignerKey]> = {
  waiting: ['waitingTitle', 'waitingBody'],
  signed: ['signedTitle', 'signedBody'],
  completed: ['completedTitle', 'completedBody'],
  declined: ['declinedTitle', 'declinedBody'],
  voided: ['voidedTitle', 'voidedBody'],
  expired: ['expiredTitle', 'expiredBody'],
  unavailable: ['unavailableTitle', 'unavailableBody'],
};

/** Re-themes the brand colour scale (used by buttons and accents) with the sender's colour. */
function brandStyle(color: string | null | undefined): React.CSSProperties | undefined {
  if (!color) return undefined;
  return {
    ['--color-brand-50' as string]: `color-mix(in srgb, ${color} 8%, white)`,
    ['--color-brand-100' as string]: `color-mix(in srgb, ${color} 18%, white)`,
    ['--color-brand-500' as string]: `color-mix(in srgb, ${color} 85%, white)`,
    ['--color-brand-600' as string]: color,
    ['--color-brand-700' as string]: `color-mix(in srgb, ${color} 80%, black)`,
  };
}

function Shell({
  children,
  title,
  locale,
  onLocale,
  tr,
  branding,
}: {
  children: React.ReactNode;
  title?: string;
  locale: string;
  onLocale: (l: string) => void;
  tr: Translate;
  branding?: SigningSession['branding'];
}) {
  return (
    <div className="min-h-screen" dir={isRtl(locale) ? 'rtl' : 'ltr'} lang={locale} style={brandStyle(branding?.color)}>
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
          {branding?.logoUrl ? (
            <span className="flex items-center gap-2">
              <img src={branding.logoUrl} alt={branding.name} className="max-h-8 max-w-[160px]" />
              <span className="hidden text-xs text-gray-400 sm:inline">{tr('via')}</span>
            </span>
          ) : (
            <Logo className="text-gray-900" />
          )}
          {title && <span className="min-w-0 flex-1 truncate text-sm text-gray-500">{title}</span>}
          <select
            aria-label={tr('language')}
            value={locale}
            onChange={(e) => onLocale(e.target.value)}
            className="ms-auto rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-gray-700"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}

function Verify({ session, token, onVerified, tr }: { session: SigningSession; token: string; onVerified: () => void; tr: Translate }) {
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function send() {
    setLoading(true);
    setError(null);
    try {
      await api(`/signing/${token}/otp/send`, { method: 'POST' });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api(`/signing/${token}/otp/verify`, { method: 'POST', json: { code } });
      onVerified();
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  const email = session.recipient.maskedEmail;
  const method = session.recipient.authMethod;
  const phone = session.recipient.maskedPhone?.replace(/\D/g, '') ?? '';
  const accessCode = method === 'ACCESS_CODE';
  const intro =
    method === 'SMS_OTP' ? tr('verifyIntroSms', { phone }) : method === 'WHATSAPP_OTP' ? tr('verifyIntroWhatsapp', { phone }) : tr('verifyIntro', { email });
  const sendLabel = method === 'SMS_OTP' ? tr('textCode') : method === 'WHATSAPP_OTP' ? tr('whatsappCode') : tr('emailCode');
  const enterText = method === 'SMS_OTP' || method === 'WHATSAPP_OTP' ? tr('enterCodePhone', { phone }) : tr('enterCode', { email });
  return (
    <Card className="mx-auto max-w-md p-7">
      <p className="text-sm text-gray-500">{tr('sentYou', { sender: session.envelope.sender.name, org: session.envelope.organization })}</p>
      <h1 className="mt-1 text-xl font-semibold">{session.envelope.title}</h1>
      {session.envelope.message && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{session.envelope.message}</p>}
      <div className="mt-6 border-t border-gray-100 pt-6">
        <h2 className="font-medium">{tr('verifyTitle')}</h2>
        {error && (
          <div className="mt-3">
            <Alert>{error}</Alert>
          </div>
        )}
        {accessCode ? (
          <form onSubmit={verify}>
            <p className="mt-1 text-sm text-gray-500">{tr('accessCodeIntro', { sender: session.envelope.sender.name })}</p>
            <Input
              className="mt-4 font-mono"
              dir="ltr"
              autoComplete="off"
              maxLength={32}
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-label={tr('accessCodeLabel')}
              placeholder={tr('accessCodeLabel')}
            />
            <Button type="submit" className="mt-4 w-full" loading={loading} disabled={code.trim().length < 4}>
              {tr('verifyContinue')}
            </Button>
          </form>
        ) : !sent ? (
          <>
            <p className="mt-1 text-sm text-gray-500">{intro}</p>
            <Button className="mt-4 w-full" onClick={send} loading={loading}>
              {sendLabel}
            </Button>
          </>
        ) : (
          <form onSubmit={verify}>
            <p className="mt-1 text-sm text-gray-500">{enterText}</p>
            <Input
              className="mt-4 text-center font-mono text-2xl tracking-[0.5em]"
              dir="ltr"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              aria-label={tr('codeLabel')}
            />
            <Button type="submit" className="mt-4 w-full" loading={loading} disabled={code.length !== 6}>
              {tr('verifyContinue')}
            </Button>
            <button type="button" onClick={send} className="mt-3 w-full text-sm text-gray-500 hover:text-gray-800">
              {tr('newCode')}
            </button>
          </form>
        )}
      </div>
    </Card>
  );
}

function Consent({ session, onAccept, tr }: { session: SigningSession; onAccept: () => void; tr: Translate }) {
  const [checked, setChecked] = useState(false);
  return (
    <Card className="mx-auto max-w-lg p-7">
      <h1 className="text-xl font-semibold">{tr('consentTitle')}</h1>
      <p className="mt-1 text-sm text-gray-500">
        {tr('governingLaw')}: {session.compliance.jurisdiction} ({session.compliance.laws.join('; ')})
      </p>
      {/* The legal disclosure is shown in the governing jurisdiction's wording */}
      <p className="mt-4 rounded-lg bg-gray-50 p-4 text-sm leading-relaxed text-gray-700" dir="ltr" lang="en">
        {session.compliance.consentText}
      </p>
      <label className="mt-5 flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        <span>{tr('consentAgree')}</span>
      </label>
      <Button className="mt-5 w-full" disabled={!checked} onClick={onAccept}>
        {tr('continue')}
      </Button>
    </Card>
  );
}

function SignDocument({
  session,
  token,
  onDone,
  onReassigned,
  tr,
}: {
  session: SigningSession;
  token: string;
  onDone: () => void;
  onReassigned: (name: string) => void;
  tr: Translate;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(session.fields.filter((f) => f.value).map((f) => [f.id, f.value!])),
  );
  const [adopted, setAdopted] = useState<{ signature?: string; initials?: string }>({});
  const [padFor, setPadFor] = useState<Field | null>(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignTo, setReassignTo] = useState({ name: '', email: '', reason: '' });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const autoFilled: Record<string, string> = useMemo(
    () => ({ NAME: session.recipient.name, EMAIL: session.recipient.email, DATE_SIGNED: new Date().toISOString().slice(0, 10) }),
    [session],
  );
  const [uploading, setUploading] = useState<string | null>(null);
  const [fileNames, setFileNames] = useState<Record<string, string>>({});

  /** Current value of a labelled field: this signer's input first, then earlier signers'. */
  const byLabel = useCallback(
    (label: string): string | null => {
      const mine = session.fields.find((f) => f.label === label);
      if (mine) return values[mine.id] ?? (mine.type === 'CHECKBOX' ? 'false' : null);
      return session.context?.[label] ?? null;
    },
    [session, values],
  );
  const visible = useCallback((f: Field) => !f.condition || (byLabel(f.condition.fieldLabel) ?? '') === f.condition.equals, [byLabel]);
  const formulaValue = (f: Field) => {
    if (!f.formula) return null;
    try {
      const v = evaluateFormula(f.formula, (l) => {
        const raw = byLabel(l);
        const n = raw == null || raw.trim() === '' ? NaN : Number(raw.replace(/,/g, ''));
        return Number.isFinite(n) ? n : null;
      });
      return v === null ? null : String(v);
    } catch {
      return null;
    }
  };

  const method = session.recipient.signatureMethod;
  const crypto = method !== 'ELECTRONIC';
  const isDone = useCallback(
    (f: Field) =>
      f.type in autoFilled ||
      f.type === 'FORMULA' ||
      // Aadhaar eSign / DSC signers sign cryptographically instead of drawing
      (crypto && (f.type === 'SIGNATURE' || f.type === 'INITIALS')) ||
      (f.type === 'CHECKBOX' ? values[f.id] === 'true' : Boolean(values[f.id]?.trim())),
    [values, autoFilled, crypto],
  );
  const shown = session.fields.filter(visible);
  const remaining = shown.filter((f) => f.required && !isDone(f));
  const approving = session.recipient.role === 'APPROVER';

  async function uploadAttachment(f: Field, file: File) {
    setUploading(f.id);
    setError(null);
    try {
      const res = await upload<{ id: string; name: string }>(`/signing/${token}/attachments/${f.id}`, file);
      setValues((v) => ({ ...v, [f.id]: res.id }));
      setFileNames((n) => ({ ...n, [f.id]: res.name }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(null);
    }
  }
  const ordered = useMemo(
    () =>
      [...session.fields].sort(
        (a, b) =>
          session.documents.findIndex((d) => d.id === a.documentId) - session.documents.findIndex((d) => d.id === b.documentId) ||
          a.page - b.page ||
          a.y - b.y,
      ),
    [session],
  );

  function next() {
    const target = ordered.find((f) => visible(f) && f.required && !isDone(f)) ?? ordered.find((f) => visible(f) && !isDone(f));
    if (target) document.getElementById(`field-${target.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function activate(f: Field) {
    if (f.type === 'SIGNATURE' || f.type === 'INITIALS') {
      const existing = f.type === 'SIGNATURE' ? adopted.signature : adopted.initials;
      if (existing && !values[f.id]) setValues((v) => ({ ...v, [f.id]: existing }));
      else setPadFor(f);
    } else if (f.type === 'CHECKBOX') {
      setValues((v) => ({ ...v, [f.id]: v[f.id] === 'true' ? 'false' : 'true' }));
    }
  }

  async function finish() {
    setSubmitting(true);
    setError(null);
    try {
      // Hidden (conditional) fields are not submitted
      const submitted = Object.fromEntries(Object.entries(values).filter(([id]) => shown.some((f) => f.id === id)));
      if (method === 'AADHAAR_ESIGN') {
        const res = await api<{ action: string; fields: Record<string, string> }>(`/signing/${token}/esign/start`, {
          method: 'POST',
          json: { consent: true, values: submitted },
        });
        postForm(res.action, res.fields);
        return;
      }
      if (method === 'DSC') {
        await signWithDsc(submitted);
        return;
      }
      await api(`/signing/${token}/complete`, { method: 'POST', json: { consent: true, values: submitted } });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  /**
   * DSC tokens are reached through a signing utility on the signer's computer.
   * Protocol: POST {documents:[{documentId,digest}]} to the utility, which
   * returns {signatures:[{documentId,cms}]} (CAdES detached over each digest).
   */
  async function signWithDsc(submitted: Record<string, string>) {
    const prep = await api<{ txn: string; documents: { documentId: string; digest: string }[] }>(`/signing/${token}/dsc/prepare`, {
      method: 'POST',
      json: { consent: true, values: submitted },
    });
    setError(tr('dscSigning'));
    let signatures: { documentId: string; cms: string }[];
    try {
      const res = await fetch(`${DSC_UTILITY_URL}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documents: prep.documents, signer: session.recipient.name }),
      });
      if (!res.ok) throw new Error(`utility responded ${res.status}`);
      signatures = (await res.json()).signatures;
    } catch {
      throw new Error(tr('dscNoUtility'));
    }
    setError(null);
    await api(`/signing/${token}/dsc/complete`, { method: 'POST', json: { txn: prep.txn, signatures } });
    onDone();
  }

  async function reassign() {
    setSubmitting(true);
    setError(null);
    try {
      await api(`/signing/${token}/reassign`, { method: 'POST', json: reassignTo });
      setReassignOpen(false);
      onReassigned(reassignTo.name);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  async function decline() {
    setSubmitting(true);
    try {
      await api(`/signing/${token}/decline`, { method: 'POST', json: { reason: declineReason.trim() } });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  const initials = session.recipient.name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .toUpperCase();

  return (
    <>
      <div className="sticky top-14 z-20 -mx-4 mb-6 flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="min-w-0 flex-1 text-sm">
          {remaining.length > 0 ? <span>{tr('fieldsLeft', { n: remaining.length })}</span> : <span className="font-medium text-green-700">{tr('allDone')}</span>}
        </div>
        {session.recipient.canReassign && (
          <Button variant="ghost" size="sm" onClick={() => setReassignOpen(true)}>
            {tr('reassign')}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => setDeclineOpen(true)}>
          {tr('decline')}
        </Button>
        {remaining.length > 0 ? (
          <Button size="sm" onClick={next}>
            {tr('nextField')} ↓
          </Button>
        ) : (
          <Button size="sm" onClick={finish} loading={submitting}>
            {approving ? tr('approve') : method === 'AADHAAR_ESIGN' ? tr('signAadhaar') : method === 'DSC' ? tr('signDsc') : tr('finish')}
          </Button>
        )}
      </div>

      {session.aiAvailable && (
        <div className="mb-4">
          <SignerSummary token={token} locale={session.recipient.locale} label={tr('summarize')} />
        </div>
      )}
      {approving && <p className="mb-4 text-sm text-gray-600">{tr('approveIntro')}</p>}
      {method === 'AADHAAR_ESIGN' && (
        <div className="mb-4">
          <Alert tone={session.recipient.esignSandbox ? 'warning' : 'info'}>
            {tr('aadhaarIntro')} {session.recipient.esignSandbox && <strong>{tr('aadhaarSandbox')}</strong>}
          </Alert>
        </div>
      )}
      {method === 'DSC' && (
        <div className="mb-4">
          <Alert tone="info">{tr('dscIntro')}</Alert>
        </div>
      )}
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}

      {/* Documents keep their own left-to-right geometry regardless of UI language */}
      <div className="space-y-10" dir="ltr">
        {session.documents.map((doc) => (
          <section key={doc.id}>
            <h2 className="mb-3 text-sm font-semibold text-gray-700">{doc.name}</h2>
            <PdfPages
              url={fileUrl(`/signing/${token}/documents/${doc.id}/file`)}
              pages={doc.pages}
              overlay={(page) =>
                shown
                  .filter((f) => f.documentId === doc.id && f.page === page)
                  .map((f) => {
                    const done = isDone(f);
                    const style = { left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.width * 100}%`, height: `${f.height * 100}%` };
                    const boxClass = cx(
                      'absolute rounded border-2 text-[clamp(8px,1.4vw,13px)] outline-none',
                      done ? 'border-green-500/60 bg-white/85' : 'border-amber-400 bg-amber-50/90 focus-within:border-brand-500',
                    );
                    if (f.type === 'DROPDOWN') {
                      return (
                        <select
                          key={f.id}
                          id={`field-${f.id}`}
                          style={style}
                          title={f.label ?? undefined}
                          value={values[f.id] ?? ''}
                          onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                          className={cx(boxClass, 'px-0.5')}
                        >
                          <option value="">{f.label ?? tr('chooseOne')}</option>
                          {(f.options ?? []).map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      );
                    }
                    if (f.type === 'RADIO') {
                      return (
                        <div key={f.id} id={`field-${f.id}`} style={style} role="radiogroup" aria-label={f.label ?? undefined} className={cx(boxClass, 'flex items-stretch gap-0.5 overflow-hidden p-0.5')}>
                          {(f.options ?? []).map((o) => (
                            <button
                              key={o}
                              type="button"
                              role="radio"
                              aria-checked={values[f.id] === o}
                              onClick={() => setValues((v) => ({ ...v, [f.id]: o }))}
                              className={cx('min-w-0 flex-1 truncate rounded px-1', values[f.id] === o ? 'bg-brand-600 text-white' : 'bg-white/70 text-gray-700 hover:bg-white')}
                            >
                              {o}
                            </button>
                          ))}
                        </div>
                      );
                    }
                    if (f.type === 'NUMBER') {
                      return (
                        <input
                          key={f.id}
                          id={`field-${f.id}`}
                          style={style}
                          inputMode="decimal"
                          placeholder={f.label ?? FIELD_LABELS.NUMBER}
                          value={values[f.id] ?? ''}
                          onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value.replace(/[^0-9.,-]/g, '') }))}
                          className={cx(boxClass, 'px-1 text-right')}
                        />
                      );
                    }
                    if (f.type === 'FORMULA') {
                      return (
                        <div key={f.id} id={`field-${f.id}`} style={style} title={f.formula ?? undefined} className="absolute flex items-center justify-end truncate rounded bg-brand-50/70 px-1 text-[clamp(8px,1.4vw,13px)] font-semibold text-[#111c59]">
                          {formulaValue(f) ?? '—'}
                        </div>
                      );
                    }
                    if (f.type === 'ATTACHMENT') {
                      return (
                        <label key={f.id} id={`field-${f.id}`} style={style} className={cx(boxClass, 'flex cursor-pointer items-center justify-center truncate px-1 font-medium')}>
                          <input type="file" accept="application/pdf,image/png,image/jpeg" className="hidden" onChange={(e) => e.target.files?.[0] && uploadAttachment(f, e.target.files[0])} />
                          {uploading === f.id ? tr('uploading') : (fileNames[f.id] ?? (values[f.id] ? '✓' : `📎 ${f.label ?? tr('uploadFile')}`))}
                        </label>
                      );
                    }
                    if (f.type === 'TEXT') {
                      return (
                        <input
                          key={f.id}
                          id={`field-${f.id}`}
                          style={style}
                          placeholder={f.label ?? FIELD_LABELS.TEXT}
                          value={values[f.id] ?? ''}
                          maxLength={500}
                          onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                          className={cx(
                            'absolute rounded border-2 px-1 text-[clamp(8px,1.4vw,13px)] outline-none',
                            done ? 'border-green-500/60 bg-white/80' : 'border-amber-400 bg-amber-50/90 focus:border-brand-500',
                          )}
                        />
                      );
                    }
                    if (f.type in autoFilled) {
                      return (
                        <div key={f.id} id={`field-${f.id}`} style={style} className="absolute flex items-center truncate rounded bg-brand-50/60 px-1 text-[clamp(8px,1.4vw,13px)] text-[#111c59]">
                          {autoFilled[f.type]}
                        </div>
                      );
                    }
                    if (crypto && (f.type === 'SIGNATURE' || f.type === 'INITIALS')) {
                      return (
                        <div key={f.id} id={`field-${f.id}`} style={style} className="absolute flex items-center justify-center rounded border-2 border-dashed border-brand-500 bg-brand-50/80 px-1 text-center text-[clamp(7px,1.2vw,11px)] font-medium text-brand-700">
                          {method === 'AADHAAR_ESIGN' ? 'Aadhaar eSign' : 'DSC'}
                        </div>
                      );
                    }
                    const img = values[f.id];
                    return (
                      <button
                        key={f.id}
                        id={`field-${f.id}`}
                        type="button"
                        style={style}
                        onClick={() => activate(f)}
                        className={cx(
                          'absolute flex items-center justify-center overflow-hidden rounded border-2 text-[clamp(8px,1.3vw,12px)] font-semibold',
                          done ? 'border-transparent bg-transparent hover:border-green-500/50' : 'animate-pulse border-amber-400 bg-amber-100/90 text-amber-900 hover:animate-none',
                        )}
                        title={done && f.type !== 'CHECKBOX' ? tr('clickToChange') : f.label ?? undefined}
                      >
                        {f.type === 'CHECKBOX' ? (
                          values[f.id] === 'true' ? '✕' : ''
                        ) : img ? (
                          <img src={img} alt={FIELD_LABELS[f.type]} className="h-full w-full object-contain object-left" />
                        ) : (
                          <span>
                            {f.type === 'SIGNATURE' ? tr('sign') : tr('initial')}
                            {!f.required && ` ${tr('optional')}`}
                          </span>
                        )}
                      </button>
                    );
                  })
              }
            />
          </section>
        ))}
      </div>

      <div className="mt-10 flex justify-center">
        <Button onClick={finish} loading={submitting} disabled={remaining.length > 0}>
          {approving ? tr('approve') : method === 'AADHAAR_ESIGN' ? tr('signAadhaar') : method === 'DSC' ? tr('signDsc') : tr('finish')}
        </Button>
      </div>

      <Modal open={!!padFor} onClose={() => setPadFor(null)} title={padFor?.type === 'INITIALS' ? tr('adoptInitials') : tr('adoptSignature')}>
        {padFor && (
          <SignaturePad
            tr={tr}
            kind={padFor.type === 'INITIALS' ? 'initials' : 'signature'}
            defaultText={padFor.type === 'INITIALS' ? initials : session.recipient.name}
            onCancel={() => setPadFor(null)}
            onAdopt={(png) => {
              const kind = padFor.type === 'INITIALS' ? 'initials' : 'signature';
              setAdopted((a) => ({ ...a, [kind]: png }));
              // Apply the adopted mark to this field and any other empty required fields of the same kind
              setValues((v) => {
                const nextValues = { ...v, [padFor.id]: png };
                for (const f of session.fields) if (f.type === padFor.type && !nextValues[f.id] && f.required) nextValues[f.id] = png;
                return nextValues;
              });
              setPadFor(null);
            }}
          />
        )}
      </Modal>

      <Modal open={reassignOpen} onClose={() => setReassignOpen(false)} title={tr('reassign')}>
        <p className="text-sm text-gray-600">{tr('reassignBody')}</p>
        <div className="mt-4 space-y-3">
          <Input placeholder={tr('newName')} value={reassignTo.name} onChange={(e) => setReassignTo((r) => ({ ...r, name: e.target.value }))} />
          <Input type="email" placeholder={tr('newEmail')} value={reassignTo.email} onChange={(e) => setReassignTo((r) => ({ ...r, email: e.target.value }))} />
          <Textarea rows={2} placeholder={tr('reassignReason')} value={reassignTo.reason} onChange={(e) => setReassignTo((r) => ({ ...r, reason: e.target.value }))} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setReassignOpen(false)}>
            {tr('cancel')}
          </Button>
          <Button loading={submitting} disabled={!reassignTo.name.trim() || !reassignTo.email.trim() || !reassignTo.reason.trim()} onClick={reassign}>
            {tr('reassign')}
          </Button>
        </div>
      </Modal>

      <Modal open={declineOpen} onClose={() => setDeclineOpen(false)} title={tr('declineTitle')}>
        <p className="text-sm text-gray-600">{tr('declineBody')}</p>
        <Textarea className="mt-4" rows={3} placeholder={tr('declineReason')} value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeclineOpen(false)}>
            {tr('cancel')}
          </Button>
          <Button variant="danger" disabled={!declineReason.trim()} loading={submitting} onClick={decline}>
            {tr('decline')}
          </Button>
        </div>
      </Modal>
    </>
  );
}

/** Local DSC signing utility (see docs/dsc-utility.md). */
const DSC_UTILITY_URL = process.env.NEXT_PUBLIC_DSC_UTILITY_URL ?? 'http://127.0.0.1:3434';

/** Submits a form the classic way (eSign requests must reach the ESP as a browser POST). */
function postForm(action: string, fields: Record<string, string>) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = action;
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

/** Tells an embedding app what happened. Messages carry no secrets. */
function notifyParent(type: string, session: SigningSession | null) {
  if (typeof window === 'undefined' || window.parent === window || !session) return;
  window.parent.postMessage({ type: `docsign:${type}`, envelopeId: session.envelope.id, recipientId: session.recipient.id }, '*');
}

export default function SignPage() {
  const { token } = useParams<{ token: string }>();
  const [session, setSession] = useState<SigningSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consented, setConsented] = useState(false);
  const [locale, setLocale] = useState<string | null>(null);
  const [reassignedTo, setReassignedTo] = useState<string | null>(null);
  const [esignError, setEsignError] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('esign') === 'failed') setEsignError(q.get('reason') ?? 'unknown error');
  }, []);

  const load = useCallback(() => {
    api<SigningSession>(`/signing/${token}`)
      .then((s) => {
        setSession(s);
        setLocale((l) => l ?? s.recipient.locale ?? 'en');
        if (s.recipient.embedded) {
          notifyParent(s.state === 'ready' ? 'ready' : s.state, s);
          // Outside an iframe, embedded signers go back to the integrating app when done
          const finished = s.state === 'signed' || s.state === 'completed' || s.state === 'declined';
          if (finished && s.recipient.returnUrl && window.parent === window) {
            const back = new URL(s.recipient.returnUrl);
            back.searchParams.set('event', s.state);
            window.location.assign(back.toString());
          }
        }
      })
      .catch((err) => setError(err.message));
  }, [token]);
  useEffect(load, [load]);

  const lang = locale ?? 'en';
  const tr: Translate = useCallback((key, vars) => signerT(lang, key, vars), [lang]);
  const shell = { locale: lang, onLocale: setLocale, tr, branding: session?.branding };

  if (reassignedTo) {
    return (
      <Shell {...shell}>
        <Card className="mx-auto max-w-md p-8 text-center">
          <p className="text-sm text-gray-600">{tr('reassignDone', { name: reassignedTo })}</p>
        </Card>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell {...shell}>
        <Card className="mx-auto max-w-md p-7 text-center">
          <h1 className="text-lg font-semibold">{tr('invalidLink')}</h1>
          <p className="mt-2 text-sm text-gray-500">{error}</p>
        </Card>
      </Shell>
    );
  }
  if (!session) {
    return (
      <Shell {...shell}>
        <PageLoader />
      </Shell>
    );
  }

  if (session.state !== 'ready') {
    const [titleKey, bodyKey] = STATE_KEYS[session.state];
    const good = session.state === 'signed' || session.state === 'completed';
    return (
      <Shell {...shell} title={session.envelope.title}>
        <Card className="mx-auto max-w-md p-8 text-center">
          <div className={cx('mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full text-xl', good ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
            {good ? '✓' : 'i'}
          </div>
          <h1 className="text-lg font-semibold">{tr(titleKey)}</h1>
          <p className="mt-2 text-sm text-gray-500">{tr(bodyKey)}</p>
          <p className="mt-6 text-xs text-gray-400">{session.envelope.title}</p>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell {...shell} title={session.envelope.title}>
      {esignError && (
        <div className="mx-auto mb-4 max-w-3xl">
          <Alert>{tr('esignFailed', { reason: esignError })}</Alert>
        </div>
      )}
      {!session.verified ? (
        <Verify session={session} token={token} onVerified={load} tr={tr} />
      ) : !consented ? (
        <Consent session={session} onAccept={() => setConsented(true)} tr={tr} />
      ) : (
        <SignDocument session={session} token={token} onDone={load} onReassigned={setReassignedTo} tr={tr} />
      )}
    </Shell>
  );
}
