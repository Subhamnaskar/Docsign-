import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditMock, SigningMock } from '@/components/marketing/Mocks';
import { Check, CtaBand, GoldLink, OutlineLink } from '@/components/marketing/Site';
import { SOLUTIONS, solutionBySlug } from '@/lib/solutions';
import { pageMeta } from '@/lib/seo';

export function generateStaticParams() {
  return SOLUTIONS.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const s = solutionBySlug((await params).slug);
  return s ? pageMeta({ title: `E-Signatures for ${s.name}`, description: s.intro, path: `/solutions/${s.slug}` }) : {};
}

export default async function SolutionPage({ params }: { params: Promise<{ slug: string }> }) {
  const s = solutionBySlug((await params).slug);
  if (!s) notFound();
  const others = SOLUTIONS.filter((o) => o.slug !== s.slug).slice(0, 3);

  return (
    <>
      <section className="relative overflow-hidden bg-night bg-dots text-white">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-brand-500/25 blur-3xl" aria-hidden />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:py-24">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-300">
              Solutions · {s.group === 'team' ? 'by team' : 'by industry'} · {s.name}
            </p>
            <h1 className="mt-4 text-4xl font-black leading-[1.05] tracking-tight sm:text-6xl">{s.headline}</h1>
            <p className="mt-6 max-w-xl text-lg text-gray-300">{s.intro}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <GoldLink href="/register" className="rounded-lg">
                Try for free
              </GoldLink>
              <OutlineLink href="/contact" dark className="rounded-lg">
                Contact sales
              </OutlineLink>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1.2fr_1fr] sm:items-end">
            <SigningMock />
            <AuditMock />
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <h2 className="max-w-2xl text-3xl font-black tracking-tight text-ink sm:text-4xl">How {s.name.toLowerCase()} teams use it</h2>
          <div className="mt-10 grid gap-6 lg:grid-cols-3">
            {s.useCases.map((u, i) => (
              <article key={u.title} className="rounded-2xl bg-brand-50 p-8 ring-1 ring-brand-100">
                <span className="font-mono text-sm text-brand-700">0{i + 1}</span>
                <h3 className="mt-3 text-xl font-bold text-ink">{u.title}</h3>
                <p className="mt-3 leading-relaxed text-gray-600">{u.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-cream">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2">
          <div>
            <h2 className="text-3xl font-black tracking-tight text-ink sm:text-4xl">What you get</h2>
            <ul className="mt-8 grid gap-3 text-gray-700 sm:grid-cols-2">
              {s.features.map((f) => (
                <Check key={f}>{f}</Check>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-3xl font-black tracking-tight text-ink sm:text-4xl">Documents you can send</h2>
            <ul className="mt-8 flex flex-wrap gap-2">
              {s.documents.map((d) => (
                <li key={d} className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700">
                  {d}
                </li>
              ))}
            </ul>
            <p className="mt-6 text-sm text-gray-500">
              Some documents need more than an electronic signature by law, such as wills or property deeds in many countries. The compliance engine flags them before you send.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <h2 className="text-2xl font-bold tracking-tight text-ink">More solutions</h2>
          <div className="mt-6 grid gap-5 sm:grid-cols-3">
            {others.map((o) => (
              <Link key={o.slug} href={`/solutions/${o.slug}`} className="group rounded-2xl border border-gray-200 p-6 transition hover:-translate-y-0.5 hover:shadow-lg">
                <h3 className="text-lg font-bold text-ink">{o.name}</h3>
                <p className="mt-2 text-sm text-gray-600">{o.summary}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 group-hover:text-ink">
                  Learn more <span aria-hidden>›</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <CtaBand />
    </>
  );
}
