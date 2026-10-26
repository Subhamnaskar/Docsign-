'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { DocumentViewer } from '@/components/DocumentViewer';
import { Alert, cx, PageLoader } from '@/components/ui';
import { api, ApiError, fileUrl } from '@/lib/api';
import { useInApp } from '@/lib/inApp';
import type { Envelope } from '@/lib/types';

type Version = 'original' | 'signed';

/** Reads an agreement's documents: /envelopes/:id/view?doc=<documentId>&version=original|signed */
function Viewer() {
  const { id } = useParams<{ id: string }>()!;
  const [env, setEnv] = useState<Envelope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [version, setVersion] = useState<Version>('signed');
  const inApp = useInApp();

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    api<Envelope>(`/envelopes/${id}`)
      .then((e) => {
        setEnv(e);
        setDocId(e.documents.find((d) => d.id === q.get('doc'))?.id ?? e.documents[0]?.id ?? null);
        setVersion(q.get('version') === 'original' ? 'original' : 'signed');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not open this agreement.'));
  }, [id]);

  // Keep the address in step, so a reload or a shared link opens the same view
  useEffect(() => {
    if (!docId) return;
    const q = new URLSearchParams(window.location.search);
    q.set('doc', docId);
    q.set('version', version);
    window.history.replaceState(null, '', `${window.location.pathname}?${q}`);
  }, [docId, version]);

  if (error) return <Alert>{error}</Alert>;
  if (!env) return <PageLoader />;
  const doc = env.documents.find((d) => d.id === docId);
  if (!doc) return <Alert tone="info">This agreement has no documents yet.</Alert>;

  const showSigned = version === 'signed' && doc.completed;
  const url = fileUrl(`/envelopes/${env.id}/documents/${doc.id}/file${showSigned ? '' : '?version=original'}`);
  const base = doc.name.replace(/\.pdf$/i, '');
  const filename = showSigned ? `${base} (signed).pdf` : `${base}.pdf`;
  const fingerprint = showSigned ? doc.finalSha256 : doc.sha256;

  return (
    <div className="space-y-3">
      {!inApp && (
        <Link href={`/envelopes/${env.id}`} className="inline-block text-sm font-medium text-brand-700 hover:underline">
          ← {env.title}
        </Link>
      )}
      <DocumentViewer
        key={url}
        url={url}
        filename={filename}
        downloads={!inApp}
        heightClassName={inApp ? 'h-[calc(100dvh-2rem)]' : undefined}
        toolbar={
          <>
            {env.documents.length > 1 && (
              <select
                aria-label="Document"
                value={doc.id}
                onChange={(e) => setDocId(e.target.value)}
                className="max-w-[14rem] truncate rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm"
              >
                {env.documents.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            )}
            {env.documents.length === 1 && <span className="max-w-[16rem] truncate text-sm font-semibold">{doc.name}</span>}
            {doc.completed && (
              <div className="flex rounded-lg bg-gray-100 p-0.5 text-sm" role="tablist" aria-label="Version">
                {(['signed', 'original'] as const).map((v) => (
                  <button
                    key={v}
                    role="tab"
                    aria-selected={version === v}
                    onClick={() => setVersion(v)}
                    className={cx('rounded-md px-3 py-1', version === v ? 'bg-white font-semibold text-ink shadow-sm' : 'text-gray-600')}
                  >
                    {v === 'signed' ? 'Signed' : 'Original'}
                  </button>
                ))}
              </div>
            )}
          </>
        }
        footer={
          fingerprint && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-200 px-3 py-2 text-xs text-gray-500">
              <span className={cx('rounded-full px-2 py-0.5 font-semibold', showSigned ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600')}>
                {showSigned ? 'Sealed by Nuronix eSign' : 'Original as uploaded'}
              </span>
              <span className="truncate font-mono" title={fingerprint}>
                SHA-256 {fingerprint.slice(0, 32)}…
              </span>
              {showSigned && (
                <Link href="/verify" className="ml-auto font-medium text-brand-700 hover:underline">
                  Verify a copy
                </Link>
              )}
            </div>
          )
        }
      />
    </div>
  );
}

export default function ViewDocumentPage() {
  return (
    <AppShell wide>
      <Viewer />
    </AppShell>
  );
}
