'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AuthCard } from '@/components/AuthCard';
import { Alert, Button, Input, Label } from '@/components/ui';
import { api } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api('/auth/password/forgot', { method: 'POST', json: { email } });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const back = (
    <Link href="/login" className="font-medium text-brand-600 hover:underline">
      Back to sign in
    </Link>
  );

  if (sent) {
    return (
      <AuthCard title="Check your email" subtitle={back}>
        <p className="text-sm text-gray-600">
          If an account exists for <strong>{email}</strong>, we have sent a link to choose a new password. It expires in 1 hour.
        </p>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Reset your password" subtitle={back}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <Button type="submit" className="w-full" loading={loading}>
          Send reset link
        </Button>
      </form>
    </AuthCard>
  );
}
