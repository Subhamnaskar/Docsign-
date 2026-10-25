'use client';

import { useCallback, useEffect, useState } from 'react';
import { useMe } from '@/components/AppShell';
import { Alert, Button, Card, Input, Label, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, relativeTime } from '@/lib/format';

interface TwoFactor {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesLeft: number;
  required: boolean;
  ssoOnly: boolean;
}

interface SessionRow {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

/** Readable device name from a user-agent string. */
function deviceName(ua: string | null) {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

export function SecuritySettings({ onTwoFactorChange }: { onTwoFactorChange?: () => void }) {
  const [tf, setTf] = useState<TwoFactor | null>(null);
  const load = useCallback(() => api<TwoFactor>('/auth/2fa').then(setTf), []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      {tf?.required && !tf.enabled && (
        <Alert tone="warning" title="Two-factor authentication required">
          Your organisation requires two-factor authentication. Set it up below to continue using the app.
        </Alert>
      )}
      {tf && !tf.ssoOnly && <ChangePassword />}
      {tf && (
        <TwoFactorCard
          tf={tf}
          onChange={async () => {
            await load();
            onTwoFactorChange?.();
          }}
        />
      )}
      <Sessions />
      <SupportAccess />
    </>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api('/auth/password/change', { method: 'POST', json: { currentPassword: current, newPassword: next } });
      setCurrent('');
      setNext('');
      setMsg({ tone: 'success', text: 'Password changed. Other devices have been signed out.' });
    } catch (err) {
      setMsg({ tone: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="font-semibold">Password</h2>
      {msg && (
        <div className="mt-3">
          <Alert tone={msg.tone}>{msg.text}</Alert>
        </div>
      )}
      <form onSubmit={save} className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <Label htmlFor="pw-current">Current password</Label>
          <Input id="pw-current" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="pw-new" hint="at least 10 characters">
            New password
          </Label>
          <Input id="pw-new" type="password" autoComplete="new-password" minLength={10} required value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
        <Button type="submit" variant="secondary" loading={busy}>
          Change password
        </Button>
      </form>
    </Card>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = codes.join('\n');
  return (
    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <h3 className="font-semibold text-amber-900">Save your recovery codes</h3>
      <p className="mt-1 text-sm text-amber-900">
        Each code signs you in once if you lose your phone. Store them somewhere safe, like a password manager. They won&apos;t be shown again.
      </p>
      <pre className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg bg-white p-3 font-mono text-sm sm:grid-cols-5">{codes.map((c) => <span key={c}>{c}</span>)}</pre>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(text)}>
          Copy
        </Button>
        <a
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(`DocSign recovery codes\n\n${text}\n`)}`}
          download="docsign-recovery-codes.txt"
          className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50"
        >
          Download
        </a>
        <Button size="sm" onClick={onDone}>
          I&apos;ve saved them
        </Button>
      </div>
    </div>
  );
}

function TwoFactorCard({ tf, onChange }: { tf: TwoFactor; onChange: () => Promise<void> }) {
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [mode, setMode] = useState<'idle' | 'disable' | 'regenerate'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (tf.ssoOnly) {
    return (
      <Card className="p-5">
        <h2 className="font-semibold">Two-factor authentication</h2>
        <p className="mt-1 text-sm text-gray-500">You sign in with single sign-on, so two-factor authentication is handled by your identity provider.</p>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Two-factor authentication</h2>
          <p className="mt-1 text-sm text-gray-500">
            {tf.enabled
              ? `On since ${new Date(tf.enabledAt!).toLocaleDateString()}. ${tf.recoveryCodesLeft} recovery code${tf.recoveryCodesLeft === 1 ? '' : 's'} left.`
              : 'Ask for a code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password) when you sign in.'}
          </p>
        </div>
        {!tf.enabled && !setup && (
          <Button onClick={() => run(async () => setSetup(await api('/auth/2fa/setup', { method: 'POST' })))} loading={busy}>
            Set up
          </Button>
        )}
        {tf.enabled && mode === 'idle' && !codes && (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setMode('regenerate')}>
              New recovery codes
            </Button>
            {!tf.required && (
              <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setMode('disable')}>
                Turn off
              </Button>
            )}
          </div>
        )}
      </div>
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}

      {setup && (
        <div className="mt-4 grid gap-5 sm:grid-cols-[200px_1fr]">
          {/* The SVG is generated by our API from the otpauth URI */}
          <div className="h-[200px] w-[200px] rounded-lg border border-gray-200 bg-white" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
          <div className="space-y-3 text-sm">
            <ol className="list-decimal space-y-1 pl-5 text-gray-700">
              <li>Scan the QR code with your authenticator app.</li>
              <li>
                Can&apos;t scan? Enter this key: <code className="break-all rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs">{setup.secret}</code>
              </li>
              <li>Enter the 6-digit code the app shows.</li>
            </ol>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  const res = await api<{ recoveryCodes: string[] }>('/auth/2fa/enable', { method: 'POST', json: { code } });
                  setCodes(res.recoveryCodes);
                  setSetup(null);
                  setCode('');
                  await onChange();
                });
              }}
            >
              <div className="w-36">
                <Label htmlFor="tf-code">Code</Label>
                <Input id="tf-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="font-mono tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} required />
              </div>
              <Button type="submit" loading={busy}>
                Turn on
              </Button>
              <Button type="button" variant="ghost" onClick={() => setSetup(null)}>
                Cancel
              </Button>
            </form>
          </div>
        </div>
      )}

      {mode !== 'idle' && (
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              if (mode === 'disable') {
                await api('/auth/2fa/disable', { method: 'POST', json: { password, code } });
              } else {
                setCodes((await api<{ recoveryCodes: string[] }>('/auth/2fa/recovery-codes', { method: 'POST', json: { code } })).recoveryCodes);
              }
              setMode('idle');
              setPassword('');
              setCode('');
              await onChange();
            });
          }}
        >
          {mode === 'disable' && (
            <div className="w-56">
              <Label htmlFor="tf-pw">Password</Label>
              <Input id="tf-pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          )}
          <div className="w-40">
            <Label htmlFor="tf-confirm">Authentication code</Label>
            <Input id="tf-confirm" autoComplete="one-time-code" className="font-mono" required value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <Button type="submit" variant={mode === 'disable' ? 'danger' : 'primary'} loading={busy}>
            {mode === 'disable' ? 'Turn off two-factor' : 'Create new codes'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setMode('idle')}>
            Cancel
          </Button>
        </form>
      )}

      {codes && <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />}
    </Card>
  );
}

function Sessions() {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const load = useCallback(() => api<SessionRow[]>('/auth/sessions').then(setRows), []);
  useEffect(() => {
    load();
  }, [load]);
  const others = rows.filter((r) => !r.current).length;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Signed-in devices</h2>
          <p className="mt-1 text-sm text-gray-500">Sign out anywhere you don&apos;t recognise.</p>
        </div>
        {others > 0 && (
          <Button size="sm" variant="secondary" onClick={() => api('/auth/sessions/revoke-others', { method: 'POST' }).then(load)}>
            Sign out other devices
          </Button>
        )}
      </div>
      <ul className="mt-4 divide-y divide-gray-100">
        {rows.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
            <div>
              <div className="font-medium text-gray-900">
                {deviceName(s.userAgent)}
                {s.current && <span className="ml-2 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">This device</span>}
              </div>
              <div className="text-xs text-gray-500">
                {s.ip ?? 'Unknown IP'} · signed in {relativeTime(s.createdAt)} · last active {relativeTime(s.lastSeenAt)}
              </div>
            </div>
            {!s.current && (
              <Button size="sm" variant="ghost" className="text-red-600" onClick={() => api(`/auth/sessions/${s.id}`, { method: 'DELETE' }).then(load)}>
                Sign out
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

interface SupportAccessState {
  until: string | null;
  sessions: { by: string; viewingAs: string; until: string }[];
}

/** Owners and admins let NuronixAI support look at the account (read-only) for a limited time. */
function SupportAccess() {
  const me = useMe();
  const admin = me?.user?.role === 'OWNER' || me?.user?.role === 'ADMIN';
  const [state, setState] = useState<SupportAccessState | null>(null);
  const [hours, setHours] = useState(72);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<SupportAccessState>('/organization/support-access').then(setState), []);
  useEffect(() => {
    if (admin && !me?.support) load();
  }, [admin, me?.support, load]);
  if (!admin || !state) return null;

  async function change(method: 'POST' | 'DELETE') {
    setBusy(true);
    try {
      await api('/organization/support-access', method === 'POST' ? { method, json: { hours } } : { method });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="font-semibold">NuronixAI support access</h2>
      <p className="mt-1 text-sm text-gray-500">
        Let our support team look at your account to help with a problem. They see what your users see, including agreements, but cannot change anything. Every visit is recorded in your activity
        log and emailed to your admins.
      </p>
      {state.until ? (
        <div className="mt-4 space-y-3">
          <Alert tone="info">Support access is on until {formatDate(state.until)}.</Alert>
          {state.sessions.map((s) => (
            <p key={s.by + s.until} className="text-sm text-gray-700">
              <strong>{s.by}</strong> is viewing as {s.viewingAs} until {formatDate(s.until)}.
            </p>
          ))}
          <Button variant="secondary" disabled={busy} onClick={() => change('DELETE')}>
            Turn off support access
          </Button>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Label htmlFor="support-hours">Allow for</Label>
            <Select id="support-hours" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
              <option value={24}>24 hours</option>
              <option value={72}>3 days</option>
              <option value={168}>7 days</option>
            </Select>
          </div>
          <Button disabled={busy} onClick={() => change('POST')}>
            Allow support access
          </Button>
        </div>
      )}
    </Card>
  );
}
