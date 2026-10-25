import Link from 'next/link';
import type { ReactNode } from 'react';
import { brand } from '@/lib/brand';
import { SOLUTIONS } from '@/lib/solutions';
import { cx } from '@/lib/cx';
import { Logo } from '../ui';

const FOOTER = [
  {
    title: 'Product',
    links: [
      { href: '/product', label: 'Features' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/verify', label: 'Verify a document' },
      { href: '/register', label: 'Start free' },
    ],
  },
  {
    title: 'Solutions',
    links: SOLUTIONS.map((s) => ({ href: `/solutions/${s.slug}`, label: s.name })),
  },
  {
    title: 'Trust',
    links: [
      { href: '/compliance', label: 'Compliance' },
      { href: '/compliance#security', label: 'Security' },
      { href: '/compliance#residency', label: 'Data residency' },
    ],
  },
  {
    title: 'Developers',
    links: [
      { href: '/developers', label: 'API overview' },
      { href: '/developers#webhooks', label: 'Webhooks' },
      { href: '/developers#templates', label: 'Templates API' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/help', label: 'Help centre' },
      { href: '/partners', label: 'Partners' },
      { href: '/contact', label: 'Contact' },
      { href: '/legal/terms', label: 'Terms' },
      { href: '/legal/privacy', label: 'Privacy' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-gray-200/70 bg-cream">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-3 lg:grid-cols-[1.4fr_repeat(5,1fr)]">
        <div>
          <Logo className="text-gray-900" />
          <p className="mt-3 max-w-xs text-sm text-gray-500">{brand.tagline}</p>
        </div>
        {FOOTER.map((col) => (
          <div key={col.title}>
            <h3 className="text-sm font-semibold text-gray-900">{col.title}</h3>
            <ul className="mt-3 space-y-2">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-gray-500 hover:text-gray-900">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-gray-100">
        <div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-2 px-4 py-6 text-xs text-gray-400 sm:px-6">
          <span>
            {brand.name} is a product of {brand.legalEntity}. © {new Date().getFullYear()} {brand.legalEntity}. All rights reserved.
          </span>
          <a href={`mailto:${brand.supportEmail}`} className="hover:text-gray-600">
            {brand.supportEmail}
          </a>
        </div>
      </div>
    </footer>
  );
}

/** Page section with consistent spacing. */
export function Section({ children, className, id, tone }: { children: ReactNode; className?: string; id?: string; tone?: 'white' | 'muted' | 'dark' }) {
  return (
    <section
      id={id}
      className={cx(
        'scroll-mt-20',
        tone === 'dark' ? 'bg-night bg-dots text-white' : tone === 'muted' ? 'bg-cream' : 'bg-white',
        className,
      )}
    >
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24">{children}</div>
    </section>
  );
}

/** Small spaced-caps label above a heading, with an optional "01"-style number. */
export function Eyebrow({ children, dark, number }: { children: ReactNode; dark?: boolean; number?: string }) {
  return (
    <p className={cx('inline-flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.14em]', dark ? 'text-gray-400' : 'text-gray-500')}>
      {number ? (
        <span className={cx('rounded-md px-2 py-0.5 font-mono text-[11px] tracking-normal', dark ? 'bg-white/10 text-brand-300' : 'bg-brand-50 text-brand-700')}>{number}</span>
      ) : (
        <span className="h-px w-6 bg-brand-500" />
      )}
      {children}
    </p>
  );
}

export function SectionHeading({ eyebrow, number, title, intro, center, dark }: { eyebrow?: string; number?: string; title: string; intro?: string; center?: boolean; dark?: boolean }) {
  return (
    <div className={cx('max-w-2xl', center && 'mx-auto text-center')}>
      {eyebrow && (
        <Eyebrow dark={dark} number={number}>
          {eyebrow}
        </Eyebrow>
      )}
      <h2 className={cx('mt-4 text-3xl font-black tracking-tight sm:text-[2.6rem] sm:leading-[1.1]', dark ? 'text-white' : 'text-ink')}>{title}</h2>
      {intro && <p className={cx('mt-4 text-lg leading-relaxed', dark ? 'text-gray-400' : 'text-gray-600')}>{intro}</p>}
    </div>
  );
}

export function PageHero({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: string; children?: ReactNode }) {
  return (
    <section className="border-b border-gray-200/70 bg-cream">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-4xl font-black tracking-tight text-ink sm:text-[3.4rem] sm:leading-[1.05]">{title}</h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-gray-600">{intro}</p>
        {children && <div className="mt-8">{children}</div>}
      </div>
    </section>
  );
}

/** Gold pill call-to-action, the main button on the website. */
export function GoldLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cx('inline-flex items-center gap-2 rounded-full bg-gold px-6 py-3 text-sm font-bold text-ink shadow-md shadow-brand-500/20 transition hover:brightness-105', className)}>
      {children}
    </Link>
  );
}

export function OutlineLink({ href, children, dark, className }: { href: string; children: ReactNode; dark?: boolean; className?: string }) {
  return (
    <Link
      href={href}
      className={cx(
        'inline-flex items-center rounded-full border px-6 py-3 text-sm font-bold transition',
        dark ? 'border-white/25 bg-white/5 text-white hover:bg-white/10' : 'border-gray-300 bg-white text-ink hover:bg-gray-50',
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function CtaBand({ title = 'See it on your own documents', intro = 'Create a free account and send your first agreement in minutes, or talk to us about your compliance requirements.' }: { title?: string; intro?: string }) {
  return (
    <section className="bg-cream px-4 py-16 sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-col items-start gap-8 overflow-hidden rounded-[2rem] bg-night bg-dots px-8 py-14 sm:px-12 md:flex-row md:items-center md:justify-between">
        <div className="max-w-xl">
          <h2 className="text-3xl font-black tracking-tight text-white sm:text-4xl">{title}</h2>
          <p className="mt-3 text-gray-400">{intro}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <GoldLink href="/register">Start free trial →</GoldLink>
          <OutlineLink href="/contact" dark>
            Book a demo
          </OutlineLink>
        </div>
      </div>
    </section>
  );
}

export function Check({ children, dark }: { children: ReactNode; dark?: boolean }) {
  return (
    <li className="flex gap-3">
      <span className={cx('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full', dark ? 'bg-brand-500/15 text-brand-300' : 'bg-brand-50 text-brand-600')}>
        <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z" clipRule="evenodd" />
        </svg>
      </span>
      <span>{children}</span>
    </li>
  );
}
