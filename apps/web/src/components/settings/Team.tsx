'use client';

import { useCallback, useEffect, useState } from 'react';
import { useMe } from '@/components/AppShell';
import { Alert, Button, Card, cx, Input, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface TeamUser {
  id: string;
  name: string;
  email: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  disabledAt: string | null;
  createdAt: string;
}
interface Invite {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
}

const ROLE_HELP: Record<string, string> = {
  OWNER: 'Full control, including other owners',
  ADMIN: 'Sees all agreements; manages members, keys, webhooks and settings',
  MEMBER: 'Sends and sees their own agreements; uses shared templates',
};

export function Team() {
  const me = useMe();
  const [data, setData] = useState<{ users: TeamUser[]; invitations: Invite[] } | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('MEMBER');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(() => api<typeof data>('/team').then(setData), []);
  useEffect(() => {
    load();
  }, [load]);

  const myRole = me?.user?.role;
  const canManage = myRole === 'OWNER' || myRole === 'ADMIN';

  async function run(fn: () => Promise<unknown>, done?: string) {
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="font-semibold">Team</h2>
      <p className="mt-1 text-sm text-gray-500">Members see the agreements they send. Admins and owners see everything in the organisation.</p>
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
      {canManage && (
        <form
          className="mt-4 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api('/team/invitations', { method: 'POST', json: { email, role } });
              setEmail('');
            }, `Invitation sent to ${email}.`);
          }}
        >
          <Input className="min-w-[220px] flex-1" type="email" required placeholder="colleague@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Select className="w-36" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
            <option value="MEMBER">Member</option>
            <option value="ADMIN">Admin</option>
            {myRole === 'OWNER' && <option value="OWNER">Owner</option>}
          </Select>
          <Button type="submit">Invite</Button>
        </form>
      )}
      <ul className="mt-4 divide-y divide-gray-100 text-sm">
        {data?.users.map((u) => {
          const self = u.id === me?.user?.id;
          const editable = canManage && !self && (myRole === 'OWNER' || u.role === 'MEMBER');
          return (
            <li key={u.id} className={cx('flex flex-wrap items-center gap-3 py-3', u.disabledAt && 'opacity-50')}>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">{u.name.charAt(0).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {u.name} {self && <span className="text-xs font-normal text-gray-400">(you)</span>}
                  {u.disabledAt && <span className="ml-1 text-xs font-normal text-red-600">deactivated</span>}
                </div>
                <div className="truncate text-xs text-gray-500">{u.email}</div>
              </div>
              {editable ? (
                <Select
                  className="w-32"
                  aria-label={`Role for ${u.name}`}
                  value={u.role}
                  title={ROLE_HELP[u.role]}
                  onChange={(e) => run(() => api(`/team/users/${u.id}`, { method: 'PATCH', json: { role: e.target.value } }))}
                >
                  <option value="MEMBER">Member</option>
                  {myRole === 'OWNER' && <option value="ADMIN">Admin</option>}
                  {myRole === 'OWNER' && <option value="OWNER">Owner</option>}
                </Select>
              ) : (
                <span className="w-32 text-xs font-medium text-gray-500" title={ROLE_HELP[u.role]}>
                  {u.role.charAt(0) + u.role.slice(1).toLowerCase()}
                </span>
              )}
              {editable && (
                <Button
                  size="sm"
                  variant="ghost"
                  className={u.disabledAt ? '' : 'text-red-600'}
                  onClick={() => {
                    if (!u.disabledAt && !confirm(`Deactivate ${u.name}? They will be signed out. Their agreements stay with the organisation.`)) return;
                    run(() => api(`/team/users/${u.id}`, { method: 'PATCH', json: { active: Boolean(u.disabledAt) } }));
                  }}
                >
                  {u.disabledAt ? 'Reactivate' : 'Deactivate'}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {data && data.invitations.length > 0 && (
        <>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-400">Pending invitations</h3>
          <ul className="mt-2 divide-y divide-gray-100 text-sm">
            {data.invitations.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1 truncate">{i.email}</span>
                <span className="text-xs text-gray-500">
                  {i.role.toLowerCase()} · expires {formatDate(i.expiresAt, false)}
                </span>
                {canManage && (
                  <button className="text-xs text-gray-400 hover:text-red-600" onClick={() => run(() => api(`/team/invitations/${i.id}`, { method: 'DELETE' }))}>
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
