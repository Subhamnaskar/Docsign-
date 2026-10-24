'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import type { Envelope, Template } from '@/lib/types';
import { Alert, Button, Input, Label, Modal, Textarea } from './ui';

/** Saves an envelope's documents, recipients (as named roles) and field layout as a template. */
export function SaveTemplateModal({ env, open, onClose }: { env: Envelope; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(env.title);
  const [description, setDescription] = useState('');
  const [roleNames, setRoleNames] = useState<Record<string, string>>(() => {
    let s = 0;
    let c = 0;
    return Object.fromEntries(env.recipients.map((r) => [r.id, r.role === 'SIGNER' ? `Signer ${++s}` : `Copy ${++c}`]));
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api<Template>(`/envelopes/${env.id}/save-as-template`, {
        method: 'POST',
        json: { name, description: description || null, roleNames },
      });
      router.push('/templates');
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Save as template" wide>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div>
          <Label htmlFor="tpl-name">Template name</Label>
          <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </div>
        <div>
          <Label htmlFor="tpl-desc" hint="(optional)">
            Description
          </Label>
          <Textarea id="tpl-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        </div>
        {env.recipients.length > 0 && (
          <div>
            <Label>Role names</Label>
            <p className="mb-2 text-xs text-gray-500">
              Recipients become placeholder roles, e.g. &quot;Employee&quot; or &quot;Manager&quot;. You choose real people each time you use the template.
            </p>
            <div className="space-y-2">
              {env.recipients.map((r) => (
                <div key={r.id} className="flex items-center gap-3">
                  <span className="w-40 truncate text-sm text-gray-500" title={r.email}>
                    {r.name} {r.role === 'CC' && '(CC)'}
                  </span>
                  <Input value={roleNames[r.id] ?? ''} maxLength={60} onChange={(e) => setRoleNames((n) => ({ ...n, [r.id]: e.target.value }))} />
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} disabled={!name.trim() || Object.values(roleNames).some((n) => !n.trim())}>
            Save template
          </Button>
        </div>
      </div>
    </Modal>
  );
}
