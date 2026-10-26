'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Label, Logo, PageLoader, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { LANGUAGES } from '@/lib/i18n';

interface FormInfo {
  name: string;
  title: string;
  message: string | null;
  branding: { name: string; color: string | null; logoUrl: string | null };
  full: boolean;
}

/** Public self-serve signing link: the visitor enters their details and is taken to sign. */
export default function SigningFormPage() {
  const { slug } = useParams<{ slug: string }>()!;
  const router = useRouter();
  const [info, setInfo] = useState<FormInfo | null>(null);
  const [missing, setMissing] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', locale: 'en' });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<FormInfo>(`/f/${slug}`)
      .then(setInfo)
      .catch(() => setMissing(true));
  }, [slug]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { signPath } = await api<{ signPath: string }>(`/f/${slug}`, { method: 'POST', json: form });
      router.push(signPath);
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  if (missing) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="max-w-md p-8 text-center">
          <h1 className="text-lg font-semibold">This signing link is not available</h1>
          <p className="mt-2 text-sm text-gray-500">It may have been paused or removed.</p>
        </Card>
      </div>
    );
  }
  if (!info) return <PageLoader />;

  return (
    <div className="flex min-h-screen flex-col items-center px-4 py-12">
      <div className="mb-8">
        {info.branding.logoUrl ? <img src={info.branding.logoUrl} alt={info.branding.name} className="max-h-10" /> : <Logo className="text-xl text-gray-900" />}
      </div>
      <Card className="w-full max-w-md p-7">
        <p className="text-sm text-gray-500">{info.branding.name}</p>
        <h1 className="mt-1 text-xl font-semibold">{info.title}</h1>
        {info.message && <p className="mt-3 whitespace-pre-wrap text-sm text-gray-600">{info.message}</p>}
        {info.full ? (
          <div className="mt-6">
            <Alert tone="warning">This signing link has reached its limit.</Alert>
          </div>
        ) : (
          <form onSubmit={start} className="mt-6 space-y-4">
            {error && <Alert>{error}</Alert>}
            <div>
              <Label htmlFor="sf-name">Full name</Label>
              <Input id="sf-name" required autoComplete="name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="sf-email">Email</Label>
              <Input id="sf-email" type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              <p className="mt-1 text-xs text-gray-500">We will send a code to confirm it is you, and email you the signed copy.</p>
            </div>
            <div>
              <Label htmlFor="sf-lang">Language</Label>
              <Select id="sf-lang" value={form.locale} onChange={(e) => setForm((f) => ({ ...f, locale: e.target.value }))}>
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" className="w-full" loading={loading}>
              Continue to sign
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
