'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Input, Label, Modal } from '@/components/ui';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/format';

interface DocTemplate {
  id: string;
  name: string;
  variables: string[];
  createdAt: string;
}

/** Word templates with {{placeholders}}: upload, then fill in a form to generate a new agreement. */
export function WordTemplates() {
  const router = useRouter();
  const [list, setList] = useState<DocTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [active, setActive] = useState<DocTemplate | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const load = useCallback(() => api<DocTemplate[]>('/doc-templates').then(setList), []);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function uploadFile(file: File) {
    setUploading(true);
    setError(null);
    const form = new FormData();
    form.append('file', file);
    try {
      await api('/doc-templates', { method: 'POST', body: form });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function generate() {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ envelopeId: string }>(`/doc-templates/${active.id}/generate`, { method: 'POST', json: { data: values, title: title.trim() || undefined } });
      router.push(`/envelopes/${res.envelopeId}/edit`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Word templates</h2>
          <p className="mt-1 text-sm text-gray-500">
            Upload a .docx with placeholders like <code className="rounded bg-gray-100 px-1">{'{{Client name}}'}</code>. Fill them in to create a ready-to-send agreement. Also available over the API.
          </p>
        </div>
        <Button variant="secondary" loading={uploading} onClick={() => input.current?.click()}>
          Upload .docx
        </Button>
        <input ref={input} type="file" accept=".docx" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadFile(f); }} />
      </div>
      {error && !active && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      {list.length > 0 && (
        <ul className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-200">
          {list.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{t.name}</div>
                <div className="truncate text-xs text-gray-500">
                  {t.variables.length} field{t.variables.length === 1 ? '' : 's'}: {t.variables.slice(0, 6).join(', ')}
                  {t.variables.length > 6 ? '…' : ''} · added {relativeTime(t.createdAt)}
                </div>
              </div>
              <Button size="sm" onClick={() => { setActive(t); setValues({}); setTitle(t.name); setError(null); }}>
                Generate
              </Button>
              <a className="text-sm text-gray-500 hover:text-gray-800" href={`/api/v1/doc-templates/${t.id}/file`}>
                Download
              </a>
              <button className="text-sm text-gray-400 hover:text-red-600" onClick={() => confirm(`Delete "${t.name}"?`) && api(`/doc-templates/${t.id}`, { method: 'DELETE' }).then(load)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!active} onClose={() => setActive(null)} title={active ? `Generate: ${active.name}` : ''}>
        {active && (
          <div className="space-y-3">
            {error && <Alert>{error}</Alert>}
            <div>
              <Label htmlFor="g-title">Agreement title</Label>
              <Input id="g-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
              {active.variables.map((v) => (
                <div key={v}>
                  <Label htmlFor={`g-${v}`}>{v}</Label>
                  <Input id={`g-${v}`} value={values[v] ?? ''} onChange={(e) => setValues({ ...values, [v]: e.target.value })} />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setActive(null)}>Cancel</Button>
              <Button onClick={generate} loading={busy}>Create agreement</Button>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}
