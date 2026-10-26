'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, cx, Input, Label } from '@/components/ui';
import { api } from '@/lib/api';
import type { CloudConfig } from '@/lib/cloudPickers';
import { relativeTime } from '@/lib/format';

interface Endpoint {
  id: string;
  url: string;
  format?: string;
  events: string[];
  createdAt: string;
  deliveries: { id: string; status: string; createdAt: string; lastError: string | null }[];
}

const EVENT_LABELS: Record<string, string> = {
  'envelope.sent': 'Sent',
  'recipient.viewed': 'Opened',
  'recipient.signed': 'Signed',
  'recipient.declined': 'Declined',
  'envelope.completed': 'Completed',
  'envelope.voided': 'Voided',
  'envelope.expired': 'Expired',
};
const DEFAULT_EVENTS = ['recipient.signed', 'recipient.declined', 'envelope.completed'];

const CHAT = {
  slack: {
    name: 'Slack',
    placeholder: 'https://hooks.slack.com/services/…',
    help: 'In Slack, add the "Incoming Webhooks" app to a channel and copy its webhook URL.',
  },
  teams: {
    name: 'Microsoft Teams',
    placeholder: 'https://….logic.azure.com/workflows/…',
    help: 'In the Teams channel, open Workflows → "Post to a channel when a webhook request is received" and copy the URL.',
  },
} as const;

/** Slack and Teams channel notifications, and which cloud storage pickers are available. */
export function IntegrationsSettings() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [cloud, setCloud] = useState<CloudConfig | null>(null);
  const load = useCallback(
    () => api<{ endpoints: Endpoint[] }>('/webhooks').then((d) => setEndpoints(d.endpoints.filter((e) => e.format === 'slack' || e.format === 'teams'))),
    [],
  );
  useEffect(() => {
    load();
    api<CloudConfig>('/integrations/config').then(setCloud).catch(() => {});
  }, [load]);

  return (
    <>
      {(['slack', 'teams'] as const).map((format) => (
        <ChatCard key={format} format={format} endpoints={endpoints.filter((e) => e.format === format)} onChange={load} />
      ))}
      <CrmCards />
      <Card className="p-5">
        <h2 className="font-semibold">Cloud storage</h2>
        <p className="mt-1 text-sm text-gray-500">Senders can pick documents straight from these services when preparing an agreement.</p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-3">
          {(
            [
              ['Google Drive', cloud?.google],
              ['Dropbox', cloud?.dropbox],
              ['OneDrive', cloud?.onedrive],
            ] as const
          ).map(([name, on]) => (
            <li key={name} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2.5 text-sm">
              <span className="font-medium">{name}</span>
              <span className={cx('rounded-full px-2 py-0.5 text-xs font-medium', on ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500')}>
                {on ? 'Available' : 'Not set up'}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-gray-500">
          Providers are enabled by your Nuronix eSign administrator with each service&apos;s app credentials. Share links from any of them can always be pasted when adding documents.
        </p>
      </Card>
    </>
  );
}

function ChatCard({ format, endpoints, onChange }: { format: 'slack' | 'teams'; endpoints: Endpoint[]; onChange: () => Promise<void> }) {
  const info = CHAT[format];
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(DEFAULT_EVENTS);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/notifications/chat', { method: 'POST', json: { format, url: url.trim(), events } });
      setUrl('');
      await onChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function test(id: string) {
    setNotice(null);
    setError(null);
    const res = await api<{ ok: boolean; status?: number; error?: string }>(`/webhooks/${id}/test`, { method: 'POST' });
    if (res.ok) setNotice(`Test message sent to ${info.name}.`);
    else setError(`${info.name} did not accept the test message (${res.error ?? `HTTP ${res.status}`}).`);
  }

  return (
    <Card className="p-5">
      <h2 className="font-semibold">{info.name}</h2>
      <p className="mt-1 text-sm text-gray-500">Post to a channel when agreements are signed, declined or completed. {info.help}</p>
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      {notice && (
        <div className="mt-3">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}
      {endpoints.length > 0 && (
        <ul className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-200">
          {endpoints.map((ep) => {
            const last = ep.deliveries[0];
            return (
              <li key={ep.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-mono text-xs text-gray-700">{ep.url.replace(/(.{40}).+/, '$1…')}</div>
                  <div className="text-xs text-gray-500">
                    {ep.events.length ? ep.events.map((e) => EVENT_LABELS[e] ?? e).join(', ') : 'All events'}
                    {last && ` · last ${last.status.toLowerCase()} ${relativeTime(last.createdAt)}`}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="secondary" onClick={() => test(ep.id)}>
                    Send test
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-600" onClick={() => api(`/webhooks/${ep.id}`, { method: 'DELETE' }).then(onChange)}>
                    Remove
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <form onSubmit={add} className="mt-4 space-y-3">
        <div>
          <Label htmlFor={`${format}-url`}>Webhook URL</Label>
          <Input id={`${format}-url`} type="url" placeholder={info.placeholder} value={url} onChange={(e) => setUrl(e.target.value)} required />
        </div>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-gray-700">Notify when an agreement is</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {Object.entries(EVENT_LABELS).map(([key, label]) => (
              <label key={key} className="flex items-center gap-1.5">
                <input type="checkbox" checked={events.includes(key)} onChange={(e) => setEvents(e.target.checked ? [...events, key] : events.filter((x) => x !== key))} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <Button type="submit" loading={busy} disabled={!url.trim() || events.length === 0}>
          Connect {info.name}
        </Button>
      </form>
    </Card>
  );
}

interface CrmState {
  salesforceAvailable: boolean;
  connections: { provider: 'hubspot' | 'salesforce'; accountLabel: string | null; settings: { attachPdf?: boolean }; lastSyncAt: string | null; lastError: string | null }[];
}

/** HubSpot (private app token) and Salesforce (OAuth) activity sync. */
function CrmCards() {
  const [state, setState] = useState<CrmState | null>(null);
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => api<CrmState>('/integrations/crm').then(setState), []);
  useEffect(() => {
    load().catch(() => {});
    const sf = new URLSearchParams(window.location.search).get('salesforce');
    if (sf === 'connected') setNotice('Salesforce connected.');
    else if (sf) setError(`Salesforce connection ${sf.replace(/_/g, ' ')}.`);
  }, [load]);
  if (!state) return null;
  const conn = (p: 'hubspot' | 'salesforce') => state.connections.find((c) => c.provider === p);

  async function run(name: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      await fn();
      await load();
      if (done) setNotice(done);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const status = (c: CrmState['connections'][number]) => (
    <div className="text-xs text-gray-500">
      Connected{c.accountLabel ? ` to ${c.accountLabel}` : ''}
      {c.lastSyncAt ? ` · last sync ${relativeTime(c.lastSyncAt)}` : ' · waiting for the first agreement event'}
      {c.lastError && <div className="mt-1 text-red-600">Last error: {c.lastError}</div>}
    </div>
  );
  const attachToggle = (p: 'hubspot' | 'salesforce', c: CrmState['connections'][number]) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={c.settings.attachPdf !== false} onChange={(e) => run(`att-${p}`, () => api(`/integrations/${p}`, { method: 'PATCH', json: { attachPdf: e.target.checked } }))} />
      Attach signed PDFs
    </label>
  );

  const hs = conn('hubspot');
  const sf = conn('salesforce');
  return (
    <Card className="p-5">
      <h2 className="font-semibold">CRM</h2>
      <p className="mt-1 text-sm text-gray-500">
        Log agreement activity (sent, signed, declined, completed) on the signer&apos;s contact, and on a linked deal or record when the agreement is created with its ID over the API.
      </p>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      {notice && <div className="mt-3"><Alert tone="success">{notice}</Alert></div>}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-gray-200 p-4">
          <div className="font-medium">HubSpot</div>
          {hs ? (
            <div className="mt-2 space-y-2">
              {status(hs)}
              {attachToggle('hubspot', hs)}
              <Button size="sm" variant="ghost" className="text-red-600" onClick={() => run('hs-del', () => api('/integrations/hubspot', { method: 'DELETE' }))}>Disconnect</Button>
            </div>
          ) : (
            <form
              className="mt-2 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                run('hs', () => api('/integrations/hubspot', { method: 'PUT', json: { token: token.trim() } }).then(() => setToken('')), 'HubSpot connected.');
              }}
            >
              <Label htmlFor="hs-token" hint="(private app with contacts, deals and files scopes)">Private app token</Label>
              <Input id="hs-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="pat-na1-…" />
              <Button size="sm" type="submit" loading={busy === 'hs'} disabled={token.trim().length < 20}>Connect HubSpot</Button>
            </form>
          )}
        </div>
        <div className="rounded-lg border border-gray-200 p-4">
          <div className="font-medium">Salesforce</div>
          {sf ? (
            <div className="mt-2 space-y-2">
              {status(sf)}
              {attachToggle('salesforce', sf)}
              <Button size="sm" variant="ghost" className="text-red-600" onClick={() => run('sf-del', () => api('/integrations/salesforce', { method: 'DELETE' }))}>Disconnect</Button>
            </div>
          ) : state.salesforceAvailable ? (
            <div className="mt-2">
              <p className="text-xs text-gray-500">You&apos;ll be asked to sign in to Salesforce and allow access.</p>
              <Button size="sm" className="mt-2" loading={busy === 'sf'} onClick={() => run('sf', async () => window.location.assign((await api<{ url: string }>('/integrations/salesforce/connect', { method: 'POST' })).url))}>
                Connect Salesforce
              </Button>
            </div>
          ) : (
            <p className="mt-2 text-xs text-gray-500">Not set up on this server yet (needs a Salesforce connected app).</p>
          )}
        </div>
      </div>
    </Card>
  );
}
