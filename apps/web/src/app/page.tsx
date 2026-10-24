import Link from 'next/link';
import { Logo } from '@/components/ui';

const FEATURES = [
  { title: 'Compliance engine', body: 'Every envelope gets the right signature level, consent wording, retention and data region for its country and document type.' },
  { title: 'Court-grade evidence', body: 'Hash-chained audit trail, certificate of completion and a PAdES seal with trusted timestamp on every completed document.' },
  { title: 'Verified signers', body: 'One-time passcodes today; ID checks, national eIDs and qualified signatures plug in through adapters.' },
  { title: 'API-first', body: 'The web app uses the same REST API and webhooks you do. Create API keys and endpoints in Settings.' },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-brand-50">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Logo className="text-lg text-gray-900" />
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/verify" className="rounded-md px-3 py-2 text-gray-600 hover:text-gray-900">
            Verify a document
          </Link>
          <Link href="/login" className="rounded-md px-3 py-2 text-gray-600 hover:text-gray-900">
            Sign in
          </Link>
          <Link href="/register" className="rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700">
            Get started
          </Link>
        </nav>
      </header>
      <section className="mx-auto max-w-4xl px-6 pb-16 pt-16 text-center sm:pt-24">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">Sign agreements in every market, compliant by design</h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-gray-600">
          Upload a document, place fields, send it to signers and get a sealed, verifiable PDF with a full audit trail.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/register" className="rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow hover:bg-brand-700">
            Create a free account
          </Link>
          <Link href="/verify" className="rounded-lg border border-gray-300 bg-white px-5 py-3 text-sm font-semibold text-gray-800 hover:bg-gray-50">
            Verify a signed PDF
          </Link>
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-24 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="font-semibold text-gray-900">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">{f.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
