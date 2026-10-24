'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TemplateSummary } from '@/lib/types';
import { Alert, Button, Card, Input, Label, Modal, Select } from './ui';
import { api } from '@/lib/api';

interface SigningForm {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  maxUses: number | null;
  uses: number;
  templateName: string;
}

const linkFor = (slug: string) => `${window.location.origin}/f/${slug}`;

/** Self-serve signing links: public URLs where anyone can sign their own copy of a template. */
export function SigningLinks({ templates }: { templates: TemplateSummary[] }) {
  const eligible = templates.filter((t) => t.roles.length === 1 && t.roles[0].role === 'SIGNER');
  const [forms, setForms] = useState<SigningForm[]>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ templateId: '', name: '', maxUses: '' });
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const load = useCallback(() => api<SigningForm[]>('/forms').then(setForms), []);
  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    setError(null);
    try {
      await api('/forms', {
        method: 'POST',
        json: { templateId: draft.templateId, name: draft.name, maxUses: draft.maxUses ? Number(draft.maxUses) : null },
      });
      setOpen(false);
      setDraft({ templateId: '', name: '', maxUses: '' });
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function copy(slug: string) {
    await navigator.clipboard.writeText(linkFor(slug));
    setCopied(slug);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <Card className="mt-8 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Signing links</h2>
          <p className="text-sm text-gray-500">
            A public link anyone can open to sign their own copy, e.g. waivers or consent forms. Signers still confirm their email with a one-time code.
          </p>
        </div>
        <Button
          variant="secondary"
          disabled={eligible.length === 0}
          title={eligible.length === 0 ? 'Needs a template with exactly one signer' : undefined}
          onClick={() => {
            setDraft({ templateId: eligible[0]?.id ?? '', name: eligible[0]?.name ?? '', maxUses: '' });
            setOpen(true);
          }}
        >
          + New signing link
        </Button>
      </div>
      {forms.length > 0 && (
        <ul className="mt-4 divide-y divide-gray-100 text-sm">
          {forms.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {f.name} {!f.active && <span className="text-xs font-normal text-gray-400">(paused)</span>}
                </div>
                <div className="truncate text-xs text-gray-500">
                  {f.templateName} · {f.uses}
                  {f.maxUses ? ` / ${f.maxUses}` : ''} signed up
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => copy(f.slug)}>
                {copied === f.slug ? 'Copied' : 'Copy link'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => api(`/forms/${f.id}`, { method: 'PATCH', json: { active: !f.active } }).then(load)}>
                {f.active ? 'Pause' : 'Resume'}
              </Button>
              <button
                className="text-xs text-gray-400 hover:text-red-600"
                onClick={async () => {
                  if (!confirm(`Delete the link "${f.name}"? People with the link will no longer be able to sign.`)) return;
                  await api(`/forms/${f.id}`, { method: 'DELETE' });
                  load();
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="New signing link">
        <div className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <div>
            <Label htmlFor="sl-template">Template</Label>
            <Select id="sl-template" value={draft.templateId} onChange={(e) => setDraft((d) => ({ ...d, templateId: e.target.value }))}>
              {eligible.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="sl-name">Link name</Label>
            <Input id="sl-name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="sl-max" hint="(optional)">
              Maximum signers
            </Label>
            <Input id="sl-max" type="number" min={1} value={draft.maxUses} onChange={(e) => setDraft((d) => ({ ...d, maxUses: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create} disabled={!draft.templateId || !draft.name.trim()}>
              Create link
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
