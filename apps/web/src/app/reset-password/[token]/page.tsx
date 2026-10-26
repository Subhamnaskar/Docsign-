'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { AuthCard } from '@/components/AuthCard';
import { Alert, Button, Input, Label } from '@/components/ui';
import { api } from '@/lib/api';

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>()!;
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError('The passwords do not match.');
    setLoading(true);
    setError(null);
    try {
      await api('/auth/password/reset', { method: 'POST', json: { token, password } });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <AuthCard title="Password changed">
        <p className="text-sm text-gray-600">You have been signed out on every device. Sign in with your new password.</p>
        <Link href="/login" className="mt-5 block rounded-lg bg-gold px-4 py-2.5 text-center text-sm font-bold text-ink hover:brightness-105">
          Sign in
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div>
          <Label htmlFor="password" hint="at least 10 characters">
            New password
          </Label>
          <Input id="password" type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="confirm">Confirm password</Label>
          <Input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <Button type="submit" className="w-full" loading={loading}>
          Change password
        </Button>
      </form>
    </AuthCard>
  );
}
