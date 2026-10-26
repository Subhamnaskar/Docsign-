import Link from 'next/link';
import { HeroShowcase } from '@/components/marketing/HeroShowcase';
import { Icon, type IconName } from '@/components/marketing/Icons';
import { CodeTabs, EmailStart, FeatureTabs } from '@/components/marketing/Landing';
import { CtaBand } from '@/components/marketing/Site';
import { brand } from '@/lib/brand';
import { SOLUTIONS } from '@/lib/solutions';
import type { Metadata } from 'next';
import { JsonLd } from '@/components/JsonLd';
import { pageMeta, softwareLd } from '@/lib/seo';

/** Integrations the product has today, shown as wordmarks in their own colours (no customer claim). */
const WORKS_WITH: { name: string; className: string }[] = [
  { name: 'slack', className: 'font-black lowercase tracking-tight text-[#4A154B]' },
  { name: 'Google Drive', className: 'font-semibold text-[#1A73E8]' },
  { name: 'Microsoft 365', className: 'font-semibold text-gray-700' },
  { name: 'Dropbox', className: 'font-bold text-[#0061FE]' },
  { name: 'HubSpot', className: 'font-bold text-[#C2410C]' },
  { name: 'zapier', className: 'font-black lowercase text-[#FF4F00]' },
  { name: 'Salesforce', className: 'font-bold text-[#0176D3]' },
  { name: 'OneDrive', className: 'font-semibold text-[#0364B8]' },
];

/** True statements only: encryption, sealing, audit, residency, laws. */
const TRUST: { icon: IconName; title: string; note: string }[] = [
  { icon: 'lock', title: '100%', note: 'Encrypted in transit and at rest' },
  { icon: 'shield', title: 'PAdES', note: 'Digital seal and trusted timestamp' },
  { icon: 'chart', title: 'SHA-256', note: 'Hash-chained audit trail' },
  { icon: 'database', title: 'India', note: 'Data residency for Indian customers' },
  { icon: 'globe', title: '4 laws', note: 'IT Act · eIDAS · ESIGN · UK ECA' },
];

const INDUSTRY_ICONS: Record<string, IconName> = {
  sales: 'chart',
  hr: 'users',
  legal: 'document',
  procurement: 'cart',
  banking: 'bank',
  'real-estate': 'home',
  software: 'box',
};

const HUB: { label: string; className: string; text: string }[] = [
  { label: 'Salesforce', className: 'bg-[#0176D3] text-white', text: 'sf' },
  { label: 'Google Drive', className: 'bg-white text-[#1FA463]', text: '▲' },
  { label: 'Slack', className: 'bg-white text-[#4A154B]', text: '#' },
  { label: 'HubSpot', className: 'bg-white text-[#C2410C]', text: 'H' },
];

export const metadata: Metadata = {
  ...pageMeta({
    title: 'E-Signature Software for India and the World',
    description: 'Sign PDFs and contracts online with legally valid e-signatures, Aadhaar eSign and sealed PDFs. Send for signature, track and store agreements. Free trial.',
    path: '/',
    keywords: ['e-signature', 'electronic signature', 'digital signature online', 'Aadhaar eSign', 'sign PDF online', 'e-signature software India', 'online document signing'],
  }),
  title: { absolute: `${brand.name}: E-Signature Software for India and the World` },
};

export default function Home() {
  return (
    <>
      <JsonLd data={softwareLd()} />
      {/* Hero */}
      <section className="relative overflow-hidden bg-night text-white">
        <HeroWaves />
        <div className="relative mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] items-center gap-14 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:pb-20 lg:pt-20">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">E-signature software for India and the world</p>
            <h1 className="mt-5 text-[2.7rem] font-black leading-[1.03] tracking-tight sm:text-6xl lg:text-[3.5rem] xl:text-[3.9rem]">
              <span className="lg:whitespace-nowrap">Send. Sign. Manage.</span>
              <span className="block text-gold">All in one place.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-gray-300">
              {brand.name} helps teams create, send, e-sign and manage agreements online, with Aadhaar eSign, sealed PDFs, workflows and integrations to keep business moving.
            </p>
            <div className="mt-8 max-w-xl">
              <EmailStart id="hero-email" />
              <p className="mt-4 text-sm text-gray-400">
                Just need to sign something you received?{' '}
                <Link href="/sign-yourself" className="font-semibold text-brand-300 hover:text-brand-200">
                  Sign a document yourself, free →
                </Link>
              </p>
            </div>
          </div>
          <HeroShowcase />
        </div>
      </section>

      {/* Works with */}
      <section className="border-b border-gray-100 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
          <p className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">Works with the tools your team already uses</p>
          <ul className="mt-6 grid grid-cols-2 items-center justify-items-center gap-6 sm:grid-cols-4 lg:grid-cols-8">
            {WORKS_WITH.map((w) => (
              <li key={w.name} className={`text-xl ${w.className}`}>
                {w.name}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-20 bg-cream">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-block rounded-full bg-brand-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-700">Powerful features</span>
            <h2 className="mt-4 text-3xl font-black tracking-tight text-ink sm:text-5xl">Everything you need to manage agreements</h2>
            <p className="mt-4 text-lg text-gray-600">From e-signatures to automated workflows, {brand.name} gives you the tools to handle your contracts from start to finish.</p>
          </div>
          <div className="mt-10">
            <FeatureTabs />
          </div>
        </div>
      </section>

      {/* Integrate */}
      <section className="relative overflow-hidden bg-night text-white">
        <div className="absolute -left-40 top-0 h-96 w-96 rounded-full bg-brand-500/15 blur-3xl" aria-hidden />
        <div className="relative mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1.1fr)] lg:py-24">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">Connect your stack</p>
            <h2 className="mt-4 text-3xl font-black tracking-tight sm:text-5xl">
              Integrate. Automate.
              <span className="block text-gold">Do more with {brand.name}.</span>
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-gray-300">
              Connect to your favourite tools, build custom workflows, or use our API to create powerful agreement experiences in your product.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/partners" className="inline-flex items-center gap-2 rounded-lg bg-gold px-6 py-3 font-bold text-ink hover:brightness-105">
                Explore integrations <Icon name="arrow" className="h-4 w-4" />
              </Link>
              <Link href="/developers" className="rounded-lg border border-white/25 px-6 py-3 font-bold hover:bg-white/10">
                View API docs
              </Link>
            </div>
          </div>
          <IntegrationHub />
          <CodeTabs />
        </div>
      </section>

      {/* Trust */}
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-4 pt-20 sm:px-6 lg:pt-24">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl">
              <span className="inline-block rounded-full bg-brand-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-700">Trust & security</span>
              <h2 className="mt-4 text-3xl font-black tracking-tight text-ink sm:text-4xl">Your agreements are in safe hands</h2>
              <p className="mt-3 text-lg text-gray-600">Encryption, sealed documents and a tamper-evident audit trail keep your data safe and your agreements defensible.</p>
            </div>
            <Link href="/compliance" className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:text-ink">
              Learn about our security <Icon name="arrow" className="h-4 w-4" />
            </Link>
          </div>
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {TRUST.map((t) => (
              <li key={t.title} className="flex items-center gap-4 rounded-2xl border border-gray-200 p-5">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-500 ring-1 ring-brand-100">
                  <Icon name={t.icon} className="h-6 w-6" />
                </span>
                <div>
                  <p className="text-xl font-black text-ink">{t.title}</p>
                  <p className="text-xs text-gray-500">{t.note}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Industries */}
      <section id="industries" className="scroll-mt-20 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:py-24">
          <span className="inline-block rounded-full bg-brand-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-700">Built for every team</span>
          <h2 className="mt-4 text-3xl font-black tracking-tight text-ink sm:text-4xl">Agreements for every industry</h2>
          <p className="mt-3 text-lg text-gray-600">From fast-growing start-ups to large enterprises, {brand.name} adapts to the way your team works.</p>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {SOLUTIONS.map((s) => (
              <Link key={s.slug} href={`/solutions/${s.slug}`} className="group flex gap-4 rounded-2xl border border-gray-200 bg-white p-6 transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lg">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-500 ring-1 ring-brand-100">
                  <Icon name={INDUSTRY_ICONS[s.slug] ?? 'document'} className="h-6 w-6" />
                </span>
                <div>
                  <h3 className="font-bold text-ink">{s.name}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-gray-500">{s.summary}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-700">
                    Learn more <Icon name="arrow" className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                  </span>
                </div>
              </Link>
            ))}
            <Link href="/contact" className="group flex gap-4 rounded-2xl bg-night p-6 text-white transition hover:-translate-y-0.5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/10 text-brand-300">
                <Icon name="grid" className="h-6 w-6" />
              </span>
              <div>
                <h3 className="font-bold">And more</h3>
                <p className="mt-1 text-sm leading-relaxed text-gray-400">{brand.name} works for any team that works with agreements.</p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-300">
                  Talk to us <Icon name="arrow" className="h-3.5 w-3.5" />
                </span>
              </div>
            </Link>
          </div>
        </div>
      </section>

      <CtaBand />
    </>
  );
}

/** Flowing gold lines behind the hero. */
function HeroWaves() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1440 760" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id="wave" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#c9932e" stopOpacity="0" />
          <stop offset="0.5" stopColor="#e8c170" stopOpacity="0.55" />
          <stop offset="1" stopColor="#c9932e" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="hero-glow" cx="70%" cy="45%" r="50%">
          <stop offset="0" stopColor="#3b2a4a" stopOpacity="0.8" />
          <stop offset="1" stopColor="#0a0a12" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1440" height="760" fill="url(#hero-glow)" />
      {[0, 14, 28, 42, 56, 70].map((d, i) => (
        <path
          key={d}
          d={`M-40 ${600 - d} C 300 ${470 - d}, 520 ${720 - d}, 860 ${560 - d} S 1300 ${360 - d}, 1500 ${430 - d}`}
          fill="none"
          stroke="url(#wave)"
          strokeWidth={i === 2 ? 1.6 : 0.8}
          opacity={1 - i * 0.12}
        />
      ))}
    </svg>
  );
}

/** Integrations flowing into the product mark. */
function IntegrationHub() {
  return (
    <div className="relative mx-auto flex h-80 w-full max-w-[260px] items-center justify-between" aria-hidden>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 260 320" fill="none">
        {[40, 120, 200, 280].map((y) => (
          <path key={y} d={`M64 ${y} C 120 ${y}, 120 160, 172 160`} stroke="#c9932e" strokeOpacity="0.7" strokeWidth="1.4" />
        ))}
      </svg>
      <ul className="relative flex h-full flex-col justify-between py-1">
        {HUB.map((h) => (
          <li key={h.label} title={h.label} className="flex h-14 w-14 items-center justify-center rounded-xl border border-white/10 bg-[#141626] shadow-lg">
            <span className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-black ${h.className}`}>{h.text}</span>
          </li>
        ))}
      </ul>
      <div className="relative flex h-24 w-24 items-center justify-center rounded-2xl border border-brand-400/50 bg-[#141626] shadow-[0_0_60px_rgba(201,147,46,0.45)]">
        <svg viewBox="0 0 32 32" className="h-12 w-12" aria-hidden>
          <rect width="32" height="32" rx="8" fill="#c9932e" />
          <path d="M8 21c3-1 4.5-9 7-9s1 7 3 7 2.5-4 6-4" stroke="#14110b" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}
