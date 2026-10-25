'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api } from '@/lib/api';

interface Department {
  id: string;
  name: string;
  agreements: number;
  members: { userId: string; name: string; email: string; role: 'member' | 'manager' }[];
}

interface User {
  id: string;
  name: string;
  email: string;
  disabledAt: string | null;
}

/** Departments group people; managers see every agreement in their department. */
export function DepartmentsSettings() {
  const [list, setList] = useState<Department[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const [d, t] = await Promise.all([api<Department[]>('/departments'), api<{ users: User[] }>('/team')]);
    setList(d);
    setUsers(t.users.filter((u) => !u.disabledAt));
  }, []);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const saveMembers = (d: Department, members: Department['members']) =>
    run(() => api(`/departments/${d.id}/members`, { method: 'PUT', json: members.map((m) => ({ userId: m.userId, role: m.role })) }));

  return (
    <Card className="p-5">
      <h2 className="font-semibold">Departments</h2>
      <p className="mt-1 text-sm text-gray-500">
        Group people by team. Agreements and templates can belong to a department; its managers see all of the department&apos;s agreements, members see their own.
      </p>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) run(() => api('/departments', { method: 'POST', json: { name: name.trim() } }).then(() => setName('')));
        }}
      >
        <Input placeholder="New department, e.g. Sales" value={name} onChange={(e) => setName(e.target.value)} aria-label="Department name" />
        <Button type="submit" variant="secondary" disabled={!name.trim()}>Add</Button>
      </form>
      <ul className="mt-4 space-y-3">
        {list.map((d) => {
          const memberIds = new Set(d.members.map((m) => m.userId));
          return (
            <li key={d.id} className="rounded-lg border border-gray-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium">{d.name}</span>
                  <span className="text-sm text-gray-500"> · {d.members.length} people · {d.agreements} agreements</span>
                </div>
                <button className="text-sm text-gray-400 hover:text-red-600" onClick={() => confirm(`Delete ${d.name}? Its agreements stay, without a department.`) && run(() => api(`/departments/${d.id}`, { method: 'DELETE' }))}>
                  Delete
                </button>
              </div>
              <ul className="mt-2 divide-y divide-gray-100 text-sm">
                {d.members.map((m) => (
                  <li key={m.userId} className="flex flex-wrap items-center gap-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate">
                      {m.name} <span className="text-gray-400">{m.email}</span>
                    </span>
                    <Select
                      className="w-32"
                      value={m.role}
                      aria-label={`Role of ${m.name}`}
                      onChange={(e) => saveMembers(d, d.members.map((x) => (x.userId === m.userId ? { ...x, role: e.target.value as 'member' | 'manager' } : x)))}
                    >
                      <option value="member">Member</option>
                      <option value="manager">Manager</option>
                    </Select>
                    <button className="text-xs text-gray-400 hover:text-red-600" onClick={() => saveMembers(d, d.members.filter((x) => x.userId !== m.userId))}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <Select
                className="mt-2 w-64"
                value=""
                aria-label={`Add someone to ${d.name}`}
                onChange={(e) => {
                  const u = users.find((x) => x.id === e.target.value);
                  if (u) saveMembers(d, [...d.members, { userId: u.id, name: u.name, email: u.email, role: 'member' }]);
                }}
              >
                <option value="">+ Add a person…</option>
                {users.filter((u) => !memberIds.has(u.id)).map((u) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                ))}
              </Select>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
