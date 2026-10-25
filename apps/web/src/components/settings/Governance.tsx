'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Label, Textarea } from '@/components/ui';
import { api } from '@/lib/api';

interface DnsRecord {
  type: string;
  name: string;
  value: string | null;
  note?: string;
}

interface Gov {
  retentionDays: number | null;
  purgeIncompleteDays: number | null;
  ipAllowlist: string[];
  yourIp: string;
  email: { fromName: string | null; replyTo: string | null; domain: string | null; verified: boolean; dns: DnsRecord[] };
  customDomain: { domain: string | null; verified: boolean; dns: DnsRecord[] };
  storageKmsKeyId: string | null;
}

function useAction(reload: () => Promise<unknown>) {
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  async function run(name: string, fn: () => Promise<unknown>, success: string) {
    setBusy(name);
    setMsg(null);
    try {
      await fn();
      await reload();
      setMsg({ tone: 'success', text: success });
    } catch (err) {
      setMsg({ tone: 'error', text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }
  return { msg, busy, run };
}

function Records({ records }: { records: DnsRecord[] }) {
  if (!records.length) return null;
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full min-w-[520px] text-left text-xs">
        <thead className="bg-gray-50 text-gray-500">
          <tr>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 font-mono">
          {records.map((r) => (
            <tr key={`${r.type}-${r.name}`} className="align-top">
              <td className="px-3 py-2">{r.type}</td>
              <td className="break-all px-3 py-2">{r.name}</td>
              <td className="break-all px-3 py-2">
                {r.value}
                {r.note && <div className="mt-1 font-sans text-gray-500">{r.note}</div>}
                {r.value && (
                  <button className="mt-1 block font-sans font-medium text-brand-700 hover:underline" onClick={() => navigator.clipboard?.writeText(r.value!)}>
                    Copy
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Data retention, network access, email sender, signing domain, encryption key and exports. */
export function GovernanceSettings() {
  const [gov, setGov] = useState<Gov | null>(null);
  const load = useCallback(() => api<Gov>('/governance').then(setGov), []);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);
  if (!gov) return null;
  return (
    <>
      <Retention gov={gov} reload={load} />
      <IpAllowlist gov={gov} reload={load} />
      <EmailSender gov={gov} reload={load} />
      <SigningDomain gov={gov} reload={load} />
      <Encryption gov={gov} reload={load} />
      <Exports />
    </>
  );
}

function Retention({ gov, reload }: { gov: Gov; reload: () => Promise<unknown> }) {
  const [days, setDays] = useState(gov.retentionDays ? String(gov.retentionDays) : '');
  const [incomplete, setIncomplete] = useState(gov.purgeIncompleteDays ? String(gov.purgeIncompleteDays) : '');
  const { msg, busy, run } = useAction(reload);
  return (
    <Card className="p-5">
      <h2 className="font-semibold">Data retention</h2>
      <p className="mt-1 text-sm text-gray-500">
        Delete agreements automatically. Signed agreements are never deleted before the legal retention period of their jurisdiction, and never while on legal hold. Each deletion is recorded in the activity log.
      </p>
      {msg && <div className="mt-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <Label htmlFor="ret-days" hint="(days after completion, blank = keep)">Completed agreements</Label>
          <Input id="ret-days" type="number" min={30} value={days} onChange={(e) => setDays(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ret-inc" hint="(days, blank = keep)">Drafts, voided, declined, expired</Label>
          <Input id="ret-inc" type="number" min={7} value={incomplete} onChange={(e) => setIncomplete(e.target.value)} />
        </div>
        <Button
          variant="secondary"
          loading={busy === 'ret'}
          onClick={() =>
            run('ret', () => api('/governance/retention', { method: 'PUT', json: { retentionDays: days ? Number(days) : null, purgeIncompleteDays: incomplete ? Number(incomplete) : null } }), 'Retention saved.')
          }
        >
          Save
        </Button>
      </div>
    </Card>
  );
}

function IpAllowlist({ gov, reload }: { gov: Gov; reload: () => Promise<unknown> }) {
  const [text, setText] = useState(gov.ipAllowlist.join('\n'));
  const { msg, busy, run } = useAction(reload);
  return (
    <Card className="p-5">
      <h2 className="font-semibold">IP allowlist</h2>
      <p className="mt-1 text-sm text-gray-500">
        Only these addresses can use the app and the API. Signers are not restricted. Your current address is <code className="rounded bg-gray-100 px-1">{gov.yourIp}</code>.
      </p>
      {msg && <div className="mt-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <Textarea className="mt-3 font-mono" rows={3} placeholder={'203.0.113.0/24\n2001:db8::/32'} value={text} onChange={(e) => setText(e.target.value)} aria-label="Allowed addresses" />
      <div className="mt-2 flex gap-2">
        <Button
          variant="secondary"
          loading={busy === 'ip'}
          onClick={() => run('ip', () => api('/governance/ip-allowlist', { method: 'PUT', json: { cidrs: text.split('\n').map((l) => l.trim()).filter(Boolean) } }), 'Allowlist saved.')}
        >
          Save
        </Button>
        {!text.split('\n').some((l) => l.trim() === gov.yourIp) && (
          <Button variant="ghost" onClick={() => setText((t) => [t.trim(), `${gov.yourIp}/32`].filter(Boolean).join('\n'))}>
            Add my address
          </Button>
        )}
      </div>
    </Card>
  );
}

function EmailSender({ gov, reload }: { gov: Gov; reload: () => Promise<unknown> }) {
  const [fromName, setFromName] = useState(gov.email.fromName ?? '');
  const [replyTo, setReplyTo] = useState(gov.email.replyTo ?? '');
  const [domain, setDomain] = useState(gov.email.domain ?? '');
  const { msg, busy, run } = useAction(reload);
  return (
    <Card className="p-5">
      <h2 className="font-semibold">Email sender</h2>
      <p className="mt-1 text-sm text-gray-500">
        Signers see your name on emails. With a verified domain, emails come from <code className="rounded bg-gray-100 px-1">no-reply@{gov.email.domain ?? 'your-domain'}</code> and are signed with DKIM.
      </p>
      {msg && <div className="mt-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="em-name">Sender name</Label>
          <Input id="em-name" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Acme Legal" />
        </div>
        <div>
          <Label htmlFor="em-reply">Reply-to address</Label>
          <Input id="em-reply" type="email" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="legal@example.com" />
        </div>
        <div>
          <Label htmlFor="em-domain">Sending domain</Label>
          <Input id="em-domain" value={domain} onChange={(e) => setDomain(e.target.value.toLowerCase())} placeholder="example.com" />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          loading={busy === 'save'}
          onClick={() => run('save', () => api('/governance/email', { method: 'PUT', json: { fromName: fromName.trim() || null, replyTo: replyTo.trim() || null, domain: domain.trim() || null } }), 'Saved.')}
        >
          Save
        </Button>
        {gov.email.domain && !gov.email.verified && (
          <Button loading={busy === 'verify'} onClick={() => run('verify', () => api('/governance/email/verify', { method: 'POST' }), 'Domain verified. Emails are now DKIM-signed.')}>
            Verify DNS
          </Button>
        )}
        {gov.email.domain && <span className={gov.email.verified ? 'text-sm text-green-700' : 'text-sm text-amber-700'}>{gov.email.verified ? '✓ Verified' : 'Not verified yet'}</span>}
      </div>
      {gov.email.domain && !gov.email.verified && <Records records={gov.email.dns} />}
    </Card>
  );
}

function SigningDomain({ gov, reload }: { gov: Gov; reload: () => Promise<unknown> }) {
  const [domain, setDomain] = useState(gov.customDomain.domain ?? '');
  const { msg, busy, run } = useAction(reload);
  return (
    <Card className="p-5">
      <h2 className="font-semibold">Signing domain</h2>
      <p className="mt-1 text-sm text-gray-500">Send signing links on your own domain, such as sign.example.com. Point it at this service, add the verification record, then verify.</p>
      {msg && <div className="mt-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="w-72">
          <Label htmlFor="cd">Domain</Label>
          <Input id="cd" value={domain} onChange={(e) => setDomain(e.target.value.toLowerCase())} placeholder="sign.example.com" />
        </div>
        <Button variant="secondary" loading={busy === 'save'} onClick={() => run('save', () => api('/governance/domain', { method: 'PUT', json: { domain: domain.trim() || null } }), 'Saved.')}>
          Save
        </Button>
        {gov.customDomain.domain && !gov.customDomain.verified && (
          <Button loading={busy === 'verify'} onClick={() => run('verify', () => api('/governance/domain/verify', { method: 'POST' }), 'Domain verified. New signing links use it.')}>
            Verify DNS
          </Button>
        )}
        {gov.customDomain.domain && <span className={gov.customDomain.verified ? 'self-center text-sm text-green-700' : 'self-center text-sm text-amber-700'}>{gov.customDomain.verified ? '✓ Verified' : 'Not verified yet'}</span>}
      </div>
      {gov.customDomain.domain && !gov.customDomain.verified && <Records records={gov.customDomain.dns} />}
    </Card>
  );
}

function Encryption({ gov, reload }: { gov: Gov; reload: () => Promise<unknown> }) {
  const [arn, setArn] = useState(gov.storageKmsKeyId ?? '');
  const { msg, busy, run } = useAction(reload);
  return (
    <Card className="p-5">
      <h2 className="font-semibold">Customer-managed encryption key</h2>
      <p className="mt-1 text-sm text-gray-500">
        Encrypt your documents at rest with a key in your own AWS KMS account. Grant this service <code className="rounded bg-gray-100 px-1">kms:GenerateDataKey</code> and <code className="rounded bg-gray-100 px-1">kms:Decrypt</code> on the key first. Applies to files stored from now on.
      </p>
      {msg && <div className="mt-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <Label htmlFor="kms">KMS key ARN</Label>
          <Input id="kms" className="font-mono" value={arn} onChange={(e) => setArn(e.target.value)} placeholder="arn:aws:kms:ap-south-1:123456789012:key/…" />
        </div>
        <Button variant="secondary" loading={busy === 'kms'} onClick={() => run('kms', () => api('/governance/kms', { method: 'PUT', json: { storageKmsKeyId: arn.trim() || null } }), 'Saved.')}>
          Save
        </Button>
      </div>
    </Card>
  );
}

function Exports() {
  const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  return (
    <Card className="p-5">
      <h2 className="font-semibold">Exports</h2>
      <p className="mt-1 text-sm text-gray-500">For audits, archives and security tools.</p>
      <ul className="mt-3 space-y-2 text-sm">
        <li>
          <a className="font-medium text-brand-700 hover:underline" href="/api/v1/activity/export.csv">Activity log (CSV)</a>
          <span className="text-gray-500"> · admin actions, sign-ins to settings, deletions</span>
        </li>
        <li>
          <a className="font-medium text-brand-700 hover:underline" href={`/api/v1/audit/export?from=${from}`}>Agreement events, last 30 days (JSON lines)</a>
          <span className="text-gray-500"> · every audit event with its hash, for SIEM tools</span>
        </li>
      </ul>
    </Card>
  );
}
