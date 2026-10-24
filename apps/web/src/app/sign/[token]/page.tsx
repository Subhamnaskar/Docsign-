'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PdfPages } from '@/components/PdfPages';
import { SignaturePad } from '@/components/SignaturePad';
import { Alert, Button, Card, cx, Input, Logo, Modal, PageLoader, Textarea } from '@/components/ui';
import { api, fileUrl } from '@/lib/api';
import { FIELD_LABELS } from '@/lib/format';
import type { Field, PageInfo } from '@/lib/types';

interface SigningSession {
  state: 'ready' | 'waiting' | 'signed' | 'completed' | 'declined' | 'voided' | 'expired' | 'unavailable';
  verified: boolean;
  envelope: { id: string; title: string; message: string | null; sender: { name: string; email: string }; organization: string; expiresAt: string | null };
  recipient: { id: string; name: string; email: string; maskedEmail: string; status: string };
  compliance: { jurisdiction: string; laws: string[]; signatureLevel: string; consentText: string };
  documents: { id: string; name: string; pageCount: number; pages: PageInfo[] }[];
  fields: Field[];
}

const STATE_MESSAGES: Record<string, { title: string; body: string }> = {
  waiting: { title: 'Not your turn yet', body: 'Other people need to sign first. We will email you when it is your turn.' },
  signed: { title: 'You have signed this document', body: 'We will email you a copy of the completed document once everyone has signed.' },
  completed: { title: 'This document is complete', body: 'Everyone has signed. Check your email for the completed copy.' },
  declined: { title: 'This request was declined', body: 'Signing is closed because a recipient declined.' },
  voided: { title: 'This request was cancelled', body: 'The sender voided this document. No action is needed.' },
  expired: { title: 'This request has expired', body: 'Contact the sender if you still need to sign.' },
  unavailable: { title: 'This request is not available', body: 'The link may be out of date.' },
};

function Shell({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
          <Logo className="text-gray-900" />
          {title && <span className="truncate text-sm text-gray-500">{title}</span>}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}

function Verify({ session, token, onVerified }: { session: SigningSession; token: string; onVerified: () => void }) {
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

  return (
    <Card className="mx-auto max-w-md p-7">
      <p className="text-sm text-gray-500">
        {session.envelope.sender.name} ({session.envelope.organization}) sent you
      </p>
      <h1 className="mt-1 text-xl font-semibold">{session.envelope.title}</h1>
      {session.envelope.message && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{session.envelope.message}</p>}
      <div className="mt-6 border-t border-gray-100 pt-6">
        <h2 className="font-medium">Verify it&apos;s you</h2>
        {error && (
          <div className="mt-3">
            <Alert>{error}</Alert>
          </div>
        )}
        {!sent ? (
          <>
            <p className="mt-1 text-sm text-gray-500">We&apos;ll email a 6-digit code to {session.recipient.maskedEmail}.</p>
            <Button className="mt-4 w-full" onClick={send} loading={loading}>
              Email me a code
            </Button>
          </>
        ) : (
          <form onSubmit={verify}>
            <p className="mt-1 text-sm text-gray-500">Enter the code we sent to {session.recipient.maskedEmail}. It expires in 10 minutes.</p>
            <Input
              className="mt-4 text-center font-mono text-2xl tracking-[0.5em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              aria-label="Verification code"
            />
            <Button type="submit" className="mt-4 w-full" loading={loading} disabled={code.length !== 6}>
              Verify and continue
            </Button>
            <button type="button" onClick={send} className="mt-3 w-full text-sm text-gray-500 hover:text-gray-800">
              Send a new code
            </button>
          </form>
        )}
      </div>
    </Card>
  );
}

function Consent({ session, onAccept }: { session: SigningSession; onAccept: () => void }) {
  const [checked, setChecked] = useState(false);
  return (
    <Card className="mx-auto max-w-lg p-7">
      <h1 className="text-xl font-semibold">Electronic signature disclosure</h1>
      <p className="mt-1 text-sm text-gray-500">
        Governing law: {session.compliance.jurisdiction} ({session.compliance.laws.join('; ')})
      </p>
      <p className="mt-4 rounded-lg bg-gray-50 p-4 text-sm leading-relaxed text-gray-700">{session.compliance.consentText}</p>
      <label className="mt-5 flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        <span>I agree to use electronic records and signatures.</span>
      </label>
      <Button className="mt-5 w-full" disabled={!checked} onClick={onAccept}>
        Continue
      </Button>
    </Card>
  );
}

function SignDocument({ session, token, onDone }: { session: SigningSession; token: string; onDone: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(session.fields.filter((f) => f.value).map((f) => [f.id, f.value!])),
  );
  const [adopted, setAdopted] = useState<{ signature?: string; initials?: string }>({});
  const [padFor, setPadFor] = useState<Field | null>(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const autoFilled: Record<string, string> = {
    NAME: session.recipient.name,
    EMAIL: session.recipient.email,
    DATE_SIGNED: new Date().toISOString().slice(0, 10),
  };
  const isDone = useCallback(
    (f: Field) => f.type in autoFilled || (f.type === 'CHECKBOX' ? values[f.id] === 'true' : Boolean(values[f.id]?.trim())),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [values],
  );
  const required = session.fields.filter((f) => f.required);
  const remaining = required.filter((f) => !isDone(f));
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
    const target = ordered.find((f) => f.required && !isDone(f)) ?? ordered.find((f) => !isDone(f));
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
      await api(`/signing/${token}/complete`, { method: 'POST', json: { consent: true, values } });
      onDone();
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
          {remaining.length > 0 ? (
            <span>
              <strong>{remaining.length}</strong> required field{remaining.length === 1 ? '' : 's'} left
            </span>
          ) : (
            <span className="font-medium text-green-700">All required fields complete</span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setDeclineOpen(true)}>
          Decline
        </Button>
        {remaining.length > 0 ? (
          <Button size="sm" onClick={next}>
            Next field ↓
          </Button>
        ) : (
          <Button size="sm" onClick={finish} loading={submitting}>
            Finish signing
          </Button>
        )}
      </div>

      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <div className="space-y-10">
        {session.documents.map((doc) => (
          <section key={doc.id}>
            <h2 className="mb-3 text-sm font-semibold text-gray-700">{doc.name}</h2>
            <PdfPages
              url={fileUrl(`/signing/${token}/documents/${doc.id}/file`)}
              pages={doc.pages}
              overlay={(page) =>
                session.fields
                  .filter((f) => f.documentId === doc.id && f.page === page)
                  .map((f) => {
                    const done = isDone(f);
                    const style = { left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.width * 100}%`, height: `${f.height * 100}%` };
                    if (f.type === 'TEXT') {
                      return (
                        <input
                          key={f.id}
                          id={`field-${f.id}`}
                          style={style}
                          placeholder={f.label ?? 'Text'}
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
                        title={done && f.type !== 'CHECKBOX' ? 'Click to change' : undefined}
                      >
                        {f.type === 'CHECKBOX' ? (
                          values[f.id] === 'true' ? '✕' : ''
                        ) : img ? (
                          <img src={img} alt={FIELD_LABELS[f.type]} className="h-full w-full object-contain object-left" />
                        ) : (
                          <span>
                            {f.type === 'SIGNATURE' ? 'Sign' : 'Initial'}
                            {!f.required && ' (optional)'}
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
          Finish signing
        </Button>
      </div>

      <Modal open={!!padFor} onClose={() => setPadFor(null)} title={padFor?.type === 'INITIALS' ? 'Adopt your initials' : 'Adopt your signature'}>
        {padFor && (
          <SignaturePad
            kind={padFor.type === 'INITIALS' ? 'initials' : 'signature'}
            defaultText={padFor.type === 'INITIALS' ? initials : session.recipient.name}
            onCancel={() => setPadFor(null)}
            onAdopt={(png) => {
              const kind = padFor.type === 'INITIALS' ? 'initials' : 'signature';
              setAdopted((a) => ({ ...a, [kind]: png }));
              // Apply the adopted mark to this field and any other empty fields of the same kind
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

      <Modal open={declineOpen} onClose={() => setDeclineOpen(false)} title="Decline to sign?">
        <p className="text-sm text-gray-600">The sender will be notified and the document will be closed for everyone.</p>
        <Textarea className="mt-4" rows={3} placeholder="Reason for declining" value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeclineOpen(false)}>
            Cancel
          </Button>
          <Button variant="danger" disabled={!declineReason.trim()} loading={submitting} onClick={decline}>
            Decline
          </Button>
        </div>
      </Modal>
    </>
  );
}

export default function SignPage() {
  const { token } = useParams<{ token: string }>();
  const [session, setSession] = useState<SigningSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consented, setConsented] = useState(false);

  const load = useCallback(() => {
    api<SigningSession>(`/signing/${token}`)
      .then(setSession)
      .catch((err) => setError(err.message));
  }, [token]);
  useEffect(load, [load]);

  if (error) {
    return (
      <Shell>
        <Card className="mx-auto max-w-md p-7 text-center">
          <h1 className="text-lg font-semibold">This link isn&apos;t valid</h1>
          <p className="mt-2 text-sm text-gray-500">{error}</p>
        </Card>
      </Shell>
    );
  }
  if (!session) {
    return (
      <Shell>
        <PageLoader />
      </Shell>
    );
  }

  if (session.state !== 'ready') {
    const msg = STATE_MESSAGES[session.state];
    return (
      <Shell title={session.envelope.title}>
        <Card className="mx-auto max-w-md p-8 text-center">
          <div className={cx('mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full text-xl', session.state === 'signed' || session.state === 'completed' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
            {session.state === 'signed' || session.state === 'completed' ? '✓' : 'i'}
          </div>
          <h1 className="text-lg font-semibold">{msg.title}</h1>
          <p className="mt-2 text-sm text-gray-500">{msg.body}</p>
          <p className="mt-6 text-xs text-gray-400">{session.envelope.title}</p>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell title={session.envelope.title}>
      {!session.verified ? (
        <Verify session={session} token={token} onVerified={load} />
      ) : !consented ? (
        <Consent session={session} onAccept={() => setConsented(true)} />
      ) : (
        <SignDocument session={session} token={token} onDone={load} />
      )}
    </Shell>
  );
}
