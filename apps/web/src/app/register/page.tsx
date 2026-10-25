'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthCard } from '@/components/AuthCard';
import { Alert, Button, Input, Label, Select } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { APP_LANGUAGES, useStoredLocale } from '@/lib/appI18n';

const JURISDICTIONS = [
  { code: 'US', name: 'United States' },
  { code: 'UK', name: 'United Kingdom' },
  { code: 'EU', name: 'European Union' },
  { code: 'IN', name: 'India' },
];

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '', organizationName: '', jurisdiction: 'US' });
  const [locale, setLocale] = useStoredLocale();
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  // The website's "Get started" box passes the email along (?email=)
  useEffect(() => {
    const email = new URLSearchParams(window.location.search).get('email');
    if (email) setForm((f) => ({ ...f, email }));
  }, []);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setProblems([]);
    try {
      await api('/auth/register', { method: 'POST', json: { ...form, locale } });
      router.replace('/home');
    } catch (err) {
      setError((err as Error).message);
      if (err instanceof ApiError) setProblems(err.problems);
      setLoading(false);
    }
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle={
        <>
          Already have one?{' '}
          <Link href="/login" className="font-medium text-brand-600 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <Alert title={error}>
            {problems.length > 0 && (
              <ul className="list-disc pl-4">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </Alert>
        )}
        <div>
          <Label htmlFor="name">Your name</Label>
          <Input id="name" required autoComplete="name" value={form.name} onChange={set('name')} />
        </div>
        <div>
          <Label htmlFor="email">Work email</Label>
          <Input id="email" type="email" required autoComplete="email" value={form.email} onChange={set('email')} />
        </div>
        <div>
          <Label htmlFor="password" hint="(10+ characters)">
            Password
          </Label>
          <Input id="password" type="password" required minLength={10} autoComplete="new-password" value={form.password} onChange={set('password')} />
        </div>
        <div>
          <Label htmlFor="reg-lang">Language / भाषा</Label>
          <Select id="reg-lang" value={locale} onChange={(e) => setLocale(e.target.value)}>
            {APP_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="org">Organization</Label>
          <Input id="org" required value={form.organizationName} onChange={set('organizationName')} />
        </div>
        <div>
          <Label htmlFor="jurisdiction" hint="(default for new envelopes)">
            Primary jurisdiction
          </Label>
          <Select id="jurisdiction" value={form.jurisdiction} onChange={set('jurisdiction')}>
            {JURISDICTIONS.map((j) => (
              <option key={j.code} value={j.code}>
                {j.name}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" className="w-full" loading={loading}>
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}
