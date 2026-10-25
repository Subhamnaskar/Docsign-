'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Alert, Button, Card, cx, EmptyState, Input, Label, Modal, PageLoader, Select, StatusBadge, Textarea } from '@/components/ui';
import { api, ApiError, fileUrl } from '@/lib/api';
import { formatDate, relativeTime } from '@/lib/format';
import type { EnvelopeStatus } from '@/lib/types';

interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  jobTitle: string | null;
  locale: string;
  notes: string | null;
  tags: string[];
  source: 'auto' | 'manual' | 'import';
  lastSentAt: string | null;
  agreements?: number;
}
interface ContactDetail extends Omit<Contact, 'agreements'> {
  agreements: { id: string; title: string; status: EnvelopeStatus; sentAt: string | null; completedAt: string | null; role: string; recipientStatus: string }[];
}

const LANGUAGES = [
  ['en', 'English'],
  ['hi', 'Hindi'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['pt', 'Portuguese'],
  ['it', 'Italian'],
  ['nl', 'Dutch'],
  ['ar', 'Arabic'],
  ['ja', 'Japanese'],
];

export default function ContactsPage() {
  return (
    <AppShell wide>
      <Contacts />
    </AppShell>
  );
}

function Contacts() {
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [data, setData] = useState<{ total: number; tags: string[]; contacts: Contact[] } | null>(null);
  const [editing, setEditing] = useState<Contact | 'new' | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(() => {
    const qs = new URLSearchParams({ ...(q && { q }), ...(tag && { tag }) });
    return api<typeof data>(`/contacts?${qs}`).then(setData);
  }, [q, tag]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new')) setEditing('new');
  }, []);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Contacts</h1>
          <p className="text-sm text-gray-500">People you send agreements to. Everyone you send to is added automatically.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={fileUrl('/contacts.csv')} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50">
            Export CSV
          </a>
          <Button variant="secondary" onClick={() => setImporting(true)}>
            Import CSV
          </Button>
          <Button onClick={() => setEditing('new')}>+ Add contact</Button>
        </div>
      </div>
      {notice && (
        <div className="mt-4">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}

      <Card className="mt-6">
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 p-3">
          <div className="w-full sm:w-80">
            <Input placeholder="Search name, email or company" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {data && data.tags.length > 0 && (
            <div className="w-44">
              <Select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag">
                <option value="">All tags</option>
                {data.tags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {data && <span className="ml-auto text-sm text-gray-500">{data.total} contacts</span>}
        </div>
        {!data ? (
          <PageLoader />
        ) : data.contacts.length === 0 ? (
          <EmptyState title={q || tag ? 'No matching contacts' : 'No contacts yet'}>People appear here when you send them an agreement, or add them yourself.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-4 py-2 font-medium">Tags</th>
                  <th className="px-4 py-2 text-right font-medium">Agreements</th>
                  <th className="px-4 py-2 font-medium">Last sent</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.contacts.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <button onClick={() => setViewing(c.id)} className="flex items-center gap-3 text-left">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">
                          {c.name
                            .split(/\s+/)
                            .map((w) => w[0])
                            .join('')
                            .slice(0, 2)
                            .toUpperCase()}
                        </span>
                        <span>
                          <span className="block font-medium text-ink hover:underline">{c.name}</span>
                          <span className="block text-xs text-gray-500">{c.email}</span>
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {c.company ?? '—'}
                      {c.jobTitle && <span className="block text-xs text-gray-400">{c.jobTitle}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {c.tags.map((t) => (
                          <span key={t} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                            {t}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{c.agreements ?? 0}</td>
                    <td className="px-4 py-3 text-gray-600">{c.lastSentAt ? relativeTime(c.lastSentAt) : 'Never'}</td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <ContactForm
          contact={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(text) => {
            setEditing(null);
            setNotice({ tone: 'success', text });
            load();
          }}
        />
      )}
      {viewing && <ContactPanel id={viewing} onClose={() => setViewing(null)} onEdit={(c) => (setViewing(null), setEditing(c))} />}
      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onDone={(text, tone) => {
            setImporting(false);
            setNotice({ tone, text });
            load();
          }}
        />
      )}
    </>
  );
}

function ContactForm({ contact, onClose, onSaved }: { contact: Contact | null; onClose: () => void; onSaved: (text: string) => void }) {
  const [form, setForm] = useState({
    name: contact?.name ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    company: contact?.company ?? '',
    jobTitle: contact?.jobTitle ?? '',
    locale: contact?.locale ?? 'en',
    notes: contact?.notes ?? '',
    tags: (contact?.tags ?? []).join(', '),
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const json = {
      ...form,
      phone: form.phone || null,
      company: form.company || null,
      jobTitle: form.jobTitle || null,
      notes: form.notes || null,
      tags: form.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    };
    try {
      await api(contact ? `/contacts/${contact.id}` : '/contacts', { method: contact ? 'PATCH' : 'POST', json });
      onSaved(contact ? 'Contact saved.' : `${form.name} was added.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the contact.');
      setBusy(false);
    }
  }

  async function remove() {
    if (!contact || !window.confirm(`Delete ${contact.name} from your contacts? Their agreements are not affected.`)) return;
    await api(`/contacts/${contact.id}`, { method: 'DELETE' });
    onSaved(`${contact.name} was deleted.`);
  }

  return (
    <Modal open onClose={onClose} title={contact ? 'Edit contact' : 'Add contact'}>
      <form onSubmit={save} className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="c-name">Name</Label>
            <Input id="c-name" required value={form.name} onChange={set('name')} />
          </div>
          <div>
            <Label htmlFor="c-email">Email</Label>
            <Input id="c-email" type="email" required value={form.email} onChange={set('email')} />
          </div>
          <div>
            <Label htmlFor="c-phone" hint="optional">
              Phone
            </Label>
            <Input id="c-phone" value={form.phone} onChange={set('phone')} />
          </div>
          <div>
            <Label htmlFor="c-locale">Language</Label>
            <Select id="c-locale" value={form.locale} onChange={set('locale')}>
              {LANGUAGES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="c-company" hint="optional">
              Company
            </Label>
            <Input id="c-company" value={form.company} onChange={set('company')} />
          </div>
          <div>
            <Label htmlFor="c-title" hint="optional">
              Job title
            </Label>
            <Input id="c-title" value={form.jobTitle} onChange={set('jobTitle')} />
          </div>
        </div>
        <div>
          <Label htmlFor="c-tags" hint="comma-separated">
            Tags
          </Label>
          <Input id="c-tags" value={form.tags} onChange={set('tags')} placeholder="supplier, vip" />
        </div>
        <div>
          <Label htmlFor="c-notes" hint="optional">
            Notes
          </Label>
          <Textarea id="c-notes" rows={2} value={form.notes} onChange={set('notes')} />
        </div>
        <div className="flex justify-between gap-2 pt-2">
          {contact ? (
            <Button type="button" variant="ghost" className="text-red-700" onClick={remove}>
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Save
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function ContactPanel({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (c: Contact) => void }) {
  const [c, setC] = useState<ContactDetail | null>(null);
  useEffect(() => {
    api<ContactDetail>(`/contacts/${id}`).then(setC);
  }, [id]);
  return (
    <Modal open onClose={onClose} title={c?.name ?? 'Contact'} wide>
      {!c ? (
        <PageLoader />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-gray-500">Email</dt>
              <dd>{c.email}</dd>
              {c.phone && (
                <>
                  <dt className="text-gray-500">Phone</dt>
                  <dd>{c.phone}</dd>
                </>
              )}
              {c.company && (
                <>
                  <dt className="text-gray-500">Company</dt>
                  <dd>
                    {c.company}
                    {c.jobTitle ? ` · ${c.jobTitle}` : ''}
                  </dd>
                </>
              )}
              <dt className="text-gray-500">Language</dt>
              <dd>{LANGUAGES.find(([code]) => code === c.locale)?.[1] ?? c.locale}</dd>
              <dt className="text-gray-500">Added</dt>
              <dd>{c.source === 'auto' ? 'Automatically, from a sent agreement' : c.source === 'import' ? 'From a CSV import' : 'By hand'}</dd>
            </dl>
            <Button variant="secondary" size="sm" onClick={() => onEdit({ ...c, agreements: c.agreements.length })}>
              Edit
            </Button>
          </div>
          {c.notes && <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{c.notes}</p>}
          <div>
            <h3 className="text-sm font-semibold">Agreements ({c.agreements.length})</h3>
            <ul className="mt-2 divide-y divide-gray-100">
              {c.agreements.map((a) => (
                <li key={a.id}>
                  <Link href={`/envelopes/${a.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:bg-gray-50">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{a.title}</span>
                      <span className="block text-xs text-gray-500">
                        {a.role === 'SIGNER' ? 'Signer' : a.role.charAt(0) + a.role.slice(1).toLowerCase()} · {a.sentAt ? `sent ${formatDate(a.sentAt, false)}` : 'not sent'}
                      </span>
                    </span>
                    <StatusBadge status={a.status} />
                  </Link>
                </li>
              ))}
              {c.agreements.length === 0 && <li className="py-4 text-center text-sm text-gray-500">No agreements with this contact yet.</li>}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: (text: string, tone: 'success' | 'error') => void }) {
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ created: number; updated: number; problems: string[] }>('/contacts/import', { method: 'POST', json: { csv } });
      onDone(`Imported: ${r.created} new, ${r.updated} updated.${r.problems.length ? ` Skipped ${r.problems.length}: ${r.problems.slice(0, 3).join(' ')}` : ''}`, r.problems.length ? 'error' : 'success');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Import failed.');
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Import contacts">
      <p className="text-sm text-gray-600">
        A CSV file with a header row. Columns: <strong>name</strong>, <strong>email</strong> (required), phone, company, job title, language, tags (separate tags with ;). Existing contacts are updated.
      </p>
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      <label className={cx('mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-sm', csv ? 'border-brand-300 bg-brand-50/50' : 'border-gray-300 hover:bg-gray-50')}>
        {csv ? `${csv.split(/\r?\n/).filter(Boolean).length - 1} rows ready` : 'Choose a .csv file'}
        <input
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) f.text().then(setCsv);
          }}
        />
      </label>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!csv} loading={busy} onClick={run}>
          Import
        </Button>
      </div>
    </Modal>
  );
}
