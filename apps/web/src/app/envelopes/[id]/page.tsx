'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { AppShell, useMe } from '@/components/AppShell';
import { AiAskPanel } from '@/components/AiPanels';
import { CompliancePanel } from '@/components/CompliancePanel';
import { SaveTemplateModal } from '@/components/SaveTemplateModal';
import { Alert, Button, Card, cx, Input, Label, Modal, PageLoader, StatusBadge, Textarea } from '@/components/ui';
import { api, fileUrl } from '@/lib/api';
import { AUDIT_LABELS, formatDate } from '@/lib/format';
import type { AuditEvent, Envelope, Recipient } from '@/lib/types';

interface AuditResponse {
  chain: { valid: boolean; count: number; headHash: string; brokenAtSeq?: number };
  events: AuditEvent[];
}

function RecipientRow({ r, sequential, onCorrect, onHost }: { r: Recipient; sequential: boolean; onCorrect?: () => void; onHost?: () => void }) {
  const detail =
    r.status === 'SIGNED'
      ? `Signed ${formatDate(r.signedAt)}`
      : r.status === 'DECLINED'
        ? `Declined ${formatDate(r.declinedAt)}${r.declineReason ? `: "${r.declineReason}"` : ''}`
        : r.status === 'VIEWED'
          ? `Viewed ${formatDate(r.viewedAt)}`
          : r.status === 'SENT'
            ? `Sent ${formatDate(r.lastNotifiedAt)}`
            : r.role === 'CC'
              ? 'Receives a copy when complete'
              : 'Waiting for earlier signers';
  return (
    <li className="flex items-center gap-3 py-3">
      <span
        className={cx(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
          r.status === 'SIGNED' ? 'bg-green-100 text-green-700' : r.status === 'DECLINED' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600',
        )}
      >
        {r.status === 'SIGNED' ? '✓' : sequential && r.role === 'SIGNER' ? r.routingOrder : r.name.charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {r.name} <span className="font-normal text-gray-500">{r.email}</span>
        </div>
        <div className="truncate text-xs text-gray-500">
          {detail}
          {r.signatureMethod === 'AADHAAR_ESIGN' && ' · Aadhaar eSign'}
          {r.signatureMethod === 'DSC' && ' · DSC token'}
        </div>
      </div>
      {onHost && (
        <Button size="sm" onClick={onHost}>
          Start in-person signing
        </Button>
      )}
      {onCorrect && (
        <button onClick={onCorrect} className="text-xs font-medium text-brand-600 hover:underline">
          Correct
        </button>
      )}
      {r.role !== 'CC' ? <StatusBadge status={r.status} recipient /> : <span className="text-xs text-gray-400">CC</span>}
    </li>
  );
}

function Detail() {
  const me = useMe();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const [env, setEnv] = useState<Envelope | null>(null);
  const [audit, setAudit] = useState<AuditResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(params.get('sent') ? 'Sent! Signers will receive an email with their signing link.' : null);
  const [voidOpen, setVoidOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [correcting, setCorrecting] = useState<Recipient | null>(null);
  const [correction, setCorrection] = useState({ name: '', email: '' });
  const [voidReason, setVoidReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [e, a] = await Promise.all([api<Envelope>(`/envelopes/${id}`), api<AuditResponse>(`/envelopes/${id}/audit`)]);
    if (e.status === 'DRAFT') router.replace(`/envelopes/${id}/edit`);
    setEnv(e);
    setAudit(a);
  }, [id, router]);

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [load]);

  // Poll while signing is in progress so completion shows up without a refresh
  useEffect(() => {
    if (env?.status !== 'SENT') return;
    const t = setInterval(() => load().catch(() => {}), 8000);
    return () => clearInterval(t);
  }, [env?.status, load]);

  if (error) return <Alert>{error}</Alert>;
  if (!env || !audit) return <PageLoader />;

  async function action(name: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(name);
    setError(null);
    try {
      await fn();
      if (done) setNotice(done);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const signers = env.recipients.filter((r) => r.role === 'SIGNER');
  const signed = signers.filter((r) => r.status === 'SIGNED').length;
  const sealing = env.status === 'SENT' && signed === signers.length;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-800">
            ← Agreements
          </Link>
          <h1 className="mt-1 truncate text-2xl font-semibold">{env.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-gray-500">
            <StatusBadge status={env.status} />
            <span>Sent {formatDate(env.sentAt)}</span>
            {env.completedAt && <span>Completed {formatDate(env.completedAt)}</span>}
            <span className="font-mono text-xs">ID {env.id}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {env.status === 'SENT' && (
            <>
              <Button variant="secondary" loading={busy === 'remind'} onClick={() => action('remind', () => api(`/envelopes/${id}/remind`, { method: 'POST' }), 'Reminders sent.')}>
                Send reminder
              </Button>
              <Button variant="secondary" className="text-red-600" onClick={() => setVoidOpen(true)}>
                Void
              </Button>
            </>
          )}
          <Button
            variant="secondary"
            loading={busy === 'duplicate'}
            onClick={() =>
              action('duplicate', async () => {
                const copy = await api<Envelope>(`/envelopes/${id}/duplicate`, { method: 'POST' });
                router.push(`/envelopes/${copy.id}/edit`);
              })
            }
          >
            Duplicate
          </Button>
          <Button variant="secondary" onClick={() => setTemplateOpen(true)}>
            Save as template
          </Button>
        </div>
      </div>

      {notice && (
        <div className="mb-4">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}
      {env.status === 'VOIDED' && env.voidReason && (
        <div className="mb-4">
          <Alert tone="warning" title="This envelope was voided">
            {env.voidReason}
          </Alert>
        </div>
      )}
      {sealing && (
        <div className="mb-4">
          <Alert tone="info">Everyone has signed. Sealing documents and issuing the certificate…</Alert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Recipients</h2>
              <span className="text-sm text-gray-500">
                {signed} of {signers.length} signed
              </span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100">
              <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${signers.length ? (signed / signers.length) * 100 : 0}%` }} />
            </div>
            <ul className="mt-2 divide-y divide-gray-100">
              {env.recipients.map((r) => (
                <RecipientRow
                  key={r.id}
                  r={r}
                  sequential={env.routing === 'SEQUENTIAL'}
                  onHost={
                    r.inPerson && env.status === 'SENT' && (r.status === 'SENT' || r.status === 'VIEWED')
                      ? () =>
                          action('host', async () => {
                            const { signPath } = await api<{ signPath: string }>(`/envelopes/${id}/recipients/${r.id}/host-session`, { method: 'POST' });
                            router.push(signPath);
                          })
                      : undefined
                  }
                  onCorrect={
                    env.status === 'SENT' && r.role !== 'CC' && r.status !== 'SIGNED' && r.status !== 'DECLINED'
                      ? () => {
                          setCorrection({ name: r.name, email: r.email });
                          setCorrecting(r);
                        }
                      : undefined
                  }
                />
              ))}
            </ul>
          </Card>

          <Card className="p-5">
            <h2 className="font-semibold">Documents</h2>
            <ul className="mt-3 space-y-2">
              {env.documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{d.name}</div>
                    <div className="truncate font-mono text-[11px] text-gray-400" title={d.finalSha256 ?? d.sha256}>
                      {d.completed ? `Sealed · SHA-256 ${d.finalSha256?.slice(0, 24)}…` : `Original · SHA-256 ${d.sha256.slice(0, 24)}…`}
                    </div>
                  </div>
                  <a className="text-sm font-medium text-brand-600 hover:underline" href={fileUrl(`/envelopes/${id}/documents/${d.id}/file?version=original`)} target="_blank" rel="noreferrer">
                    Original
                  </a>
                  {d.completed && (
                    <a className="text-sm font-medium text-brand-600 hover:underline" href={fileUrl(`/envelopes/${id}/documents/${d.id}/file`)} target="_blank" rel="noreferrer">
                      Signed PDF
                    </a>
                  )}
                </li>
              ))}
              {env.hasCertificate && (
                <li className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-green-900">Certificate of Completion</div>
                    <div className="truncate font-mono text-[11px] text-green-700/70">SHA-256 {env.certificateSha256?.slice(0, 24)}…</div>
                  </div>
                  <a className="text-sm font-medium text-green-700 hover:underline" href={fileUrl(`/envelopes/${id}/certificate`)} target="_blank" rel="noreferrer">
                    Download
                  </a>
                </li>
              )}
            </ul>
          </Card>

          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Audit trail</h2>
              <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium', audit.chain.valid ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700')}>
                {audit.chain.valid ? `✓ Hash chain intact (${audit.chain.count} events)` : `✗ Chain broken at event #${audit.chain.brokenAtSeq}`}
              </span>
            </div>
            <ol className="relative mt-4 border-l border-gray-200 pl-5">
              {audit.events.map((e) => (
                <li key={e.id} className="mb-4 last:mb-0">
                  <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-500" />
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium">{AUDIT_LABELS[e.type] ?? e.type}</span>
                    <span className="text-xs text-gray-400">{formatDate(e.createdAt)}</span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {e.actor.kind === 'system' ? 'System' : `${e.actor.name ?? ''}${e.actor.email ? ` <${e.actor.email}>` : ''}`}
                    {e.ip && ` · IP ${e.ip}`}
                  </div>
                  <div className="truncate font-mono text-[10px] text-gray-300" title={e.hash}>
                    #{e.seq} {e.hash}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <CompliancePanel policy={env.policy} />
          {me?.features?.ai && me.organization.aiEnabled && <AiAskPanel envelopeId={env.id} />}
          {env.estampResult && (
            <Card className="p-4 text-sm">
              <h3 className="font-semibold">e-Stamp</h3>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-gray-600">
                <dt className="text-gray-400">Certificate</dt>
                <dd className="font-mono text-xs">{env.estampResult.certificateNumber}</dd>
                <dt className="text-gray-400">State</dt>
                <dd>{env.estampResult.state}</dd>
                <dt className="text-gray-400">Duty</dt>
                <dd>₹{env.estampResult.dutyAmount.toFixed(2)}</dd>
              </dl>
              {env.estampResult.sandbox && <p className="mt-2 text-xs text-amber-700">Sandbox specimen: not a valid stamp.</p>}
            </Card>
          )}
          <Card className="p-4 text-sm text-gray-600">
            Anyone can check a signed PDF or certificate on the{' '}
            <Link href="/verify" className="font-medium text-brand-600 hover:underline">
              verification page
            </Link>
            .
          </Card>
        </div>
      </div>

      <Modal open={!!correcting} onClose={() => setCorrecting(null)} title="Correct recipient">
        <p className="text-sm text-gray-600">Fix a typo or send to the right person. Their previous signing link stops working and a new one is emailed.</p>
        <div className="mt-4 space-y-3">
          <div>
            <Label htmlFor="cor-name">Name</Label>
            <Input id="cor-name" value={correction.name} onChange={(e) => setCorrection((c) => ({ ...c, name: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="cor-email">Email</Label>
            <Input id="cor-email" type="email" value={correction.email} onChange={(e) => setCorrection((c) => ({ ...c, email: e.target.value }))} />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCorrecting(null)}>
            Cancel
          </Button>
          <Button
            loading={busy === 'correct'}
            disabled={!correction.name.trim() || !correction.email.trim()}
            onClick={() =>
              action(
                'correct',
                async () => {
                  await api(`/envelopes/${id}/recipients/${correcting!.id}/correct`, { method: 'POST', json: correction });
                  setCorrecting(null);
                },
                'Recipient updated and a new signing link sent.',
              )
            }
          >
            Save and resend
          </Button>
        </div>
      </Modal>

      {templateOpen && <SaveTemplateModal env={env} open onClose={() => setTemplateOpen(false)} />}

      <Modal open={voidOpen} onClose={() => setVoidOpen(false)} title="Void this envelope?">
        <p className="text-sm text-gray-600">Signers can no longer open or sign it. Everyone who received it gets an email.</p>
        <Textarea className="mt-4" rows={3} placeholder="Reason (shared with recipients)" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setVoidOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={!voidReason.trim()}
            loading={busy === 'void'}
            onClick={() =>
              action('void', async () => {
                await api(`/envelopes/${id}/void`, { method: 'POST', json: { reason: voidReason.trim() } });
                setVoidOpen(false);
              })
            }
          >
            Void envelope
          </Button>
        </div>
      </Modal>
    </>
  );
}

export default function EnvelopePage() {
  return (
    <AppShell>
      <Suspense>
        <Detail />
      </Suspense>
    </AppShell>
  );
}
