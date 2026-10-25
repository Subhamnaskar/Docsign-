'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell, useMe } from '@/components/AppShell';
import { ActivityLog } from '@/components/settings/Activity';
import { BillingSettings } from '@/components/settings/Billing';
import { BrandingSettings } from '@/components/settings/Branding';
import { SsoSettings } from '@/components/settings/Sso';
import { Team } from '@/components/settings/Team';
import { Alert, Button, Card, cx, Input, Label, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, relativeTime } from '@/lib/format';
import type { Option } from '@/lib/types';

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface WebhookEndpoint {
  id: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  createdAt: string;
  deliveries: { id: string; event: string; status: string; attempts: number; responseCode: number | null; lastError: string | null; createdAt: string }[];
}

function Organization() {
  const me = useMe();
  const [jurisdictions, setJurisdictions] = useState<Option[]>([]);
  const [name, setName] = useState(me?.organization.name ?? '');
  const [jurisdiction, setJurisdiction] = useState(me?.organization.jurisdiction ?? 'US');
  const [saved, setSaved] = useState(false);
  const [origins, setOrigins] = useState((me?.organization.embedOrigins ?? []).join('\n'));
  const [aiEnabled, setAiEnabled] = useState(Boolean(me?.organization.aiEnabled));
  const [orgError, setOrgError] = useState<string | null>(null);

  useEffect(() => {
    api<{ jurisdictions: Option[] }>('/policy/options').then((o) => setJurisdictions(o.jurisdictions));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setOrgError(null);
    try {
      await api('/organization', {
        method: 'PATCH',
        json: { name, jurisdiction, aiEnabled, embedOrigins: origins.split('\n').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean) },
      });
    } catch (err) {
      setOrgError((err as Error).message);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <Card className="p-5">
      <h2 className="font-semibold">Organization</h2>
      <form onSubmit={save} className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="org-name">Name</Label>
          <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="org-j">Default jurisdiction</Label>
          <Select id="org-j" value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)}>
            {jurisdictions.map((j) => (
              <option key={j.code} value={j.code}>
                {j.name}
              </option>
            ))}
          </Select>
        </div>
        {me?.features?.ai && (
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="mt-0.5" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} />
            <span>
              Turn on AI features <span className="text-gray-500">(signer summaries, contract review, field detection, Q&amp;A). Document content is sent to Anthropic&apos;s Claude API for processing.</span>
            </span>
          </label>
        )}
        <div className="sm:col-span-2">
          <Label htmlFor="org-origins" hint="(one per line)">
            Allowed embed origins
          </Label>
          <Textarea id="org-origins" rows={2} placeholder="https://app.yourcompany.com" value={origins} onChange={(e) => setOrigins(e.target.value)} />
          <p className="mt-1 text-xs text-gray-500">Sites allowed to show embedded signing in an iframe and to receive signers back after signing.</p>
          {orgError && <p className="mt-1 text-sm text-red-600">{orgError}</p>}
        </div>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit">Save</Button>
          {saved && <span className="text-sm text-green-700">Saved</span>}
          <span className="ml-auto text-xs text-gray-400">
            Data region: <span className="font-medium uppercase">{me?.organization.dataRegion}</span>
          </span>
        </div>
      </form>
    </Card>
  );
}

function ApiKeys() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const load = useCallback(() => api<ApiKey[]>('/api-keys').then(setKeys), []);
  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const res = await api<{ key: string }>('/api-keys', { method: 'POST', json: { name } });
    setCreated(res.key);
    setName('');
    load();
  }

  return (
    <Card className="p-5">
      <h2 className="font-semibold">API keys</h2>
      <p className="mt-1 text-sm text-gray-500">
        Use <code className="rounded bg-gray-100 px-1">Authorization: Bearer &lt;key&gt;</code> with any endpoint under <code className="rounded bg-gray-100 px-1">/api/v1</code>.
      </p>
      {created && (
        <div className="mt-4">
          <Alert tone="success" title="Copy your key now. It won't be shown again.">
            <code className="mt-1 block break-all font-mono text-xs">{created}</code>
          </Alert>
        </div>
      )}
      <form onSubmit={create} className="mt-4 flex gap-2">
        <Input placeholder="Key name, e.g. CRM integration" value={name} onChange={(e) => setName(e.target.value)} required />
        <Button type="submit">Create key</Button>
      </form>
      {keys.length > 0 && (
        <ul className="mt-4 divide-y divide-gray-100 text-sm">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{k.name}</div>
                <div className="font-mono text-xs text-gray-400">
                  {k.prefix}… · created {formatDate(k.createdAt, false)} · {k.lastUsedAt ? `used ${relativeTime(k.lastUsedAt)}` : 'never used'}
                </div>
              </div>
              <button
                className="text-sm text-gray-400 hover:text-red-600"
                onClick={async () => {
                  if (!confirm(`Revoke "${k.name}"? Apps using it will stop working.`)) return;
                  await api(`/api-keys/${k.id}`, { method: 'DELETE' });
                  load();
                }}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Webhooks() {
  const [data, setData] = useState<{ events: string[]; endpoints: WebhookEndpoint[] } | null>(null);
  const [url, setUrl] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const load = useCallback(() => api<typeof data>('/webhooks').then(setData), []);
  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/webhooks', { method: 'POST', json: { url, events: selected } });
      setUrl('');
      setSelected([]);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="font-semibold">Webhooks</h2>
      <p className="mt-1 text-sm text-gray-500">
        Events are signed with HMAC-SHA256 in the <code className="rounded bg-gray-100 px-1">X-DocSign-Signature</code> header (
        <code className="rounded bg-gray-100 px-1">t=…,v1=…</code> over <code className="rounded bg-gray-100 px-1">t.body</code>) and retried with backoff.
      </p>
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      <form onSubmit={create} className="mt-4 space-y-3">
        <div className="flex gap-2">
          <Input type="url" placeholder="https://example.com/webhooks/docsign" value={url} onChange={(e) => setUrl(e.target.value)} required />
          <Button type="submit">Add endpoint</Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {data?.events.map((ev) => (
            <button
              type="button"
              key={ev}
              onClick={() => setSelected((s) => (s.includes(ev) ? s.filter((x) => x !== ev) : [...s, ev]))}
              className={cx('rounded-full px-2.5 py-1 font-mono text-xs', selected.includes(ev) ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}
            >
              {ev}
            </button>
          ))}
          <span className="self-center text-xs text-gray-400">{selected.length ? '' : 'No selection = all events'}</span>
        </div>
      </form>
      <ul className="mt-4 space-y-3">
        {data?.endpoints.map((ep) => (
          <li key={ep.id} className="rounded-lg border border-gray-200 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-medium">{ep.url}</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  const r = await api<{ ok: boolean; status?: number; error?: string }>(`/webhooks/${ep.id}/test`, { method: 'POST' });
                  setTestResult((t) => ({ ...t, [ep.id]: r.ok ? `OK (${r.status})` : `Failed: ${r.error ?? r.status}` }));
                }}
              >
                Send test
              </Button>
              <button
                className="text-gray-400 hover:text-red-600"
                onClick={async () => {
                  if (!confirm('Delete this endpoint?')) return;
                  await api(`/webhooks/${ep.id}`, { method: 'DELETE' });
                  load();
                }}
              >
                Delete
              </button>
            </div>
            {testResult[ep.id] && <div className="mt-1 text-xs text-gray-500">Test: {testResult[ep.id]}</div>}
            <div className="mt-1 font-mono text-xs text-gray-400">
              secret {ep.secret} · {ep.events.length ? ep.events.join(', ') : 'all events'}
            </div>
            {ep.deliveries.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs">
                {ep.deliveries.map((d) => (
                  <li key={d.id} className="flex gap-2">
                    <span className={cx('font-medium', d.status === 'DELIVERED' ? 'text-green-700' : d.status === 'FAILED' ? 'text-red-700' : 'text-amber-700')}>{d.status}</span>
                    <span className="font-mono">{d.event}</span>
                    <span className="text-gray-400">
                      {relativeTime(d.createdAt)} · {d.attempts} attempt{d.attempts === 1 ? '' : 's'}
                      {d.lastError && ` · ${d.lastError}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

const TABS = [
  { id: 'organization', label: 'Organization', admin: true },
  { id: 'team', label: 'Team', admin: false },
  { id: 'billing', label: 'Billing', admin: true },
  { id: 'branding', label: 'Branding', admin: true },
  { id: 'sso', label: 'Single sign-on', admin: true },
  { id: 'developers', label: 'API & webhooks', admin: true },
  { id: 'activity', label: 'Activity', admin: true },
] as const;

function Settings() {
  const me = useMe();
  const admin = me?.user?.role === 'OWNER' || me?.user?.role === 'ADMIN' || !me?.user;
  const tabs = TABS.filter((t) => admin || !t.admin);
  const [tab, setTab] = useState<string>(tabs[0].id);
  // Deep links such as /settings?tab=billing (checkout returns here)
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('tab');
    if (wanted && tabs.some((t) => t.id === wanted)) setTab(wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <h1 className="text-2xl font-semibold">Settings</h1>
      <div className="mt-4 flex flex-wrap gap-1 border-b border-gray-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cx(
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium',
              tab === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-800',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-6 space-y-6">
        {tab === 'organization' && <Organization />}
        {tab === 'team' && <Team />}
        {tab === 'billing' && <BillingSettings />}
        {tab === 'branding' && <BrandingSettings />}
        {tab === 'sso' && <SsoSettings />}
        {tab === 'developers' && (
          <>
            <ApiKeys />
            <Webhooks />
          </>
        )}
        {tab === 'activity' && <ActivityLog />}
      </div>
    </>
  );
}

export default function SettingsPage() {
  return (
    <AppShell>
      <Settings />
    </AppShell>
  );
}
