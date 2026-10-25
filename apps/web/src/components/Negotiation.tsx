'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMe } from '@/components/AppShell';
import { Alert, Button, Card, cx, Input, Label, Select, Textarea } from '@/components/ui';
import { api, upload } from '@/lib/api';
import { formatDate, relativeTime } from '@/lib/format';
import type { Envelope } from '@/lib/types';

// --- Approval ---------------------------------------------------------------------

/** Shown on drafts waiting for internal approval. Approvers approve (which sends) or send back with a note. */
export function ApprovalBanner({ env, onChange }: { env: Envelope; onChange: () => Promise<void> }) {
  const me = useMe();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!env.approval || env.status !== 'DRAFT') return null;
  const org = me?.organization;
  const user = me?.user;
  const approver = Boolean(user && org && (org.approverIds?.length ? org.approverIds.includes(user.id) : user.role === 'OWNER' || user.role === 'ADMIN'));
  const canDecide = approver && env.approval.requestedBy !== user?.id;

  async function decide(decision: 'approve' | 'reject') {
    setBusy(decision);
    setError(null);
    try {
      await api(`/envelopes/${env.id}/approval`, { method: 'POST', json: { decision, note: note.trim() || undefined } });
      await onChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (env.approval.status === 'REJECTED') {
    return (
      <Alert tone="warning" title="Sent back for changes">
        {env.approval.note ? `"${env.approval.note}" ` : ''}Edit the agreement and send it again to request approval.{' '}
        <Link href={`/envelopes/${env.id}/edit`} className="font-semibold underline">
          Edit agreement
        </Link>
      </Alert>
    );
  }
  if (env.approval.status !== 'PENDING') return null;
  return (
    <Card className="border-amber-200 bg-amber-50 p-5">
      <h2 className="font-semibold text-amber-900">Waiting for approval</h2>
      <p className="mt-1 text-sm text-amber-900">
        Requested {relativeTime(env.approval.requestedAt)}. It will be sent to the recipients once approved.
        {!canDecide && (
          <>
            {' '}
            <Link href={`/envelopes/${env.id}/edit`} className="font-semibold underline">
              Edit before approval
            </Link>
          </>
        )}
      </p>
      {canDecide && (
        <div className="mt-4 space-y-3">
          {error && <Alert>{error}</Alert>}
          <Textarea rows={2} placeholder="Note for the sender (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => decide('approve')} loading={busy === 'approve'} disabled={busy !== null}>
              Approve and send
            </Button>
            <Button variant="secondary" onClick={() => decide('reject')} loading={busy === 'reject'} disabled={busy !== null}>
              Send back
            </Button>
            <Link href={`/envelopes/${env.id}/edit`} className="self-center text-sm font-medium text-amber-900 underline">
              Review in editor
            </Link>
          </div>
        </div>
      )}
    </Card>
  );
}

// --- Key terms ----------------------------------------------------------------------

interface Terms {
  counterparty: string | null;
  value: number | null;
  currency: string | null;
  effectiveDate: string | null;
  expiryDate: string | null;
  renewalDate: string | null;
  noticeDays: number | null;
  autoRenews: boolean;
  tags: string[];
  notes: string | null;
  source: string;
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

/** Key commercial terms for the contract repository, with optional AI extraction. */
export function ContractTerms({ envelopeId }: { envelopeId: string }) {
  const me = useMe();
  const [terms, setTerms] = useState<Terms | null>(null);
  const [form, setForm] = useState({ counterparty: '', value: '', currency: 'INR', effectiveDate: '', expiryDate: '', renewalDate: '', noticeDays: '', autoRenews: false, tags: '', notes: '' });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const adopt = useCallback((t: Terms | null) => {
    setTerms(t);
    setForm({
      counterparty: t?.counterparty ?? '',
      value: t?.value !== null && t?.value !== undefined ? String(t.value / 100) : '',
      currency: t?.currency ?? 'INR',
      effectiveDate: day(t?.effectiveDate ?? null),
      expiryDate: day(t?.expiryDate ?? null),
      renewalDate: day(t?.renewalDate ?? null),
      noticeDays: t?.noticeDays !== null && t?.noticeDays !== undefined ? String(t.noticeDays) : '',
      autoRenews: Boolean(t?.autoRenews),
      tags: (t?.tags ?? []).join(', '),
      notes: t?.notes ?? '',
    });
  }, []);
  useEffect(() => {
    api<Terms | null>(`/envelopes/${envelopeId}/contract`).then(adopt).catch(() => {});
  }, [envelopeId, adopt]);

  async function run(name: string, fn: () => Promise<Terms>) {
    setBusy(name);
    setError(null);
    try {
      adopt(await fn());
      setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const save = () =>
    run('save', () =>
      api(`/envelopes/${envelopeId}/contract`, {
        method: 'PUT',
        json: {
          counterparty: form.counterparty.trim() || null,
          value: form.value ? Math.round(Number(form.value) * 100) : null,
          currency: form.value ? form.currency : null,
          effectiveDate: form.effectiveDate || null,
          expiryDate: form.expiryDate || null,
          renewalDate: form.renewalDate || null,
          noticeDays: form.noticeDays ? Number(form.noticeDays) : null,
          autoRenews: form.autoRenews,
          tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
          notes: form.notes.trim() || null,
        },
      }),
    );
  const aiOn = Boolean(me?.features?.ai && me.organization.aiEnabled);
  const money = (v: number, c: string | null) => new Intl.NumberFormat(c === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: c ?? 'INR', maximumFractionDigits: 0 }).format(v / 100);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Key terms</h2>
        <div className="flex gap-2">
          {aiOn && !editing && (
            <Button size="sm" variant="secondary" loading={busy === 'ai'} onClick={() => run('ai', () => api(`/envelopes/${envelopeId}/contract/extract`, { method: 'POST' }))}>
              Extract with AI
            </Button>
          )}
          {!editing && (
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              {terms ? 'Edit' : 'Add terms'}
            </Button>
          )}
        </div>
      </div>
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      {!editing && terms && (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {terms.counterparty && (<><dt className="text-gray-500">Counterparty</dt><dd>{terms.counterparty}</dd></>)}
          {terms.value !== null && (<><dt className="text-gray-500">Value</dt><dd>{money(terms.value, terms.currency)}</dd></>)}
          {terms.effectiveDate && (<><dt className="text-gray-500">Effective</dt><dd>{formatDate(terms.effectiveDate)}</dd></>)}
          {terms.expiryDate && (<><dt className="text-gray-500">Expires</dt><dd>{formatDate(terms.expiryDate)}</dd></>)}
          {terms.renewalDate && (<><dt className="text-gray-500">Renews</dt><dd>{formatDate(terms.renewalDate)}{terms.autoRenews ? ' (automatically)' : ''}</dd></>)}
          {terms.noticeDays !== null && (<><dt className="text-gray-500">Notice</dt><dd>{terms.noticeDays} days</dd></>)}
          {terms.tags.length > 0 && (
            <>
              <dt className="text-gray-500">Tags</dt>
              <dd className="flex flex-wrap gap-1">
                {terms.tags.map((t) => (
                  <span key={t} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">{t}</span>
                ))}
              </dd>
            </>
          )}
          {terms.notes && (<><dt className="text-gray-500">Notes</dt><dd className="whitespace-pre-line">{terms.notes}</dd></>)}
          {terms.source === 'ai' && <dd className="col-span-2 mt-1 text-xs text-amber-700">Extracted by AI. Check against the document and edit if needed.</dd>}
        </dl>
      )}
      {!editing && !terms && <p className="mt-2 text-sm text-gray-500">Add the counterparty, value and key dates to find this agreement later and get renewal reminders.</p>}
      {editing && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="t-cp">Counterparty</Label>
            <Input id="t-cp" value={form.counterparty} onChange={set('counterparty')} />
          </div>
          <div className="grid grid-cols-[1fr_90px] gap-2">
            <div>
              <Label htmlFor="t-val">Value</Label>
              <Input id="t-val" type="number" min={0} value={form.value} onChange={set('value')} />
            </div>
            <div>
              <Label htmlFor="t-cur">Currency</Label>
              <Select id="t-cur" value={form.currency} onChange={set('currency')}>
                {['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'].map((c) => <option key={c}>{c}</option>)}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="t-notice">Notice period (days)</Label>
            <Input id="t-notice" type="number" min={0} value={form.noticeDays} onChange={set('noticeDays')} />
          </div>
          <div>
            <Label htmlFor="t-eff">Effective date</Label>
            <Input id="t-eff" type="date" value={form.effectiveDate} onChange={set('effectiveDate')} />
          </div>
          <div>
            <Label htmlFor="t-exp">Expiry date</Label>
            <Input id="t-exp" type="date" value={form.expiryDate} onChange={set('expiryDate')} />
          </div>
          <div>
            <Label htmlFor="t-ren">Renewal date</Label>
            <Input id="t-ren" type="date" value={form.renewalDate} onChange={set('renewalDate')} />
          </div>
          <label className="flex items-center gap-2 self-end text-sm">
            <input type="checkbox" checked={form.autoRenews} onChange={(e) => setForm({ ...form, autoRenews: e.target.checked })} />
            Renews automatically
          </label>
          <div className="sm:col-span-2">
            <Label htmlFor="t-tags" hint="(comma separated)">Tags</Label>
            <Input id="t-tags" value={form.tags} onChange={set('tags')} placeholder="lease, vendor, Bengaluru" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="t-notes">Notes</Label>
            <Textarea id="t-notes" rows={2} value={form.notes} onChange={set('notes')} />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button onClick={save} loading={busy === 'save'}>Save</Button>
            <Button variant="ghost" onClick={() => { adopt(terms); setEditing(false); }}>Cancel</Button>
          </div>
          <p className="text-xs text-gray-500 sm:col-span-2">You get an email reminder 14 days before the notice deadline.</p>
        </div>
      )}
    </Card>
  );
}

// --- Comments -----------------------------------------------------------------------

export interface CommentRow {
  id: string;
  documentId: string | null;
  page: number | null;
  authorKind: 'user' | 'recipient';
  authorName: string;
  body: string;
  parentId: string | null;
  resolved: boolean;
  createdAt: string;
}

/** Threaded comments; the sender can reply and resolve. Signers use the same component in read/write mode. */
export function CommentThread({
  comments,
  documents,
  onPost,
  onResolve,
  canPost = true,
}: {
  comments: CommentRow[];
  documents: { id: string; name: string; pageCount: number }[];
  onPost: (input: { body: string; parentId?: string; documentId?: string; page?: number }) => Promise<void>;
  onResolve?: (id: string, resolved: boolean) => Promise<void>;
  canPost?: boolean;
}) {
  const [body, setBody] = useState('');
  const [docId, setDocId] = useState(documents[0]?.id ?? '');
  const [page, setPage] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const roots = comments.filter((c) => !c.parentId);
  const docName = (id: string | null) => documents.find((d) => d.id === id)?.name;

  async function post(input: Parameters<typeof onPost>[0], reset: () => void) {
    setError(null);
    try {
      await onPost(input);
      reset();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="space-y-3">
      {error && <Alert>{error}</Alert>}
      {roots.length === 0 && <p className="text-sm text-gray-500">No comments yet.</p>}
      <ul className="space-y-3">
        {roots.map((c) => (
          <li key={c.id} className={cx('rounded-lg border p-3 text-sm', c.resolved ? 'border-gray-100 bg-gray-50 text-gray-500' : 'border-gray-200')}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span>
                <span className="font-medium text-gray-900">{c.authorName}</span>
                <span className="text-xs text-gray-500"> · {c.authorKind === 'recipient' ? 'recipient' : 'sender'} · {relativeTime(c.createdAt)}</span>
              </span>
              {c.documentId && <span className="text-xs text-gray-500">{docName(c.documentId)}{c.page !== null ? `, page ${c.page + 1}` : ''}</span>}
            </div>
            <p className="mt-1 whitespace-pre-line">{c.body}</p>
            {comments.filter((r) => r.parentId === c.id).map((r) => (
              <div key={r.id} className="mt-2 border-l-2 border-gray-200 pl-3">
                <span className="font-medium text-gray-900">{r.authorName}</span>
                <span className="text-xs text-gray-500"> · {relativeTime(r.createdAt)}</span>
                <p className="whitespace-pre-line">{r.body}</p>
              </div>
            ))}
            <div className="mt-2 flex gap-3 text-xs">
              {canPost && !c.resolved && (
                <button className="font-medium text-brand-700 hover:underline" onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}>
                  Reply
                </button>
              )}
              {onResolve && (
                <button className="font-medium text-gray-600 hover:underline" onClick={() => onResolve(c.id, !c.resolved)}>
                  {c.resolved ? 'Reopen' : 'Resolve'}
                </button>
              )}
            </div>
            {replyTo === c.id && (
              <div className="mt-2 flex gap-2">
                <Input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply" aria-label="Reply" />
                <Button size="sm" disabled={!reply.trim()} onClick={() => post({ body: reply.trim(), parentId: c.id }, () => { setReply(''); setReplyTo(null); })}>
                  Send
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {canPost && (
        <div className="space-y-2 border-t border-gray-100 pt-3">
          <Textarea rows={2} placeholder="Add a comment, e.g. a change you need in clause 4" value={body} onChange={(e) => setBody(e.target.value)} aria-label="New comment" />
          <div className="flex flex-wrap items-center gap-2">
            {documents.length > 0 && (
              <>
                <Select value={docId} onChange={(e) => setDocId(e.target.value)} aria-label="Document" className="w-auto">
                  {documents.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
                <Input type="number" min={1} max={documents.find((d) => d.id === docId)?.pageCount} placeholder="Page" value={page} onChange={(e) => setPage(e.target.value)} className="w-24" aria-label="Page" />
              </>
            )}
            <Button size="sm" disabled={!body.trim()} onClick={() => post({ body: body.trim(), documentId: docId || undefined, page: page ? Number(page) - 1 : undefined }, () => { setBody(''); setPage(''); })}>
              Comment
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Sender's comments card on the agreement page. */
export function SenderComments({ env }: { env: Envelope }) {
  const [comments, setComments] = useState<CommentRow[]>([]);
  const load = useCallback(() => api<CommentRow[]>(`/envelopes/${env.id}/comments`).then(setComments), [env.id]);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);
  const open = env.status === 'SENT' || env.status === 'DRAFT';
  if (!open && comments.length === 0) return null;
  return (
    <Card className="p-5">
      <h2 className="font-semibold">Comments</h2>
      <div className="mt-3">
        <CommentThread
          comments={comments}
          documents={env.documents}
          canPost={open}
          onPost={async (input) => {
            await api(`/envelopes/${env.id}/comments`, { method: 'POST', json: input });
            await load();
          }}
          onResolve={async (cid, resolved) => {
            await api(`/envelopes/${env.id}/comments/${cid}`, { method: 'PATCH', json: { resolved } });
            await load();
          }}
        />
      </div>
    </Card>
  );
}

/** "Upload revised version" for a document while nobody has signed. */
export function ReviseButton({ envelopeId, documentId, onDone }: { envelopeId: string; documentId: string; onDone: (msg: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button className="text-sm font-medium text-brand-600 hover:underline disabled:opacity-50" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'Uploading…' : 'Upload revised version'}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        accept=".pdf,.doc,.docx,.odt,.rtf,.txt"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setBusy(true);
          setError(null);
          try {
            const res = await upload<{ version: number; notified: number }>(`/envelopes/${envelopeId}/documents/${documentId}/revise`, f);
            onDone(`Version ${res.version} uploaded. ${res.notified} signer${res.notified === 1 ? '' : 's'} asked to review it.`);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
      {error && <span className="w-full text-xs text-red-600">{error}</span>}
    </>
  );
}
