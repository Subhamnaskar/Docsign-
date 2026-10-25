'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { SOLUTIONS } from '@/lib/solutions';
import { cx, Logo } from '../ui';

type MenuId = 'products' | 'solutions' | 'resources';
interface MenuLink {
  href: string;
  label: string;
  note?: string;
}

const PRODUCTS: { heading: string; links: MenuLink[] }[] = [
  {
    heading: 'Sign',
    links: [
      { href: '/product', label: 'eSignature', note: 'Prepare, send and sign agreements on any device' },
      { href: '/product', label: 'Templates and bulk send', note: 'Reuse layouts and send to hundreds from a CSV' },
      { href: '/product', label: 'Web forms and payments', note: 'Self-serve signing links that collect payments' },
    ],
  },
  {
    heading: 'Verify and comply',
    links: [
      { href: '/compliance', label: 'Identity verification', note: 'Email, SMS and WhatsApp codes, PAN, Aadhaar eSign' },
      { href: '/compliance', label: 'Compliance engine', note: 'The right signature for India, the US, the UK and the EU' },
      { href: '/verify', label: 'Verify a document', note: 'Check that a signed PDF is authentic' },
    ],
  },
  {
    heading: 'Manage and connect',
    links: [
      { href: '/product', label: 'Contract repository and AI', note: 'Search contracts, extract terms, track renewals' },
      { href: '/developers', label: 'Developer API', note: 'REST API, SDKs, webhooks and embedded signing' },
      { href: '/partners', label: 'Integrations', note: 'CRM, cloud storage, Office, Google Docs, Slack' },
    ],
  },
];

const RESOURCES: MenuLink[] = [
  { href: '/help', label: 'Help centre', note: 'Guides and answers' },
  { href: '/developers', label: 'API documentation', note: 'Quick start and reference' },
  { href: '/compliance', label: 'Trust and security', note: 'How we protect your agreements' },
  { href: '/partners', label: 'Partners', note: 'Resellers and technology partners' },
  { href: '/contact', label: 'Contact us', note: 'Sales and support' },
];

/** Public website header: utility bar, main navigation with menus, and the trial button. */
export function SiteHeader() {
  const pathname = usePathname();
  const [menu, setMenu] = useState<MenuId | null>(null);
  const [mobile, setMobile] = useState(false);
  const header = useRef<HTMLElement>(null);

  useEffect(() => {
    setMenu(null);
    setMobile(false);
  }, [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    const onClick = (e: MouseEvent) => header.current && !header.current.contains(e.target as Node) && setMenu(null);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, []);

  const trigger = (id: MenuId, label: string) => (
    <button
      type="button"
      aria-expanded={menu === id}
      aria-controls={`menu-${id}`}
      onClick={() => setMenu(menu === id ? null : id)}
      onMouseEnter={() => setMenu(id)}
      className={cx('inline-flex items-center gap-1 rounded-md px-3 py-2 text-[15px] font-medium', menu === id ? 'text-brand-300' : 'text-gray-200 hover:text-white')}
    >
      {label}
      <svg className={cx('h-3.5 w-3.5 transition', menu === id && 'rotate-180')} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        <path fillRule="evenodd" d="M5.2 7.2a.75.75 0 0 1 1.06 0L10 10.94l3.74-3.74a.75.75 0 1 1 1.06 1.06l-4.27 4.27a.75.75 0 0 1-1.06 0L5.2 8.26a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
      </svg>
    </button>
  );

  return (
    <header ref={header} className="sticky top-0 z-40" onMouseLeave={() => setMenu(null)}>
      <div className="border-b border-white/10 bg-night/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="Home" className="mr-2">
            <Logo className="text-lg text-white" />
          </Link>
          <nav className="hidden items-center lg:flex" aria-label="Main">
            {trigger('products', 'Products')}
            {trigger('solutions', 'Solutions')}
            {trigger('resources', 'Resources')}
            <Link href="/developers" onMouseEnter={() => setMenu(null)} className={cx('rounded-md px-3 py-2 text-[15px] font-medium', pathname.startsWith('/developers') ? 'text-brand-300' : 'text-gray-200 hover:text-white')}>
              Developers
            </Link>
            <Link href="/pricing" onMouseEnter={() => setMenu(null)} className={cx('rounded-md px-3 py-2 text-[15px] font-medium', pathname.startsWith('/pricing') ? 'text-brand-300' : 'text-gray-200 hover:text-white')}>
              Pricing
            </Link>
          </nav>
          <div className="ml-auto hidden items-center gap-2 lg:flex">
            <Link href="/login" className="px-3 py-2 text-[15px] font-medium text-gray-200 hover:text-white">
              Log in
            </Link>
            <Link href="/register" className="inline-flex items-center gap-2 rounded-lg bg-gold px-5 py-2.5 text-sm font-bold text-ink shadow-sm hover:brightness-105">
              Get started free
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </Link>
          </div>
          <button className="ml-auto rounded-md p-2 text-gray-200 hover:bg-white/10 lg:hidden" onClick={() => setMobile((o) => !o)} aria-expanded={mobile} aria-label="Menu">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
              {mobile ? <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /> : <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>

        {menu && (
          <div id={`menu-${menu}`} className="absolute inset-x-0 top-full hidden border-b border-gray-200 bg-white shadow-xl lg:block">
            <div className="mx-auto max-w-7xl px-6 py-8">
              {menu === 'products' && (
                <div className="grid grid-cols-[1fr_1fr_1fr_0.9fr] gap-8">
                  {PRODUCTS.map((g) => (
                    <MenuColumn key={g.heading} heading={g.heading} links={g.links} />
                  ))}
                  <MenuPromo title="See the whole platform" body="Everything from preparing a document to verifying the sealed PDF." href="/product" cta="Explore all products" />
                </div>
              )}
              {menu === 'solutions' && (
                <div className="grid grid-cols-[1fr_1fr_0.9fr] gap-8">
                  <MenuColumn heading="By team" links={SOLUTIONS.filter((s) => s.group === 'team').map((s) => ({ href: `/solutions/${s.slug}`, label: s.name, note: s.summary }))} />
                  <MenuColumn heading="By industry" links={SOLUTIONS.filter((s) => s.group === 'industry').map((s) => ({ href: `/solutions/${s.slug}`, label: s.name, note: s.summary }))} />
                  <MenuPromo title="Built for Indian business" body="IT Act consent, Aadhaar eSign, stamp duty, e-NACH and data stored in India." href="/compliance" cta="How compliance works" />
                </div>
              )}
              {menu === 'resources' && (
                <div className="grid grid-cols-[2fr_0.9fr] gap-8">
                  <div className="grid grid-cols-2 gap-x-8">
                    <MenuColumn heading="Learn and get help" links={RESOURCES.slice(0, 3)} />
                    <MenuColumn heading="Work with us" links={RESOURCES.slice(3)} />
                  </div>
                  <MenuPromo title="Received a signed PDF?" body="Check its digital seal, timestamp and audit trail in seconds, no account needed." href="/verify" cta="Verify a document" />
                </div>
              )}
            </div>
          </div>
        )}

        {mobile && (
          <div className="max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-gray-200 bg-white px-4 pb-6 lg:hidden">
            <MobileGroup title="Products" links={PRODUCTS.flatMap((g) => g.links)} />
            <MobileGroup title="Solutions" links={SOLUTIONS.map((s) => ({ href: `/solutions/${s.slug}`, label: s.name }))} />
            <MobileGroup title="Resources" links={RESOURCES} />
            <nav className="flex flex-col border-t border-gray-100 py-2">
              {[
                ['/developers', 'Developers'],
                ['/pricing', 'Pricing'],
                ['/verify', 'Verify a document'],
                ['/login', 'Log in'],
              ].map(([href, label]) => (
                <Link key={href} href={href} className="rounded-md px-2 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50">
                  {label}
                </Link>
              ))}
            </nav>
            <div className="grid grid-cols-2 gap-2">
              <Link href="/contact" className="rounded-lg border border-gray-300 px-4 py-2.5 text-center text-sm font-bold text-ink">
                Contact sales
              </Link>
              <Link href="/register" className="rounded-lg bg-gold px-4 py-2.5 text-center text-sm font-bold text-ink">
                Get started free
              </Link>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

function MenuColumn({ heading, links }: { heading: string; links: MenuLink[] }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">{heading}</p>
      <ul className="mt-3 space-y-1">
        {links.map((l) => (
          <li key={l.label}>
            <Link href={l.href} className="group block rounded-lg px-3 py-2.5 -mx-3 hover:bg-cream">
              <span className="block text-[15px] font-semibold text-ink group-hover:text-brand-700">{l.label}</span>
              {l.note && <span className="mt-0.5 block text-sm text-gray-500">{l.note}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MenuPromo({ title, body, href, cta }: { title: string; body: string; href: string; cta: string }) {
  return (
    <div className="rounded-2xl bg-night bg-dots p-6 text-white">
      <p className="text-lg font-bold">{title}</p>
      <p className="mt-2 text-sm text-gray-400">{body}</p>
      <Link href={href} className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-brand-300 hover:text-brand-200">
        {cta} <span aria-hidden>›</span>
      </Link>
    </div>
  );
}

function MobileGroup({ title, links }: { title: string; links: MenuLink[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-gray-100">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between px-2 py-3 text-left text-sm font-semibold text-ink">
        {title}
        <span aria-hidden className="text-gray-400">
          {open ? '−' : '+'}
        </span>
      </button>
      {open && (
        <ul className="pb-2">
          {links.map((l) => (
            <li key={l.label}>
              <Link href={l.href} className="block rounded-md px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
