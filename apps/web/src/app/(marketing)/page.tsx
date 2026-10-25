import Link from 'next/link';
import { Check, CtaBand, GoldLink, OutlineLink, Section, SectionHeading } from '@/components/marketing/Site';
import { brand } from '@/lib/brand';

/** Illustrative product mock: a document with signer fields and a status panel. */
function ProductMock() {
  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none" aria-hidden>
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-tr from-brand-500/30 via-brand-300/10 to-transparent blur-2xl" />
      <div className="rounded-2xl border border-white/10 bg-white p-5 text-left shadow-2xl">
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
      <section className="bg-cream px-3 pb-6 pt-10 sm:px-6 sm:pt-12">
        <p className="mx-auto flex max-w-6xl items-center justify-center gap-3 text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-600 sm:text-xs">
          <span className="hidden h-px w-10 bg-brand-400 sm:block" /> {brand.name} · e-signatures for every market <span className="hidden h-px w-10 bg-brand-400 sm:block" />
        </p>
        <div className="relative mx-auto mt-6 max-w-6xl overflow-hidden rounded-[2rem] bg-night bg-dots shadow-2xl shadow-black/10">
          <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-brand-500/20 blur-3xl" aria-hidden />
          <div className="absolute -bottom-32 right-0 h-80 w-80 rounded-full bg-indigo-500/10 blur-3xl" aria-hidden />
          <span className="absolute left-5 top-5 h-6 w-6 rounded-tl-md border-l-2 border-t-2 border-white/30" aria-hidden />
          <span className="absolute right-5 top-5 h-6 w-6 rounded-tr-md border-r-2 border-t-2 border-white/30" aria-hidden />
          <span className="absolute bottom-5 left-5 h-6 w-6 rounded-bl-md border-b-2 border-l-2 border-white/30" aria-hidden />
          <span className="absolute bottom-5 right-5 h-6 w-6 rounded-br-md border-b-2 border-r-2 border-white/30" aria-hidden />
          <div className="relative grid items-center gap-14 px-6 py-14 sm:px-12 lg:grid-cols-[1.15fr_1fr] lg:py-20">
            <div>
              <h1 className="text-[2.6rem] font-black leading-[1.02] tracking-tight text-white sm:text-6xl lg:text-[4.2rem]">
                Sign agreements in every market, <span className="text-gold">compliant by design.</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-gray-300">{brand.description}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <GoldLink href="/register">Start free 14-day trial →</GoldLink>
                <OutlineLink href="/contact" dark>
                  Book a demo
                </OutlineLink>
              </div>
              <p className="mt-5 text-sm text-gray-400">
                No credit card required · Received a signed PDF?{' '}
                <Link href="/verify" className="font-semibold text-brand-300 hover:text-brand-200">
                  Verify it here
                </Link>
              </p>
            </div>
            <ProductMock />
          </div>
        </div>
        <ul className="mx-auto mt-6 flex max-w-6xl flex-wrap justify-center gap-2.5">
          {['IT Act 2000 · ESIGN · eIDAS', 'Aadhaar eSign & DSC', 'Tamper-evident audit trail', 'Made in India'].map((c) => (
            <li key={c} className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-xs font-medium text-gray-700">
              <svg className="h-3.5 w-3.5 text-emerald-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.7-9.3a1 1 0 0 0-1.4-1.4L9 10.6 7.7 9.3a1 1 0 0 0-1.4 1.4l2 2a1 1 0 0 0 1.4 0l4-4Z" clipRule="evenodd" />
              </svg>
              {c}
            </li>
          ))}
        </ul>
        <dl className="mx-auto mt-12 grid max-w-4xl grid-cols-2 gap-8 pb-6 text-center sm:grid-cols-4">
          {[
            ['4', 'Legal frameworks'],
            ['10', 'Signer languages'],
            ['PAdES', 'Long-term validation'],
            ['14 days', 'Free trial'],
          ].map(([v, l]) => (
            <div key={l}>
              <dt className="text-gold text-3xl font-black tracking-tight">{v}</dt>
              <dd className="mt-1 text-sm text-gray-500">{l}</dd>
            </div>
          ))}
        </dl>
      </section>

      <Section>
        <SectionHeading number="01" eyebrow="How it works" title="From upload to sealed PDF in three steps" center />
        <ol className="mt-14 grid gap-8 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative rounded-2xl border border-gray-200 bg-white p-7 transition hover:-translate-y-0.5 hover:shadow-lg">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gold text-sm font-black text-ink">{i + 1}</span>
              <h3 className="mt-5 text-lg font-bold text-ink">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{s.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section tone="muted">
        <SectionHeading number="02" eyebrow="Platform" title="Everything you need to sign with confidence" intro="Built for teams that need more than a signature box: evidence that holds up, compliance per country and an API to automate it." />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-gray-200 bg-white p-7 transition hover:-translate-y-0.5 hover:shadow-lg">
              <h3 className="font-bold text-ink">{f.title}</h3>
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
            <SectionHeading dark number="03" eyebrow="Compliance engine" title="One platform. The right rules for each country." intro="Choose the governing jurisdiction and document type. The policy engine applies the signature level, signer checks, consent text, retention and data region for you." />
            <ul className="mt-8 space-y-3 text-gray-300">
              <Check dark>ESIGN Act and UETA (US), Electronic Communications Act (UK), eIDAS (EU), IT Act 2000 (India)</Check>
              <Check dark>Automatic guardrails: wills, certain property deeds and other excluded documents are blocked</Check>
              <Check dark>New countries are added as configuration and partner adapters, not rebuilds</Check>
            </ul>
            <Link href="/compliance" className="mt-8 inline-block text-sm font-semibold text-brand-300 hover:text-brand-200">
              How compliance works →
            </Link>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 font-mono text-sm shadow-2xl">
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
                  <dd className={k === 'Result' ? 'text-emerald-400' : 'text-white'}>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </Section>

      <Section>
        <SectionHeading number="04" eyebrow="Who it's for" title="Built for teams where signatures carry weight" center />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {SEGMENTS.map((s) => (
            <div key={s.title} className="rounded-2xl border border-gray-200 bg-white p-7 transition hover:-translate-y-0.5 hover:shadow-lg">
              <h3 className="font-bold text-ink">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{s.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="muted">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading number="05" eyebrow="Developers" title="Send for signature with one API call" intro="Create envelopes from templates, track progress with signed webhooks and download sealed PDFs, all over a clean REST API." />
            <Link href="/developers" className="mt-8 inline-block rounded-full bg-ink px-6 py-3 text-sm font-bold text-white hover:bg-black">
              Read the API overview
            </Link>
          </div>
          <pre className="overflow-x-auto rounded-2xl bg-night p-6 text-xs leading-relaxed text-gray-200 sm:text-sm">
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
