import Link from 'next/link';
import { Check, CtaBand, Section, SectionHeading } from '@/components/marketing/Site';
import { brand } from '@/lib/brand';

/** Illustrative product mock: a document with signer fields and a status panel. */
function ProductMock() {
  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none" aria-hidden>
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-tr from-brand-100 via-white to-cyan-50 blur-2xl" />
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-900">Mutual NDA</div>
          <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">Out for signature</span>
        </div>
        <div className="mt-4 space-y-2">
          {[100, 92, 96, 70].map((w, i) => (
            <div key={i} className="h-2 rounded bg-gray-100" style={{ width: `${w}%` }} />
          ))}
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <div className="rounded-lg border-2 border-brand-500 bg-brand-50 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-brand-700">Signed · Priya S.</div>
            <svg viewBox="0 0 120 32" className="mt-1 h-8 w-full text-[#111c59]">
              <path d="M4 24c10-2 14-18 22-18s2 16 10 16 8-10 14-10 4 8 10 8 10-6 16-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </div>
          <div className="rounded-lg border-2 border-dashed border-amber-400 bg-amber-50 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-800">Sign here · Daniel M.</div>
            <div className="mt-2 h-6 rounded bg-amber-100/80" />
          </div>
        </div>
        <div className="mt-5 space-y-2 border-t border-gray-100 pt-4 text-xs">
          {[
            ['✓', 'Identity verified (email OTP)', 'text-green-600'],
            ['✓', 'Consent recorded · India, IT Act 2000', 'text-green-600'],
            ['•', 'Seal + timestamp applied on completion', 'text-gray-400'],
          ].map(([icon, text, color]) => (
            <div key={text} className="flex items-center gap-2 text-gray-600">
              <span className={`font-bold ${color}`}>{icon}</span>
              {text}
            </div>
          ))}
        </div>
      </div>
      <div className="absolute -bottom-8 -right-4 hidden rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-lg sm:block">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Audit trail</div>
        <div className="mt-1 flex items-center gap-1.5 text-xs font-medium text-green-700">
          <span className="h-2 w-2 rounded-full bg-green-500" /> Hash chain intact · 21 events
        </div>
      </div>
    </div>
  );
}

const STEPS = [
  { title: 'Upload and prepare', body: 'Upload a PDF or Word file, add signers, and drag signature, date and text fields onto the page, or start from a template.' },
  { title: 'Signers verify and sign', body: 'Each signer gets a personal link, verifies with a one-time code, agrees to sign electronically and signs on any device.' },
  { title: 'Sealed and verifiable', body: 'The completed PDF is sealed with a digital signature and trusted timestamp, stored write-once, and verifiable by anyone.' },
];

const FEATURES = [
  { title: 'Compliance engine', body: 'Picks the right signature level, consent wording, retention and data region for each country and document type, and blocks documents that cannot be e-signed.' },
  { title: 'Court-grade evidence', body: 'Every action goes into a tamper-evident, hash-chained audit trail, summarised in a sealed certificate of completion.' },
  { title: 'Templates and bulk send', body: 'Save layouts as templates with roles like "Employee", then send one agreement or hundreds from a CSV.' },
  { title: 'Signer languages', body: 'Emails and the signing page in English, Hindi, Spanish, French, German, Portuguese, Italian, Dutch, Arabic and Japanese.' },
  { title: 'API-first', body: 'Our own app runs on the same REST API you get, with API keys and signed webhooks for CRM, HR and banking systems.' },
  { title: 'Malware-scanned uploads', body: 'Every uploaded file is scanned before it enters the system. Signature images are re-encoded to block malformed files.' },
];

const SEGMENTS = [
  { title: 'Banking & lending', body: 'Loan agreements, account opening and KYC, with a path to Aadhaar eSign and qualified signatures.' },
  { title: 'HR & legal', body: 'Offer letters, NDAs and vendor contracts with templates, bulk send and a full audit trail.' },
  { title: 'Real estate', body: 'Leases and sale agreements, with guardrails for documents that need notarisation.' },
  { title: 'Software vendors', body: 'Embed signing in your product through the API and webhooks, with usage-based pricing.' },
];

export default function Home() {
  return (
    <>
      <section className="overflow-hidden bg-gradient-to-b from-brand-50/80 via-white to-white">
        <div className="mx-auto grid max-w-6xl items-center gap-16 px-4 pb-20 pt-16 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:pt-24">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-brand-100 bg-white px-3 py-1 text-xs font-medium text-brand-700">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" /> US · UK · EU · India compliance profiles
            </p>
            <h1 className="mt-6 text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
              Sign agreements in every market, <span className="text-brand-600">compliant by design</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-gray-600">{brand.description}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/register" className="rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow hover:bg-brand-700">
                Start free
              </Link>
              <Link href="/contact" className="rounded-lg border border-gray-300 bg-white px-5 py-3 text-sm font-semibold text-gray-800 hover:bg-gray-50">
                Book a demo
              </Link>
            </div>
            <p className="mt-4 text-sm text-gray-500">
              Received a signed PDF?{' '}
              <Link href="/verify" className="font-medium text-brand-600 hover:underline">
                Verify it here
              </Link>
              .
            </p>
          </div>
          <ProductMock />
        </div>
      </section>

      <Section>
        <SectionHeading eyebrow="How it works" title="From upload to sealed PDF in three steps" center />
        <ol className="mt-14 grid gap-8 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative rounded-2xl border border-gray-200 p-6">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{i + 1}</span>
              <h3 className="mt-4 text-lg font-semibold text-gray-900">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{s.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section tone="muted">
        <SectionHeading eyebrow="Platform" title="Everything you need to sign with confidence" intro="Built for teams that need more than a signature box: evidence that holds up, compliance per country and an API to automate it." />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="font-semibold text-gray-900">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{f.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-8">
          <Link href="/product" className="text-sm font-semibold text-brand-600 hover:underline">
            See all features →
          </Link>
        </div>
      </Section>

      <Section tone="dark">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading dark eyebrow="Compliance engine" title="One platform. The right rules for each country." intro="Choose the governing jurisdiction and document type. The policy engine applies the signature level, signer checks, consent text, retention and data region for you." />
            <ul className="mt-8 space-y-3 text-gray-300">
              <Check dark>ESIGN Act and UETA (US), Electronic Communications Act (UK), eIDAS (EU), IT Act 2000 (India)</Check>
              <Check dark>Automatic guardrails: wills, certain property deeds and other excluded documents are blocked</Check>
              <Check dark>New countries are added as configuration and partner adapters, not rebuilds</Check>
            </ul>
            <Link href="/compliance" className="mt-8 inline-block text-sm font-semibold text-brand-100 hover:text-white">
              How compliance works →
            </Link>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 font-mono text-sm">
            <div className="text-xs uppercase tracking-wide text-gray-400">Policy decision</div>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5">
              {[
                ['Jurisdiction', 'India'],
                ['Document', 'Employment offer'],
                ['Signature level', 'Simple (SES)'],
                ['Signer check', 'Email one-time passcode'],
                ['Seal', 'PAdES + RFC 3161 timestamp'],
                ['Retention', '8 years, write-once'],
                ['Data region', 'in'],
                ['Result', '✓ Allowed'],
              ].map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-gray-400">{k}</dt>
                  <dd className={k === 'Result' ? 'text-green-400' : 'text-white'}>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </Section>

      <Section>
        <SectionHeading eyebrow="Who it's for" title="Built for teams where signatures carry weight" center />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {SEGMENTS.map((s) => (
            <div key={s.title} className="rounded-2xl border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{s.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="muted">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading eyebrow="Developers" title="Send for signature with one API call" intro="Create envelopes from templates, track progress with signed webhooks and download sealed PDFs, all over a clean REST API." />
            <Link href="/developers" className="mt-8 inline-block rounded-lg bg-gray-900 px-5 py-3 text-sm font-semibold text-white hover:bg-gray-800">
              Read the API overview
            </Link>
          </div>
          <pre className="overflow-x-auto rounded-2xl bg-gray-950 p-6 text-xs leading-relaxed text-gray-200 sm:text-sm">
            <code>{`curl https://${brand.domain}/api/v1/templates/$TEMPLATE/envelopes \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "send": true,
    "recipients": [{
      "roleId": "$EMPLOYEE_ROLE",
      "name": "Priya Sharma",
      "email": "priya@example.com",
      "locale": "hi"
    }]
  }'`}</code>
          </pre>
        </div>
      </Section>

      <CtaBand />
    </>
  );
}
