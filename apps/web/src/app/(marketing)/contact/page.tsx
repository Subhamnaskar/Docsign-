'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Check } from '@/components/marketing/Site';
import { Alert, Button, Input, Label, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { brand } from '@/lib/brand';

const INTERESTS = [
  { value: 'demo', label: 'A product demo' },
  { value: 'pricing', label: 'Pricing for my team' },
  { value: 'api', label: 'API / embedded signing' },
  { value: 'partnership', label: 'A partnership' },
  { value: 'other', label: 'Something else' },
];

function ContactForm() {
  const params = useSearchParams()!;
  const initial = params.get('interest');
  const [form, setForm] = useState({
    name: '',
    email: '',
    company: '',
    role: '',
    country: '',
    interest: INTERESTS.some((i) => i.value === initial) ? initial! : 'demo',
    message: '',
    website: '',
  });
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setError(null);
    try {
      const { role, country, message, ...rest } = form;
      await api('/leads', {
        method: 'POST',
        json: { ...rest, ...(role && { role }), ...(country && { country }), ...(message && { message }) },
      });
      setStatus('sent');
    } catch (err) {
      setError((err as Error).message);
      setStatus('idle');
    }
  }

  if (status === 'sent') {
    return (
      <div className="rounded-2xl border border-green-200 bg-green-50 p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-xl text-green-700">✓</div>
        <h2 className="mt-4 text-lg font-semibold text-gray-900">Thanks, {form.name.split(' ')[0]}!</h2>
        <p className="mt-2 text-sm text-gray-600">We have your request and will reply to {form.email} shortly.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="c-name">Full name</Label>
          <Input id="c-name" required autoComplete="name" value={form.name} onChange={set('name')} />
        </div>
        <div>
          <Label htmlFor="c-email">Work email</Label>
          <Input id="c-email" type="email" required autoComplete="email" value={form.email} onChange={set('email')} />
        </div>
        <div>
          <Label htmlFor="c-company">Company</Label>
          <Input id="c-company" required autoComplete="organization" value={form.company} onChange={set('company')} />
        </div>
        <div>
          <Label htmlFor="c-role" hint="(optional)">
            Job title
          </Label>
          <Input id="c-role" autoComplete="organization-title" value={form.role} onChange={set('role')} />
        </div>
        <div>
          <Label htmlFor="c-country" hint="(optional)">
            Country
          </Label>
          <Input id="c-country" autoComplete="country-name" value={form.country} onChange={set('country')} />
        </div>
        <div>
          <Label htmlFor="c-interest">I&apos;m interested in</Label>
          <Select id="c-interest" value={form.interest} onChange={set('interest')}>
            {INTERESTS.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="c-message" hint="(optional)">
          What would you like to sign? Which countries?
        </Label>
        <Textarea id="c-message" rows={4} maxLength={3000} value={form.message} onChange={set('message')} />
      </div>
      {/* Honeypot: hidden from people, tempting for bots */}
      <div className="hidden" aria-hidden>
        <label>
          Website <input tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} />
        </label>
      </div>
      <Button type="submit" className="w-full" loading={status === 'sending'}>
        Send request
      </Button>
      <p className="text-xs text-gray-500">We use your details only to respond to this request.</p>
    </form>
  );
}

export default function ContactPage() {
  return (
    <section className="bg-cream">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">Contact</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight text-gray-900">Book a demo</h1>
          <p className="mt-5 text-lg text-gray-600">See how {brand.name} handles your documents and jurisdictions. We usually reply within one business day.</p>
          <ul className="mt-8 space-y-3 text-gray-700">
            <Check>A walkthrough on your own document types</Check>
            <Check>How the compliance engine treats your countries</Check>
            <Check>API and integration options</Check>
          </ul>
          <p className="mt-10 text-sm text-gray-500">
            Prefer email?{' '}
            <a href={`mailto:${brand.salesEmail}`} className="font-medium text-brand-600 hover:underline">
              {brand.salesEmail}
            </a>
          </p>
        </div>
        <Suspense>
          <ContactForm />
        </Suspense>
      </div>
    </section>
  );
}
