import Link from 'next/link';
import type { ReactNode } from 'react';
import { brand } from '@/lib/brand';
import { SOLUTIONS } from '@/lib/solutions';
import { cx } from '@/lib/cx';
import { Logo } from '../ui';
import { EmailStart } from './Landing';

const FOOTER = [
  {
    title: 'Product',
    links: [
      { href: '/product', label: 'Features' },
      { href: '/partners', label: 'Integrations' },
      { href: '/product', label: 'Templates' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/verify', label: 'Verify a document' },
    ],
  },
  {
    title: 'Solutions',
    links: [
      ...SOLUTIONS.filter((s) => ['sales', 'legal', 'hr', 'procurement', 'real-estate'].includes(s.slug)).map((s) => ({ href: `/solutions/${s.slug}`, label: s.name })),
      { href: '/#industries', label: 'All industries' },
    ],
  },
  {
    title: 'Developers',
    links: [
      { href: '/developers', label: 'API overview' },
      { href: '/developers#quickstart', label: 'Documentation' },
      { href: '/developers', label: 'SDKs' },
      { href: '/developers#webhooks', label: 'Webhooks' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { href: '/help', label: 'Help centre' },
      { href: '/help', label: 'Guides' },
      { href: '/compliance#security', label: 'Security' },
      { href: '/compliance#residency', label: 'Data residency' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/partners', label: 'Partners' },
      { href: '/contact', label: 'Contact' },
      { href: '/compliance', label: 'Trust centre' },
    ],
  },
];

const SOCIAL_ICONS: Record<string, string> = {
  linkedin: 'M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9.75h4v11H3v-11Zm6.5 0h3.8v1.5h.05c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.65 4.78 6.1v5.45h-4v-4.83c0-1.15-.02-2.63-1.6-2.63-1.6 0-1.85 1.25-1.85 2.55v4.91h-4v-11Z',
  x: 'M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.78L17.75 3Zm-1.08 16.2h1.7L7.4 4.73H5.58L16.67 19.2Z',
  youtube: 'M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12a31 31 0 0 0 .5 4.8 3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-4.8 31 31 0 0 0-.5-4.8ZM9.75 15.02V8.98L15.5 12l-5.75 3.02Z',
  github: 'M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z',
};

export function SiteFooter() {
  const social = Object.entries(brand.social).filter(([, url]) => url);
  return (
    <footer className="bg-white">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-3 lg:grid-cols-[1.6fr_repeat(5,1fr)]">
        <div>
          <Logo className="text-xl text-ink" />
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-gray-500">A modern agreement platform for teams that move fast.</p>
          {social.length > 0 && (
            <ul className="mt-5 flex gap-4">
              {social.map(([name, url]) => (
                <li key={name}>
                  <a href={url} aria-label={name} className="text-gray-500 hover:text-ink" target="_blank" rel="noreferrer">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
                      <path d={SOCIAL_ICONS[name]} />
                    </svg>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        {FOOTER.map((col) => (
          <div key={col.title}>
            <h2 className="text-sm font-bold text-ink">{col.title}</h2>
            <ul className="mt-4 space-y-2.5">
              {col.links.map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="text-sm text-gray-500 hover:text-ink">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-gray-100">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-gray-500 sm:px-6">
          <span>
            © {new Date().getFullYear()} {brand.legalEntity}. All rights reserved. {brand.name} is a product of {brand.legalEntity}.
          </span>
          <nav className="flex gap-5" aria-label="Legal">
            <Link href="/legal/privacy" className="hover:text-ink">
              Privacy
            </Link>
            <Link href="/legal/terms" className="hover:text-ink">
              Terms
            </Link>
            <a href={`mailto:${brand.supportEmail}`} className="hover:text-ink">
              Support
            </a>
            <a href="/sitemap.xml" className="hover:text-ink">
              Site map
            </a>
          </nav>
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

export function CtaBand({ title = 'Turn agreements into progress.', intro = `Simplify how your team creates, signs and manages contracts. Start free and send your first agreement in minutes.` }: { title?: string; intro?: string }) {
  return (
    <section className="bg-white px-4 py-10 sm:px-6">
      <div className="relative mx-auto grid max-w-7xl items-center gap-8 overflow-hidden rounded-3xl bg-night px-8 py-12 sm:px-12 lg:grid-cols-[1.1fr_1fr]">
        <Mountains />
        <div className="relative">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-300">Ready to get started?</p>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">{title}</h2>
          <p className="mt-3 max-w-md text-gray-300">{intro}</p>
        </div>
        <div className="relative">
          <EmailStart id="cta-email" />
        </div>
      </div>
    </section>
  );
}

/** Night mountains with a gold horizon, drawn in SVG (no photo to load). */
function Mountains() {
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1200 300" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <radialGradient id="cta-glow" cx="78%" cy="62%" r="45%">
          <stop offset="0" stopColor="#e8c170" stopOpacity="0.55" />
          <stop offset="0.45" stopColor="#c9932e" stopOpacity="0.18" />
          <stop offset="1" stopColor="#0a0a12" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="cta-far" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2238" />
          <stop offset="1" stopColor="#14111f" />
        </linearGradient>
        <linearGradient id="cta-near" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#15121f" />
          <stop offset="1" stopColor="#0a0a12" />
        </linearGradient>
      </defs>
      <rect width="1200" height="300" fill="url(#cta-glow)" />
      <path d="M520 300 L700 150 L770 190 L860 95 L960 170 L1030 130 L1200 230 L1200 300 Z" fill="url(#cta-far)" />
      <path d="M860 95 L885 118 L872 116 L860 126 L848 114 L838 117 Z" fill="#e8c170" opacity="0.35" />
      <path d="M600 300 L760 215 L840 245 L950 180 L1060 235 L1200 200 L1200 300 Z" fill="url(#cta-near)" />
      <g fill="#ffffff" opacity="0.6">
        <circle cx="690" cy="40" r="1" />
        <circle cx="820" cy="28" r="1.2" />
        <circle cx="1000" cy="50" r="0.9" />
        <circle cx="1110" cy="30" r="1.1" />
        <circle cx="930" cy="70" r="0.8" />
      </g>
    </svg>
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
