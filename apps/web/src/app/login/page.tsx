'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AuthCard } from '@/components/AuthCard';
import { Alert, Button, Input, Label } from '@/components/ui';
import { api } from '@/lib/api';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ssoMode, setSsoMode] = useState(false);
  const ssoError = params.get('sso');
  const SSO_MESSAGES: Record<string, string> = {
    expired: 'Your sign-in took too long. Please try again.',
    failed: 'Your identity provider did not complete the sign-in.',
    no_email: 'Your identity provider did not share a verified email address.',
    wrong_domain: 'That account is not part of an organisation that uses single sign-on here.',
    other_org: 'This email belongs to a different organisation.',
    deactivated: 'Your account has been deactivated. Contact your administrator.',
  };

  async function startSso(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { url } = await api<{ url: string }>('/auth/sso/start', { method: 'POST', json: { email, next: params.get('next') ?? undefined } });
      window.location.assign(url);
    } catch (err) {
      setError((err as Error).message.includes('not found') ? 'Single sign-on is not set up for this email domain.' : (err as Error).message);
      setLoading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api('/auth/login', { method: 'POST', json: { email, password } });
      const next = params.get('next');
      router.replace(next?.startsWith('/') ? next : '/dashboard');
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <AuthCard
      title="Sign in"
      subtitle={
        <>
          New here?{' '}
          <Link href="/register" className="font-medium text-brand-600 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={ssoMode ? startSso : submit} className="space-y-4">
        {ssoError && SSO_MESSAGES[ssoError] && <Alert>{SSO_MESSAGES[ssoError]}</Alert>}
        {error && <Alert>{error}</Alert>}
        <div>
          <Label htmlFor="email">{ssoMode ? 'Work email' : 'Email'}</Label>
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {!ssoMode && (
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        )}
        <Button type="submit" className="w-full" loading={loading}>
          {ssoMode ? 'Continue with SSO' : 'Sign in'}
        </Button>
        <button type="button" onClick={() => setSsoMode((m) => !m)} className="w-full text-sm text-gray-500 hover:text-gray-800">
          {ssoMode ? 'Sign in with a password instead' : 'Sign in with SSO'}
        </button>
      </form>
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
