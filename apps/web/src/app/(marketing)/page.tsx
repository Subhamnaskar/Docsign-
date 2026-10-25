import Link from 'next/link';
import { HomeSolutions } from '@/components/marketing/HomeSolutions';
import { AiMock, CodeMock, WorkflowMock } from '@/components/marketing/Mocks';
import { CtaBand, GoldLink } from '@/components/marketing/Site';
import { brand } from '@/lib/brand';
import { SOLUTIONS } from '@/lib/solutions';

/** Tools the product connects to today (names only; no partner logos). */
const WORKS_WITH = ['Google Drive', 'Dropbox', 'OneDrive', 'Microsoft Word', 'Outlook', 'Google Docs', 'Salesforce', 'HubSpot', 'Slack', 'Microsoft Teams', 'Zapier'];

/** Facts about the product, not customer numbers. */
const FACTS = [
  { value: '4', label: 'legal frameworks built in', note: 'IT Act 2000 (India), ESIGN and UETA (US), Electronic Communications Act (UK), eIDAS (EU)' },
  { value: '10', label: 'signer languages', note: 'Including Hindi and right-to-left Arabic, chosen per signer' },
  { value: '100%', label: 'of signed PDFs sealed', note: 'PAdES digital seal, trusted timestamp and long-term validation data' },
  { value: 'SHA-256', label: 'hash-chained audit trail', note: 'Every event linked to the one before, so tampering shows' },
];

const STANDARDS = ['IT Act 2000', 'eIDAS', 'ESIGN & UETA', 'PAdES (ETSI EN 319 142)', 'RFC 3161 timestamps', 'Data stored in India'];

export default function Home() {
  return (
    <>
      {/* Hero: start sign-up with just an email */}
      <section className="relative overflow-hidden bg-night bg-dots text-white">
        <div className="absolute -left-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-brand-500/25 blur-3xl" aria-hidden />
        <div className="absolute -bottom-48 right-0 h-[30rem] w-[30rem] rounded-full bg-indigo-600/20 blur-3xl" aria-hidden />
        <div className="relative mx-auto max-w-5xl px-4 pb-24 pt-20 text-center sm:px-6 sm:pt-28">
          <h1 className="text-[2.75rem] font-black leading-[1.02] tracking-tight sm:text-7xl lg:text-[5.5rem]">
            Everything you need <span className="block text-gold">to agree.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-300 sm:text-xl">Send, sign and manage your agreements, with the right signature for every country. Free for 14 days.</p>
          <form action="/register" method="get" className="mx-auto mt-10 flex max-w-xl flex-col gap-2 sm:flex-row sm:gap-0">
            <label htmlFor="hero-email" className="sr-only">
              Work email
            </label>
            <input
              id="hero-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="name@company.com"
              className="h-14 w-full shrink-0 rounded-lg bg-white px-5 sm:w-auto sm:flex-1 text-base text-ink placeholder:text-gray-400 focus:outline-none focus:ring-4 focus:ring-brand-400/40 sm:rounded-r-none"
            />
            <button type="submit" className="h-14 rounded-lg bg-gold px-7 text-base font-bold text-ink hover:brightness-105 sm:rounded-l-none">
              Get started
            </button>
          </form>
          <p className="mt-4 text-sm text-gray-400">
            No credit card required. By continuing you agree to the{' '}
            <Link href="/legal/terms" className="underline hover:text-white">
              Terms
            </Link>{' '}
            and{' '}
            <Link href="/legal/privacy" className="underline hover:text-white">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </section>

      {/* Works with */}
      <section className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <p className="text-center text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Works with the tools you already use</p>
          <ul className="mt-5 flex flex-wrap items-center justify-center gap-x-9 gap-y-3">
            {WORKS_WITH.map((n) => (
              <li key={n} className="text-lg font-bold tracking-tight text-gray-400">
                {n}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Statement + solution tabs */}
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-4 pb-24 pt-20 sm:px-6">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-black tracking-tight text-ink sm:text-5xl">One platform for every agreement</h2>
            <p className="mt-5 text-lg leading-relaxed text-gray-600 sm:text-xl">
              Prepare, sign, verify and manage agreements in one place, with identity checks, payments and the evidence courts expect.
            </p>
            <Link href="/product" className="mt-6 inline-flex items-center gap-1 text-lg font-semibold text-brand-700 hover:text-ink">
              Explore the platform <span aria-hidden>›</span>
            </Link>
          </div>
          <div className="mt-14">
            <HomeSolutions />
          </div>

          {/* Workflow: wide card */}
          <article className="mt-6 grid items-center gap-10 overflow-hidden rounded-2xl bg-brand-50 p-8 ring-1 ring-brand-100 sm:p-12 lg:grid-cols-2">
            <div>
              <h3 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">Automate agreement processes</h3>
              <p className="mt-4 text-[17px] leading-relaxed text-gray-600">
                Generate documents from Word templates, route them for approval, and send them to each signer in the right order, with reminders and expiry dates handled for you.
              </p>
              <Link href="/product" className="mt-6 inline-flex items-center gap-1 font-semibold text-brand-700 hover:text-ink">
                Explore templates and approvals <span aria-hidden>›</span>
              </Link>
            </div>
            <div className="flex justify-center py-4">
              <WorkflowMock />
            </div>
          </article>

          {/* Developers + AI */}
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <article className="flex flex-col overflow-hidden rounded-2xl bg-brand-50 ring-1 ring-brand-100">
              <div className="p-8 sm:p-10">
                <h3 className="text-2xl font-bold tracking-tight text-ink">Build with the API, SDKs and MCP</h3>
                <p className="mt-4 text-[17px] leading-relaxed text-gray-600">
                  Our own app runs on the same REST API you get. Embed signing, react to signed webhooks, and let AI agents work with agreements through the MCP server.
                </p>
                <Link href="/developers" className="mt-6 inline-flex items-center gap-1 font-semibold text-brand-700 hover:text-ink">
                  Explore developer tools <span aria-hidden>›</span>
                </Link>
              </div>
              <div className="mt-auto translate-y-6 px-8 sm:px-10">
                <CodeMock />
              </div>
            </article>
            <article className="flex flex-col overflow-hidden rounded-2xl bg-brand-50 ring-1 ring-brand-100">
              <div className="p-8 sm:p-10">
                <h3 className="text-2xl font-bold tracking-tight text-ink">Let AI read the fine print</h3>
                <p className="mt-4 text-[17px] leading-relaxed text-gray-600">
                  Summaries, key terms and renewal dates pulled from your contracts, so nothing important is buried on page twelve. Off until your admin turns it on.
                </p>
                <Link href="/solutions/legal" className="mt-6 inline-flex items-center gap-1 font-semibold text-brand-700 hover:text-ink">
                  Explore AI features <span aria-hidden>›</span>
                </Link>
              </div>
              <div className="mt-auto translate-y-6 px-8 sm:px-10">
                <AiMock />
              </div>
            </article>
          </div>

          <div className="mt-16 flex flex-wrap items-center justify-center gap-6">
            <GoldLink href="/pricing" className="rounded-lg px-7">
              View plans and pricing
            </GoldLink>
            <Link href="/product" className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:text-ink">
              Explore all products <span aria-hidden>›</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Integrations band */}
      <section className="relative overflow-hidden bg-night bg-dots text-white">
        <div className="absolute inset-x-0 -top-32 mx-auto h-64 w-[40rem] rounded-full bg-brand-500/20 blur-3xl" aria-hidden />
        <div className="relative mx-auto max-w-4xl px-4 py-24 text-center sm:px-6">
          <h2 className="text-3xl font-black tracking-tight sm:text-5xl">Build your own agreement workflows</h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-gray-300 sm:text-xl">
            Connect your CRM, cloud storage, Office and Google Docs, chat tools and thousands of apps through Zapier, or build exactly what you need with the API.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link href="/partners" className="rounded-lg border border-white/40 px-7 py-3.5 font-bold hover:bg-white/10">
              Explore integrations
            </Link>
            <Link href="/developers" className="rounded-lg px-7 py-3.5 font-bold text-brand-300 hover:text-brand-200">
              API documentation ›
            </Link>
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="bg-[#1b1530] text-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[1fr_2fr]">
          <div>
            <h2 className="text-3xl font-black tracking-tight sm:text-5xl">Built for trust</h2>
            <p className="mt-5 text-lg leading-relaxed text-gray-300">
              We take your agreements as seriously as you do: every signature is verified, every event is recorded, and every signed PDF can be checked by anyone.
            </p>
            <Link href="/compliance" className="mt-6 inline-flex items-center gap-1 font-semibold text-brand-300 hover:text-brand-200">
              Explore trust and security <span aria-hidden>›</span>
            </Link>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {FACTS.map((f) => (
              <div key={f.label} className="rounded-2xl bg-white p-7 text-ink">
                <p className="text-gold text-4xl font-black tracking-tight">{f.value}</p>
                <p className="mt-2 text-xl font-bold">{f.label}</p>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{f.note}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Laws and standards supported</p>
          <ul className="mt-5 grid gap-4 border-y border-white/15 py-6 sm:grid-cols-3 lg:grid-cols-6">
            {STANDARDS.map((s) => (
              <li key={s} className="flex items-center gap-3 text-lg">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-brand-300 text-sm text-brand-300" aria-hidden>
                  ✓
                </span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Solutions grid */}
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-black tracking-tight text-ink sm:text-5xl">Built for teams where signatures carry weight</h2>
            <p className="mt-5 text-lg text-gray-600 sm:text-xl">From a two-person agency to a bank&apos;s lending desk, {brand.name} fits the way your team already works.</p>
          </div>
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {SOLUTIONS.map((s) => (
              <Link key={s.slug} href={`/solutions/${s.slug}`} className="group rounded-2xl border border-gray-200 p-7 transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lg">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">{s.group === 'team' ? 'Team' : 'Industry'}</p>
                <h3 className="mt-2 text-xl font-bold text-ink">{s.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{s.summary}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 group-hover:text-ink">
                  Learn more <span aria-hidden>›</span>
                </span>
              </Link>
            ))}
            <Link href="/contact" className="group flex flex-col justify-between rounded-2xl bg-night bg-dots p-7 text-white">
              <div>
                <h3 className="text-xl font-bold">Something else?</h3>
                <p className="mt-2 text-sm text-gray-400">Tell us what you sign and we&apos;ll show you how it works.</p>
              </div>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-300">
                Talk to us <span aria-hidden>›</span>
              </span>
            </Link>
          </div>
        </div>
      </section>

      <CtaBand title="See it on your own documents" intro="Start a free 14-day trial and send your first agreement in minutes, or talk to us about your compliance requirements." />
    </>
  );
}
