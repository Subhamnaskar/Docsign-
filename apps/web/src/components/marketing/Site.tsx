import Link from 'next/link';
import type { ReactNode } from 'react';
import { brand } from '@/lib/brand';
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
    <footer className="border-t border-gray-200 bg-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_repeat(4,1fr)]">
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
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-4 py-6 text-xs text-gray-400 sm:px-6">
          <span>
            © {new Date().getFullYear()} {brand.legalEntity}. All rights reserved.
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
        tone === 'dark' ? 'bg-gray-950 text-white' : tone === 'muted' ? 'bg-gray-50' : 'bg-white',
        className,
      )}
    >
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">{children}</div>
    </section>
  );
}

export function Eyebrow({ children, dark }: { children: ReactNode; dark?: boolean }) {
  return <p className={cx('text-sm font-semibold uppercase tracking-wider', dark ? 'text-brand-100' : 'text-brand-600')}>{children}</p>;
}

export function SectionHeading({ eyebrow, title, intro, center, dark }: { eyebrow?: string; title: string; intro?: string; center?: boolean; dark?: boolean }) {
  return (
    <div className={cx('max-w-2xl', center && 'mx-auto text-center')}>
      {eyebrow && <Eyebrow dark={dark}>{eyebrow}</Eyebrow>}
      <h2 className={cx('mt-2 text-3xl font-bold tracking-tight sm:text-4xl', dark ? 'text-white' : 'text-gray-900')}>{title}</h2>
      {intro && <p className={cx('mt-4 text-lg', dark ? 'text-gray-300' : 'text-gray-600')}>{intro}</p>}
    </div>
  );
}

export function PageHero({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: string; children?: ReactNode }) {
  return (
    <section className="border-b border-gray-200 bg-gradient-to-b from-brand-50/70 to-white">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-2 max-w-3xl text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">{title}</h1>
        <p className="mt-5 max-w-2xl text-lg text-gray-600">{intro}</p>
        {children && <div className="mt-8">{children}</div>}
      </div>
    </section>
  );
}

export function CtaBand({ title = 'See it on your own documents', intro = 'Create a free account and send your first agreement in minutes, or talk to us about your compliance requirements.' }: { title?: string; intro?: string }) {
  return (
    <section className="bg-brand-600">
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-14 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="max-w-xl">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">{title}</h2>
          <p className="mt-2 text-brand-100">{intro}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/register" className="rounded-lg bg-white px-5 py-3 text-sm font-semibold text-brand-700 shadow hover:bg-brand-50">
            Start free
          </Link>
          <Link href="/contact" className="rounded-lg border border-white/40 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10">
            Book a demo
          </Link>
        </div>
      </div>
    </section>
  );
}

export function Check({ children, dark }: { children: ReactNode; dark?: boolean }) {
  return (
    <li className="flex gap-3">
      <svg className={cx('mt-0.5 h-5 w-5 shrink-0', dark ? 'text-brand-100' : 'text-brand-600')} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        <path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z" clipRule="evenodd" />
      </svg>
      <span>{children}</span>
    </li>
  );
}
