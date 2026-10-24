'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Label, Select } from '@/components/ui';
import { api } from '@/lib/api';

interface SsoConfig {
  issuer: string | null;
  clientId: string | null;
  hasClientSecret: boolean;
  domains: string[];
  enforced: boolean;
  defaultRole: 'ADMIN' | 'MEMBER';
  redirectUri: string;
  scimEnabled: boolean;
  scimBaseUrl: string;
}

const PRESETS = [
  { label: 'Google Workspace', issuer: 'https://accounts.google.com' },
  { label: 'Microsoft Entra ID', issuer: 'https://login.microsoftonline.com/<tenant-id>/v2.0' },
  { label: 'Okta', issuer: 'https://<your-domain>.okta.com' },
];

/** OpenID Connect single sign-on and SCIM provisioning settings. */
export function SsoSettings() {
  const [cfg, setCfg] = useState<SsoConfig | null>(null);
  const [form, setForm] = useState({ issuer: '', clientId: '', clientSecret: '', domains: '', enforced: false, defaultRole: 'MEMBER' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [scimToken, setScimToken] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const c = await api<SsoConfig>('/organization/sso');
    setCfg(c);
    setForm({ issuer: c.issuer ?? '', clientId: c.clientId ?? '', clientSecret: '', domains: c.domains.join(', '), enforced: c.enforced, defaultRole: c.defaultRole });
  }
  useEffect(() => {
    load();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api('/organization/sso', {
        method: 'PUT',
        json: {
          issuer: form.issuer.trim(),
          clientId: form.clientId.trim(),
          ...(form.clientSecret ? { clientSecret: form.clientSecret } : {}),
          domains: form.domains.split(/[\s,]+/).filter(Boolean),
          enforced: form.enforced,
          defaultRole: form.defaultRole,
        },
      });
      setNotice('Single sign-on saved. People with these email domains can now use "Sign in with SSO".');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!cfg) return null;
  return (
    <>
      <Card className="p-5">
        <h2 className="font-semibold">Single sign-on (OpenID Connect)</h2>
        <p className="mt-1 text-sm text-gray-500">Works with Google Workspace, Microsoft Entra ID, Okta and other OIDC providers. New users are created on first sign-in.</p>
        <div className="mt-4 rounded-lg bg-gray-50 p-3 text-sm">
          <span className="text-gray-500">Redirect URI to register with your provider: </span>
          <code className="break-all font-mono text-xs">{cfg.redirectUri}</code>
        </div>
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
        <form onSubmit={save} className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="sso-issuer">Issuer URL</Label>
            <Input id="sso-issuer" required placeholder="https://accounts.google.com" value={form.issuer} onChange={(e) => setForm((f) => ({ ...f, issuer: e.target.value }))} />
            <div className="mt-1 flex flex-wrap gap-2 text-xs">
              {PRESETS.map((p) => (
                <button key={p.label} type="button" className="text-brand-600 hover:underline" onClick={() => setForm((f) => ({ ...f, issuer: p.issuer }))}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor="sso-client">Client ID</Label>
            <Input id="sso-client" required value={form.clientId} onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="sso-secret" hint={cfg.hasClientSecret ? '(leave blank to keep)' : undefined}>
              Client secret
            </Label>
            <Input id="sso-secret" type="password" autoComplete="off" value={form.clientSecret} onChange={(e) => setForm((f) => ({ ...f, clientSecret: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="sso-domains">Email domains</Label>
            <Input id="sso-domains" required placeholder="example.com, example.in" value={form.domains} onChange={(e) => setForm((f) => ({ ...f, domains: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="sso-role">Role for new users</Label>
            <Select id="sso-role" value={form.defaultRole} onChange={(e) => setForm((f) => ({ ...f, defaultRole: e.target.value }))}>
              <option value="MEMBER">Member</option>
              <option value="ADMIN">Admin</option>
            </Select>
          </div>
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="mt-0.5" checked={form.enforced} onChange={(e) => setForm((f) => ({ ...f, enforced: e.target.checked }))} />
            <span>
              Require single sign-on <span className="text-gray-500">(turns off password sign-in for these domains; owners keep a password fallback)</span>
            </span>
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" loading={saving}>
              Save
            </Button>
            {cfg.issuer && (
              <Button
                type="button"
                variant="ghost"
                className="text-red-600"
                onClick={async () => {
                  if (!confirm('Turn off single sign-on? Users will need passwords to sign in.')) return;
                  await api('/organization/sso', { method: 'DELETE' });
                  await load();
                }}
              >
                Turn off SSO
              </Button>
            )}
          </div>
        </form>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold">User provisioning (SCIM 2.0)</h2>
        <p className="mt-1 text-sm text-gray-500">Let your identity provider create and deactivate users automatically.</p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-gray-500">Base URL</dt>
          <dd className="break-all font-mono text-xs">{cfg.scimBaseUrl}</dd>
          <dt className="text-gray-500">Status</dt>
          <dd>{cfg.scimEnabled ? 'Enabled' : 'Off'}</dd>
        </dl>
        {scimToken && (
          <div className="mt-3">
            <Alert tone="success" title="Copy this token now. It won't be shown again.">
              <code className="block break-all font-mono text-xs">{scimToken}</code>
            </Alert>
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <Button
            variant="secondary"
            onClick={async () => {
              if (cfg.scimEnabled && !confirm('Generate a new token? The current one stops working.')) return;
              setScimToken((await api<{ token: string }>('/organization/scim-token', { method: 'POST' })).token);
              await load();
            }}
          >
            {cfg.scimEnabled ? 'Rotate token' : 'Generate token'}
          </Button>
          {cfg.scimEnabled && (
            <Button
              variant="ghost"
              className="text-red-600"
              onClick={async () => {
                await api('/organization/scim-token', { method: 'DELETE' });
                setScimToken(null);
                await load();
              }}
            >
              Turn off
            </Button>
          )}
        </div>
      </Card>
    </>
  );
}
