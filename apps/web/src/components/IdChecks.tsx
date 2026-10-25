'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, cx, Input, Label } from '@/components/ui';
import { api } from '@/lib/api';

export interface IdCheckState {
  kind: 'PAN' | 'BANK' | 'DIGILOCKER' | 'VIDEO';
  status: 'NOT_STARTED' | 'PASSED' | 'FAILED' | 'PENDING';
  nameMatch?: number | null;
  data?: Record<string, unknown> | null;
}

const TITLES: Record<IdCheckState['kind'], [string, string]> = {
  PAN: ['PAN', 'Confirm your Permanent Account Number. The name on it must match yours.'],
  BANK: ['Bank account', 'We verify the account with your bank. The account holder name must match yours.'],
  DIGILOCKER: ['Aadhaar via DigiLocker', 'Share your Aadhaar details from DigiLocker. Only your name, year of birth and the last 4 digits are kept.'],
  VIDEO: ['Video selfie', 'Record a short video reading out a code, so the sender knows it is you.'],
};

/** Identity checks the sender asked for, completed before the document opens. */
export function IdChecks({ token, recipientName, checks, onChange }: { token: string; recipientName: string; checks: IdCheckState[]; onChange: () => void }) {
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('kyc');
    const texts: Record<string, ['success' | 'warning' | 'error', string]> = {
      passed: ['success', 'DigiLocker check complete.'],
      mismatch: ['error', 'The name in DigiLocker does not match the name on this request. Contact the sender if this is a mistake.'],
      cancelled: ['warning', 'DigiLocker sharing was cancelled.'],
      failed: ['error', 'DigiLocker did not return your details. Try again.'],
    };
    if (q && texts[q]) setNotice({ tone: texts[q][0], text: texts[q][1] });
  }, []);
  const done = checks.filter((c) => c.status === 'PASSED').length;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card className="p-6">
        <h1 className="text-lg font-semibold">Verify your identity</h1>
        <p className="mt-1 text-sm text-gray-600">
          The sender asked {recipientName} to complete {checks.length} check{checks.length === 1 ? '' : 's'} before signing. {done} of {checks.length} done.
        </p>
      </Card>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {checks.map((c) => (
        <Card key={c.kind} className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">{TITLES[c.kind][0]}</h2>
              <p className="mt-0.5 text-sm text-gray-500">{TITLES[c.kind][1]}</p>
            </div>
            <span
              className={cx(
                'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                c.status === 'PASSED' ? 'bg-green-50 text-green-700' : c.status === 'FAILED' ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-600',
              )}
            >
              {c.status === 'PASSED' ? '✓ Verified' : c.status === 'FAILED' ? 'Not verified' : 'To do'}
            </span>
          </div>
          {c.status !== 'PASSED' && (
            <div className="mt-4">
              {c.kind === 'PAN' && <PanForm token={token} defaultName={recipientName} onDone={onChange} />}
              {c.kind === 'BANK' && <BankForm token={token} onDone={onChange} />}
              {c.kind === 'DIGILOCKER' && <DigiLockerButton token={token} />}
              {c.kind === 'VIDEO' && <VideoSelfie token={token} onDone={onChange} />}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function useSubmit(onDone: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<{ status: string; reason?: string | null }>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (res.status !== 'PASSED') setError(res.reason ?? 'That could not be verified.');
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { error, busy, run };
}

function PanForm({ token, defaultName, onDone }: { token: string; defaultName: string; onDone: () => void }) {
  const [pan, setPan] = useState('');
  const [name, setName] = useState(defaultName);
  const { error, busy, run } = useSubmit(onDone);
  return (
    <form
      className="grid gap-3 sm:grid-cols-[160px_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => api(`/signing/${token}/kyc/pan`, { method: 'POST', json: { pan, name } }));
      }}
    >
      <div>
        <Label htmlFor="pan">PAN</Label>
        <Input id="pan" className="font-mono uppercase" maxLength={10} placeholder="ABCDE1234F" autoComplete="off" value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} required />
      </div>
      <div>
        <Label htmlFor="pan-name">Name as on PAN</Label>
        <Input id="pan-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <Button type="submit" loading={busy}>
        Verify
      </Button>
      {error && <p className="text-sm text-red-600 sm:col-span-3">{error}</p>}
    </form>
  );
}

function BankForm({ token, onDone }: { token: string; onDone: () => void }) {
  const [accountNumber, setAccount] = useState('');
  const [ifsc, setIfsc] = useState('');
  const { error, busy, run } = useSubmit(onDone);
  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => api(`/signing/${token}/kyc/bank`, { method: 'POST', json: { accountNumber, ifsc } }));
      }}
    >
      <div>
        <Label htmlFor="acc">Account number</Label>
        <Input id="acc" inputMode="numeric" autoComplete="off" value={accountNumber} onChange={(e) => setAccount(e.target.value.replace(/\D/g, ''))} required />
      </div>
      <div>
        <Label htmlFor="ifsc">IFSC</Label>
        <Input id="ifsc" className="font-mono uppercase" maxLength={11} placeholder="HDFC0001234" value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} required />
      </div>
      <Button type="submit" loading={busy}>
        Verify
      </Button>
      {error && <p className="text-sm text-red-600 sm:col-span-3">{error}</p>}
    </form>
  );
}

function DigiLockerButton({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <Button
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const { url } = await api<{ url: string }>(`/signing/${token}/kyc/digilocker/start`, { method: 'POST' });
            window.location.assign(url);
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        Continue to DigiLocker
      </Button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

const RECORD_SECONDS = 8;

function VideoSelfie({ token, onDone }: { token: string; onDone: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<'idle' | 'preview' | 'recording' | 'uploading'>('idle');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [left, setLeft] = useState(RECORD_SECONDS);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  async function openCamera() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: true });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setPhase('preview');
    } catch {
      setError('Allow camera and microphone access to record the video.');
    }
  }

  async function record() {
    setError(null);
    const { challenge: code } = await api<{ challenge: string }>(`/signing/${token}/kyc/video/challenge`, { method: 'POST' });
    setChallenge(code);
    const stream = streamRef.current!;
    const type = ['video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    const recorder = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 600_000 } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      setPhase('uploading');
      const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
      const form = new FormData();
      form.append('file', blob, blob.type.includes('mp4') ? 'selfie.mp4' : 'selfie.webm');
      try {
        await api(`/signing/${token}/kyc/video`, { method: 'POST', body: form });
        stream.getTracks().forEach((t) => t.stop());
        onDone();
      } catch (err) {
        setError((err as Error).message);
        setPhase('preview');
      }
    };
    setPhase('recording');
    setLeft(RECORD_SECONDS);
    recorder.start();
    const timer = setInterval(() => setLeft((s) => s - 1), 1000);
    setTimeout(() => {
      clearInterval(timer);
      recorder.stop();
    }, RECORD_SECONDS * 1000);
  }

  return (
    <div className="space-y-3">
      <div className={cx('relative overflow-hidden rounded-xl bg-gray-900', phase === 'idle' && 'hidden')}>
        <video ref={videoRef} autoPlay muted playsInline className="aspect-video w-full -scale-x-100 object-cover" />
        {phase === 'recording' && challenge && (
          <div className="absolute inset-x-0 bottom-0 bg-black/60 p-3 text-center text-white">
            <div className="text-xs uppercase tracking-wide text-gray-300">Read aloud · {left}s</div>
            <div className="font-mono text-3xl font-bold tracking-[0.3em]">{challenge}</div>
          </div>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {phase === 'idle' && <Button onClick={openCamera}>Open camera</Button>}
      {phase === 'preview' && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => record().catch((err) => setError((err as Error).message))}>Start {RECORD_SECONDS}-second recording</Button>
          <span className="text-sm text-gray-500">Look at the camera and read out the numbers that appear.</span>
        </div>
      )}
      {phase === 'uploading' && <p className="text-sm text-gray-600">Uploading…</p>}
    </div>
  );
}
