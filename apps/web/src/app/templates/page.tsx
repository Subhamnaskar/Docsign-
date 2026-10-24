'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { SigningLinks } from '@/components/SigningLinks';
import { Alert, Button, Card, EmptyState, Input, Label, Modal, PageLoader, Select } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { parseCsv, toCsv } from '@/lib/csv';
import { relativeTime } from '@/lib/format';
import { LANGUAGES } from '@/lib/i18n';
import type { Envelope, Template, TemplateSummary } from '@/lib/types';

const MAX_BULK_ROWS = 100;

interface Assignment {
  roleId: string;
  name: string;
  email: string;
  locale: string;
}

function UseTemplate({ template, onClose }: { template: Template; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(template.title);
  const [people, setPeople] = useState<Assignment[]>(template.roles.map((r) => ({ roleId: r.id, name: '', email: '', locale: 'en' })));
  const [busy, setBusy] = useState<'draft' | 'send' | null>(null);
  const [error, setError] = useState<{ message: string; problems: string[] } | null>(null);
  const set = (i: number, patch: Partial<Assignment>) => setPeople((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function create(send: boolean) {
    setBusy(send ? 'send' : 'draft');
    setError(null);
    try {
      const env = await api<Envelope>(`/templates/${template.id}/envelopes`, {
        method: 'POST',
        json: { title, recipients: people.map((p) => ({ ...p, name: p.name.trim(), email: p.email.trim() })), send },
      });
      router.push(send ? `/envelopes/${env.id}?sent=1` : `/envelopes/${env.id}/edit`);
    } catch (err) {
      setError({ message: (err as Error).message, problems: err instanceof ApiError ? err.problems : [] });
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <Alert title={error.message}>
          {error.problems.length > 0 && (
            <ul className="list-disc pl-4">
              {error.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}
      <div>
        <Label htmlFor="use-title">Agreement title</Label>
        <Input id="use-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </div>
      {template.roles.map((r, i) => (
        <div key={r.id} className="rounded-lg border border-gray-200 p-3">
          <div className="mb-2 text-sm font-medium">
            {r.name} <span className="font-normal text-gray-400">{r.role === 'CC' ? 'receives a copy' : `signs${template.routing === 'SEQUENTIAL' ? ` #${r.routingOrder}` : ''}`}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Input placeholder="Full name" value={people[i].name} onChange={(e) => set(i, { name: e.target.value })} />
            <Input type="email" placeholder="Email" value={people[i].email} onChange={(e) => set(i, { email: e.target.value })} />
            <Select aria-label="Language" value={people[i].locale} onChange={(e) => set(i, { locale: e.target.value })}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      ))}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="secondary" loading={busy === 'draft'} disabled={busy !== null} onClick={() => create(false)}>
          Review first
        </Button>
        <Button loading={busy === 'send'} disabled={busy !== null} onClick={() => create(true)}>
          Send now
        </Button>
      </div>
    </div>
  );
}

interface BulkResult {
  sent: number;
  failed: number;
  results: { row: number; envelopeId?: string; error?: string; problems?: string[] }[];
}

function BulkSend({ template, onClose }: { template: Template; onClose: () => void }) {
  const [rows, setRows] = useState<{ title?: string; recipients: Assignment[] }[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const header = useMemo(
    () => ['Title', ...template.roles.flatMap((r) => [`${r.name} Name`, `${r.name} Email`, `${r.name} Language`])],
    [template],
  );

  function downloadSample() {
    const sample = ['', ...template.roles.flatMap((r) => [`${r.name} Example`, `${r.name.toLowerCase().replace(/\W+/g, '.')}@example.com`, 'en'])];
    const blob = new Blob([toCsv([header, sample])], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${template.name.replace(/[^\w-]+/g, '_')}-bulk.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function load(file: File) {
    setParseError(null);
    setResult(null);
    const table = parseCsv(await file.text());
    if (table.length < 2) return setParseError('The file needs a header row and at least one data row.');
    const head = table[0].map((h) => h.trim().toLowerCase());
    const col = (name: string) => head.indexOf(name.toLowerCase());
    const missing = template.roles.flatMap((r) => [`${r.name} Name`, `${r.name} Email`]).filter((h) => col(h) === -1);
    if (missing.length) return setParseError(`Missing column(s): ${missing.join(', ')}`);
    const data = table.slice(1);
    if (data.length > MAX_BULK_ROWS) return setParseError(`Up to ${MAX_BULK_ROWS} rows per batch; this file has ${data.length}.`);
    const codes = LANGUAGES.map((l) => l.code);
    setRows(
      data.map((cells) => ({
        title: col('Title') >= 0 ? cells[col('Title')]?.trim() || undefined : undefined,
        recipients: template.roles.map((r) => {
          const lang = col(`${r.name} Language`) >= 0 ? cells[col(`${r.name} Language`)]?.trim().toLowerCase() : '';
          return {
            roleId: r.id,
            name: cells[col(`${r.name} Name`)]?.trim() ?? '',
            email: cells[col(`${r.name} Email`)]?.trim() ?? '',
            locale: codes.includes(lang) ? lang : 'en',
          };
        }),
      })),
    );
  }

  async function send() {
    if (!rows) return;
    setSending(true);
    setError(null);
    try {
      setResult(await api<BulkResult>(`/templates/${template.id}/bulk-send`, { method: 'POST', json: { rows } }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (result) {
    return (
      <div className="space-y-4">
        <Alert tone={result.failed ? 'warning' : 'success'} title={`${result.sent} sent, ${result.failed} failed`} />
        {result.failed > 0 && (
          <ul className="max-h-64 space-y-1 overflow-auto text-sm">
            {result.results
              .filter((r) => r.error)
              .map((r) => (
                <li key={r.row}>
                  <span className="font-medium">Row {r.row}:</span> {r.problems?.join(' ') ?? r.error}
                </li>
              ))}
          </ul>
        )}
        <div className="flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Upload a CSV with one row per agreement. Each row creates and sends a separate envelope. Required columns:{' '}
        {template.roles.map((r) => (
          <span key={r.id}>
            <code className="rounded bg-gray-100 px-1 text-xs">{r.name} Name</code>, <code className="rounded bg-gray-100 px-1 text-xs">{r.name} Email</code>{' '}
          </span>
        ))}
        . Optional: <code className="rounded bg-gray-100 px-1 text-xs">Title</code> and a <code className="rounded bg-gray-100 px-1 text-xs">Language</code> column per role.
      </p>
      <Button variant="secondary" size="sm" onClick={downloadSample}>
        Download CSV template
      </Button>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => e.target.files?.[0] && load(e.target.files[0])}
        className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700"
      />
      {parseError && <Alert>{parseError}</Alert>}
      {error && <Alert>{error}</Alert>}
      {rows && (
        <div className="max-h-64 overflow-auto rounded-lg border border-gray-200">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-gray-50 text-gray-500">
              <tr>
                <th className="px-2 py-1.5">#</th>
                {template.roles.map((r) => (
                  <th key={r.id} className="px-2 py-1.5">
                    {r.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row, i) => (
                <tr key={i}>
                  <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
                  {row.recipients.map((p) => (
                    <td key={p.roleId} className="px-2 py-1.5">
                      {p.name} <span className="text-gray-400">{p.email}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={send} loading={sending} disabled={!rows}>
          Send {rows ? rows.length : ''} agreement{rows?.length === 1 ? '' : 's'}
        </Button>
      </div>
    </div>
  );
}

function Templates() {
  const [list, setList] = useState<TemplateSummary[] | null>(null);
  const [active, setActive] = useState<{ template: Template; mode: 'use' | 'bulk' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<TemplateSummary[]>('/templates').then(setList).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);

  async function open(id: string, mode: 'use' | 'bulk') {
    setActive({ template: await api<Template>(`/templates/${id}`), mode });
  }

  async function remove(t: TemplateSummary) {
    if (!confirm(`Delete the template "${t.name}"? Agreements already sent from it are not affected.`)) return;
    await api(`/templates/${t.id}`, { method: 'DELETE' });
    load();
  }

  if (!list) return error ? <Alert>{error}</Alert> : <PageLoader />;

  return (
    <>
      <h1 className="text-2xl font-semibold">Templates</h1>
      <p className="text-sm text-gray-500">Reuse documents and field layouts. To create one, open any agreement and choose “Save as template”.</p>
      <Card className="mt-6">
        {list.length === 0 ? (
          <EmptyState title="No templates yet">Open an agreement and choose “Save as template”.</EmptyState>
        ) : (
          <ul className="divide-y divide-gray-100">
            {list.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{t.name}</div>
                  <div className="truncate text-sm text-gray-500">
                    {t.roles.map((r) => r.name).join(', ')} · {t.documentCount} document{t.documentCount === 1 ? '' : 's'} · {t.jurisdiction} · updated {relativeTime(t.updatedAt)}
                  </div>
                  {t.description && <div className="truncate text-xs text-gray-400">{t.description}</div>}
                </div>
                <Button size="sm" onClick={() => open(t.id, 'use')}>
                  Use
                </Button>
                <Button size="sm" variant="secondary" onClick={() => open(t.id, 'bulk')}>
                  Bulk send
                </Button>
                <button onClick={() => remove(t)} className="text-sm text-gray-400 hover:text-red-600">
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <SigningLinks templates={list} />
      <Modal open={!!active} onClose={() => setActive(null)} title={active ? `${active.mode === 'use' ? 'Use' : 'Bulk send'}: ${active.template.name}` : ''} wide>
        {active?.mode === 'use' && <UseTemplate template={active.template} onClose={() => setActive(null)} />}
        {active?.mode === 'bulk' && <BulkSend template={active.template} onClose={() => setActive(null)} />}
      </Modal>
    </>
  );
}

export default function TemplatesPage() {
  return (
    <AppShell>
      <Templates />
    </AppShell>
  );
}
