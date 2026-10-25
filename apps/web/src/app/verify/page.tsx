'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { Alert, Card, cx, Logo, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface VerifyResult {
  sha256: string;
  size: number;
  match: {
    kind: 'document' | 'certificate';
    documentName: string;
    envelopeId: string;
    title: string;
    completedAt: string | null;
    jurisdiction: string;
    signers: { name: string; email: string; signedAt: string | null }[];
    auditTrail: { valid: boolean; events: number };
    superseded?: boolean;
  } | null;
  ltv?: { dss: boolean; documentTimestamps: number };
  signatures: {
    index: number;
    kind?: 'signature' | 'document-timestamp';
    subFilter: string | null;
    signerName: string | null;
    issuerName: string | null;
    integrityValid: boolean;
    coversWholeDocument: boolean;
    laterChanges?: 'none' | 'validation-data' | 'other';
    timestamp: { genTime: string; valid: boolean } | null;
    error?: string;
  }[];
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className={cx('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold', ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>{ok ? '✓' : '✕'}</span>
      <span>{children}</span>
    </li>
  );
}

export default function VerifyPage() {
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function check(file: File) {
    setLoading(true);
    setError(null);
    setResult(null);
    setFileName(file.name);
    const form = new FormData();
    form.append('file', file);
    try {
      setResult(await api<VerifyResult>('/verify', { method: 'POST', body: form }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const sigOk = result ? result.signatures.length > 0 && result.signatures.every((s) => s.integrityValid) : false;
  const untouched = result ? result.signatures.some((s) => s.coversWholeDocument) : false;
  const authentic = Boolean(result?.match && sigOk && untouched);

  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/">
            <Logo className="text-gray-900" />
          </Link>
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-900">
            Dashboard
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold">Verify a signed document</h1>
        <p className="mt-1 text-sm text-gray-500">
          Check that a PDF or certificate of completion is an unaltered DocSign original. The file is checked in memory and not stored.
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files[0];
            if (f) check(f);
          }}
          onClick={() => inputRef.current?.click()}
          className={cx(
            'mt-6 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed bg-white px-6 py-12 text-center',
            dragOver ? 'border-brand-500 bg-brand-50' : 'border-gray-300 hover:border-brand-500',
          )}
        >
          {loading ? <Spinner className="h-8 w-8 text-brand-600" /> : <p className="text-sm font-medium text-gray-700">Drop a signed PDF here or click to choose</p>}
          {fileName && !loading && <p className="mt-1 text-xs text-gray-400">{fileName}</p>}
          <input ref={inputRef} type="file" accept="application/pdf" hidden onChange={(e) => e.target.files?.[0] && check(e.target.files[0])} />
        </div>

        {error && (
          <div className="mt-6">
            <Alert>{error}</Alert>
          </div>
        )}

        {result && (
          <div className="mt-6 space-y-4">
            <Alert tone={authentic ? 'success' : result.match ? 'warning' : 'error'} title={authentic ? 'Authentic and unaltered' : result.match ? 'Known document, but the signature check failed' : 'Not recognised'}>
              {authentic
                ? `This is the original "${result.match!.documentName}" from envelope "${result.match!.title}".`
                : result.match
                  ? 'The file matches a DocSign record but its signature did not validate.'
                  : 'This exact file was not issued by DocSign. It may have been modified, or it may be an original unsigned copy.'}
            </Alert>

            <Card className="p-5">
              <h2 className="font-semibold">Checks</h2>
              <ul className="mt-3 space-y-2 text-sm">
                <Check ok={!!result.match}>Fingerprint matches a completed DocSign record</Check>
                <Check ok={sigOk}>Digital signature is cryptographically valid</Check>
                <Check ok={untouched}>No changes after signing (validation data may be added later)</Check>
                {result.signatures.map((s) => s.timestamp && (
                  <Check key={s.index} ok={s.timestamp.valid}>
                    {s.kind === 'document-timestamp' ? 'Archive timestamp' : 'Trusted timestamp'} {formatDate(s.timestamp.genTime)}
                  </Check>
                ))}
                {result.ltv?.dss && <Check ok>Long-term validation data embedded (certificates and revocation status)</Check>}
                {result.match && <Check ok={result.match.auditTrail.valid}>Audit trail intact ({result.match.auditTrail.events} events)</Check>}
              </ul>
              {result.match?.superseded && (
                <p className="mt-3 text-sm text-gray-600">
                  This is an earlier copy. The stored original has since received a fresh archive timestamp, which keeps its signatures verifiable long-term; the
                  content is the same.
                </p>
              )}
              <p className="mt-4 break-all font-mono text-[11px] text-gray-400">SHA-256 {result.sha256}</p>
            </Card>

            {result.match && (
              <Card className="p-5">
                <h2 className="font-semibold">Signers</h2>
                <ul className="mt-3 divide-y divide-gray-100 text-sm">
                  {result.match.signers.map((s) => (
                    <li key={s.email} className="flex justify-between gap-4 py-2">
                      <span>
                        <span className="font-medium">{s.name}</span> <span className="text-gray-500">{s.email}</span>
                      </span>
                      <span className="text-gray-500">{formatDate(s.signedAt)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-gray-400">
                  Envelope {result.match.envelopeId} · completed {formatDate(result.match.completedAt)} · {result.match.jurisdiction}
                </p>
              </Card>
            )}

            {result.signatures.length > 0 && (
              <Card className="p-5">
                <h2 className="font-semibold">Embedded signatures</h2>
                {result.signatures.map((s) => (
                  <dl key={s.index} className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                    <dt className="text-gray-400">Signed by</dt>
                    <dd>{s.signerName ?? 'Unknown'}</dd>
                    <dt className="text-gray-400">Issuer</dt>
                    <dd>{s.issuerName ?? 'Unknown'}</dd>
                    <dt className="text-gray-400">Format</dt>
                    <dd>
                      {s.kind === 'document-timestamp'
                        ? 'PAdES document timestamp (RFC 3161)'
                        : s.subFilter === 'ETSI.CAdES.detached'
                          ? `PAdES ${!s.timestamp ? '(B-B)' : result.ltv?.documentTimestamps ? '(B-LTA)' : result.ltv?.dss ? '(B-LT)' : '(B-T)'}`
                          : s.subFilter}
                    </dd>
                    {s.error && (
                      <>
                        <dt className="text-gray-400">Error</dt>
                        <dd className="text-red-600">{s.error}</dd>
                      </>
                    )}
                  </dl>
                ))}
              </Card>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
