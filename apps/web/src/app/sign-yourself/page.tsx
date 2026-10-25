'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { FieldEditor } from '@/components/FieldEditor';
import { Alert, Button, Card, cx, Input, Label, Logo, PageLoader } from '@/components/ui';
import { api, ApiError, upload } from '@/lib/api';
import type { Envelope, Field } from '@/lib/types';

/**
 * "Sign it yourself": upload a document someone sent you (a joining letter,
 * say), put your signature on it, sign, then download it or send it back.
 * People without an account verify their email with a code first.
 */
export default function SignYourselfPage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const check = useCallback(() => {
    api('/auth/me')
      .then(() => setSignedIn(true))
      .catch(() => setSignedIn(false));
  }, []);
  useEffect(check, [check]);

  if (signedIn === null) return <PageLoader />;
  if (!signedIn) return <GuestStart onSignedIn={check} />;
  return (
    <AppShell wide>
      <SelfSignFlow />
    </AppShell>
  );
}

// --- Without an account -------------------------------------------------------

function GuestStart({ onSignedIn }: { onSignedIn: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/self-sign/guest/code', { method: 'POST', json: { name, email } });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the code.');
    } finally {
      setBusy(false);
    }
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/self-sign/guest/verify', { method: 'POST', json: { name, email, code } });
      onSignedIn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not verify the code.');
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-night bg-dots">
      <header className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link href="/">
          <Logo className="text-white" />
        </Link>
        <Link href="/login?next=/sign-yourself" className="text-sm font-medium text-gray-300 hover:text-white">
          Log in
        </Link>
      </header>
      <main className="mx-auto grid max-w-5xl items-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-2 lg:py-20">
        <div className="text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-300">Free · no account needed</p>
          <h1 className="mt-4 text-4xl font-black leading-tight tracking-tight sm:text-5xl">
            Sign a document <span className="text-gold">yourself.</span>
          </h1>
          <p className="mt-5 text-lg text-gray-300">Got a joining letter, rental agreement or form to sign? Upload it, add your signature, then download the signed PDF or send it straight back.</p>
          <ol className="mt-8 space-y-3 text-gray-200">
            {['Confirm your email with a code', 'Upload the PDF or Word file', 'Click where to sign and sign', 'Download it or send it back'].map((s, i) => (
              <li key={s} className="flex items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold text-sm font-bold text-ink">{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
        </div>
        <Card className="p-6 sm:p-8">
          {error && (
            <div className="mb-4">
              <Alert>{error}</Alert>
            </div>
          )}
          {!sent ? (
            <form onSubmit={sendCode} className="space-y-4">
              <h2 className="text-lg font-bold text-ink">Start signing</h2>
              <div>
                <Label htmlFor="g-name">Your full name</Label>
                <Input id="g-name" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </div>
              <div>
                <Label htmlFor="g-email">Your email</Label>
                <Input id="g-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </div>
              <Button type="submit" loading={busy} className="w-full">
                Email me a code
              </Button>
              <p className="text-xs text-gray-500">
                We create a free personal account so you can find your signed documents later. By continuing you agree to the{' '}
                <Link href="/legal/terms" className="underline">
                  Terms
                </Link>{' '}
                and{' '}
                <Link href="/legal/privacy" className="underline">
                  Privacy Policy
                </Link>
                .
              </p>
            </form>
          ) : (
            <form onSubmit={verify} className="space-y-4">
              <h2 className="text-lg font-bold text-ink">Check your email</h2>
              <p className="text-sm text-gray-600">We sent a 6-digit code to {email}.</p>
              <div>
                <Label htmlFor="g-code">Code</Label>
                <Input id="g-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              </div>
              <Button type="submit" loading={busy} disabled={code.length !== 6} className="w-full">
                Continue
              </Button>
              <button type="button" onClick={() => (setSent(false), setCode(''))} className="w-full text-sm text-gray-500 hover:text-ink">
                Use a different email
              </button>
            </form>
          )}
        </Card>
      </main>
    </div>
  );
}

// --- Signed in ----------------------------------------------------------------

function SelfSignFlow() {
  const [env, setEnv] = useState<Envelope | null>(null);
  const [fields, setFields] = useState<Field[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    setBusy(true);
    setError(null);
    try {
      let current = env;
      if (!current) current = await api<Envelope>('/self-sign', { method: 'POST', json: { title: list[0].name.replace(/\.[^.]+$/, '') } });
      for (const f of list) await upload(`/envelopes/${current.id}/documents`, f);
      const fresh = await api<Envelope>(`/envelopes/${current.id}`);
      setEnv(fresh);
      setFields(fresh.fields);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not upload the file.');
    } finally {
      setBusy(false);
    }
  }

  async function signNow() {
    if (!env) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/envelopes/${env.id}/fields`, {
        method: 'PUT',
        json: fields.map(({ documentId, recipientId, type, page, x, y, width, height, required, label, options, formula, condition, amount, currency, config }) => ({
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
          config,
        })),
      });
      const { signPath } = await api<{ signPath: string }>(`/self-sign/${env.id}/start`, { method: 'POST' });
      window.location.href = signPath;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start signing.');
      setBusy(false);
    }
  }

  const hasSignature = fields.some((f) => f.type === 'SIGNATURE');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Sign a document yourself</h1>
        <p className="text-sm text-gray-500">Free. Upload a document someone sent you, sign it, then download it or send it back.</p>
      </div>
      <ol className="flex flex-wrap gap-2 text-sm">
        {['Upload', 'Place your signature', 'Sign', 'Download or send back'].map((s, i) => {
          const step = !env ? 0 : 1;
          return (
            <li key={s} className={cx('flex items-center gap-2 rounded-full px-3 py-1.5', i === step ? 'bg-gold font-semibold text-ink' : i < step ? 'bg-brand-50 text-brand-700' : 'bg-gray-100 text-gray-500')}>
              <span>{i + 1}</span>
              {s}
            </li>
          );
        })}
      </ol>
      {error && <Alert>{error}</Alert>}

      {!env ? (
        <label
          onDragOver={(e) => (e.preventDefault(), setDragging(true))}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
          className={cx('flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-white px-6 py-20 text-center transition', dragging ? 'border-brand-500 bg-brand-50' : 'border-gray-300 hover:border-brand-300')}
        >
          <span className="text-4xl" aria-hidden>
            📄
          </span>
          <span className="mt-3 text-lg font-semibold text-ink">{busy ? 'Uploading…' : 'Drop your document here, or click to choose'}</span>
          <span className="mt-1 text-sm text-gray-500">PDF, Word, Excel or PowerPoint, up to 25 MB</span>
          <input type="file" className="sr-only" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.rtf,.txt" disabled={busy} onChange={(e) => e.target.files && addFiles(e.target.files)} />
        </label>
      ) : (
        <>
          <Alert tone="info">
            Choose <strong>Signature</strong> (and anything else you need, like <strong>Date signed</strong> or <strong>Name</strong>), then click on the page where it goes. You sign on the next screen.
          </Alert>
          <FieldEditor envelopeId={env.id} documents={env.documents} recipients={env.recipients} fields={fields} onChange={setFields} />
          <div className="sticky bottom-0 z-20 -mx-4 flex items-center justify-between gap-3 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
            <label className="cursor-pointer text-sm font-medium text-brand-700 hover:underline">
              + Add another document
              <input type="file" className="sr-only" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.rtf,.txt" onChange={(e) => e.target.files && addFiles(e.target.files)} />
            </label>
            <div className="flex items-center gap-3">
              {!hasSignature && <span className="hidden text-sm text-gray-500 sm:inline">Place a signature field to continue</span>}
              <Button loading={busy} disabled={!hasSignature} onClick={signNow}>
                Sign now →
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
