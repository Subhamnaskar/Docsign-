'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell, useMe } from '@/components/AppShell';
import { ActivityLog } from '@/components/settings/Activity';
import { BillingSettings } from '@/components/settings/Billing';
import { BrandingSettings } from '@/components/settings/Branding';
import { IntegrationsSettings } from '@/components/settings/Integrations';
import { SecuritySettings } from '@/components/settings/Security';
import { SsoSettings } from '@/components/settings/Sso';
import { Team } from '@/components/settings/Team';
import { Alert, Button, Card, cx, Input, Label, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, relativeTime } from '@/lib/format';
import type { Option } from '@/lib/types';
import { DepartmentsSettings } from '@/components/settings/Departments';
import { GovernanceSettings } from '@/components/settings/Governance';
import { APP_LANGUAGES, type AppKey, useAppT } from '@/lib/appI18n';

interface ApiKey {
  id: string;
  name: string;
  mode?: 'live' | 'test';
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface WebhookEndpoint {
  id: string;
  url: string;
  secret: string;
  events: string[];
  format?: string;
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
  const [require2fa, setRequire2fa] = useState(Boolean(me?.organization.require2fa));
  const [approvalPolicy, setApprovalPolicy] = useState(me?.organization.approvalPolicy ?? 'off');
  const [approverIds, setApproverIds] = useState<string[]>(me?.organization.approverIds ?? []);
  const [people, setPeople] = useState<{ id: string; name: string; email: string; role: string; disabledAt: string | null }[]>([]);
  useEffect(() => {
    if (approvalPolicy !== 'off') api<{ users: typeof people }>('/team').then((t) => setPeople(t.users.filter((u) => !u.disabledAt))).catch(() => {});
  }, [approvalPolicy]);
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
        json: { name, jurisdiction, aiEnabled, require2fa, approvalPolicy, approverIds, embedOrigins: origins.split('\n').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean) },
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
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="mt-0.5" checked={require2fa} onChange={(e) => setRequire2fa(e.target.checked)} />
          <span>
            Require two-factor authentication <span className="text-gray-500">for everyone who signs in with a password. Single sign-on users rely on your identity provider.</span>
          </span>
        </label>
        <div className="sm:col-span-2">
          <Label htmlFor="org-approval">Approval before sending</Label>
          <Select id="org-approval" value={approvalPolicy} onChange={(e) => setApprovalPolicy(e.target.value as typeof approvalPolicy)}>
            <option value="off">Off: agreements are sent straight away</option>
            <option value="members">Agreements sent by members need approval</option>
            <option value="all">Every agreement needs approval</option>
          </Select>
          {approvalPolicy !== 'off' && (
            <div className="mt-2">
              <p className="text-xs text-gray-500">Approvers (none selected = any owner or admin). Approvers&apos; own agreements are not held.</p>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {people.map((u) => (
                  <label key={u.id} className="flex items-center gap-1.5">
                    <input type="checkbox" checked={approverIds.includes(u.id)} onChange={(e) => setApproverIds(e.target.checked ? [...approverIds, u.id] : approverIds.filter((x) => x !== u.id))} />
                    {u.name} <span className="text-gray-400">({u.role.toLowerCase()})</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
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
  const [mode, setMode] = useState<'live' | 'test'>('test');
  const [keyError, setKeyError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const load = useCallback(() => api<ApiKey[]>('/api-keys').then(setKeys), []);
  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setKeyError(null);
    try {
      const res = await api<{ key: string }>('/api-keys', { method: 'POST', json: { name, mode } });
      setCreated(res.key);
      setName('');
      load();
    } catch (err) {
      setKeyError((err as Error).message);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="font-semibold">API keys</h2>
      <p className="mt-1 text-sm text-gray-500">
        Use <code className="rounded bg-gray-100 px-1">Authorization: Bearer &lt;key&gt;</code> with any endpoint under <code className="rounded bg-gray-100 px-1">/api/v1</code>.
        Test keys create watermarked agreements that aren&apos;t billed and work on every plan. See the{' '}
        <a className="text-brand-700 hover:underline" href="/api/v1/openapi.json">OpenAPI spec</a> and the Node and Python SDKs.
      </p>
      {keyError && (
        <div className="mt-3">
          <Alert>{keyError}</Alert>
        </div>
      )}
      {created && (
        <div className="mt-4">
          <Alert tone="success" title="Copy your key now. It won't be shown again.">
            <code className="mt-1 block break-all font-mono text-xs">{created}</code>
          </Alert>
        </div>
      )}
      <form onSubmit={create} className="mt-4 flex gap-2">
        <Input placeholder="Key name, e.g. CRM integration" value={name} onChange={(e) => setName(e.target.value)} required />
        <Select value={mode} onChange={(e) => setMode(e.target.value as 'live' | 'test')} aria-label="Key type" className="w-36">
          <option value="test">Test key</option>
          <option value="live">Live key</option>
        </Select>
        <Button type="submit">Create key</Button>
      </form>
      {keys.length > 0 && (
        <ul className="mt-4 divide-y divide-gray-100 text-sm">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {k.name}
                  {k.mode === 'test' && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">Test</span>}
                </div>
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
        {data?.endpoints.filter((ep) => !ep.format || ep.format === 'json').map((ep) => (
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
  { id: 'organization', label: 'tab.organization' as AppKey, admin: true },
  { id: 'security', label: 'tab.security' as AppKey, admin: false },
  { id: 'team', label: 'tab.team' as AppKey, admin: false },
  { id: 'billing', label: 'tab.billing' as AppKey, admin: true },
  { id: 'branding', label: 'tab.branding' as AppKey, admin: true },
  { id: 'sso', label: 'tab.sso' as AppKey, admin: true },
  { id: 'departments', label: 'tab.departments' as AppKey, admin: true },
  { id: 'integrations', label: 'tab.integrations' as AppKey, admin: true },
  { id: 'governance', label: 'tab.governance' as AppKey, admin: true },
  { id: 'developers', label: 'tab.developers' as AppKey, admin: true },
  { id: 'activity', label: 'tab.activity' as AppKey, admin: true },
] as const;

function Settings() {
  const me = useMe();
  const tr = useAppT();
  const t = tr;
  const admin = me?.user?.role === 'OWNER' || me?.user?.role === 'ADMIN' || !me?.user;
  const tabs = TABS.filter((t) => admin || !t.admin);
  const [tab, setTab] = useState<string>(me?.user?.mfaSetupRequired ? 'security' : tabs[0].id);
  // Deep links such as /settings?tab=billing (checkout returns here)
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('tab');
    if (wanted && tabs.some((t) => t.id === wanted)) setTab(wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <h1 className="text-2xl font-semibold">{t('settings.title')}</h1>
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
            {tr(t.label)}
          </button>
        ))}
      </div>
      <div className="mt-6 space-y-6">
        {tab === 'organization' && <Organization />}
        {tab === 'security' && <ProfileCard />}
        {tab === 'security' && (
          <SecuritySettings
            onTwoFactorChange={() => {
              // Required setup finished: reload so the rest of the app unlocks
              if (me?.user?.mfaSetupRequired) window.location.assign('/dashboard');
            }}
          />
        )}
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
        {tab === 'departments' && <DepartmentsSettings />}
        {tab === 'integrations' && <IntegrationsSettings />}
        {tab === 'governance' && <GovernanceSettings />}
        {tab === 'activity' && <ActivityLog />}
      </div>
    </>
  );
}

/** Name and app language for the signed-in user. */
function ProfileCard() {
  const me = useMe();
  const t = useAppT();
  const [name, setName] = useState(me?.user?.name ?? '');
  const [locale, setLocale] = useState(me?.user?.locale ?? 'en');
  const [error, setError] = useState<string | null>(null);
  if (!me?.user) return null;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/auth/profile', { method: 'PATCH', json: { name, locale } });
      // The whole app switches language
      window.location.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <Card className="p-5">
      <h2 className="font-semibold">{t('profile.title')}</h2>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      <form onSubmit={save} className="mt-4 grid gap-3 sm:grid-cols-[1fr_220px_auto] sm:items-end">
        <div>
          <Label htmlFor="pf-name">{t('profile.name')}</Label>
          <Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="pf-lang">{t('profile.language')}</Label>
          <Select id="pf-lang" value={locale} onChange={(e) => setLocale(e.target.value)}>
            {APP_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="secondary">{t('common.save')}</Button>
      </form>
      <p className="mt-2 text-xs text-gray-500">{t('profile.languageHint')}</p>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <AppShell>
      <Settings />
    </AppShell>
  );
}
