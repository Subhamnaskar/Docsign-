'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cx, Logo } from '../ui';

export const SITE_NAV = [
  { href: '/product', label: 'Product' },
  { href: '/compliance', label: 'Compliance' },
  { href: '/developers', label: 'Developers' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/partners', label: 'Partners' },
  { href: '/help', label: 'Help' },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200/70 bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" aria-label="Home">
          <Logo className="text-lg text-gray-900" />
        </Link>
        <nav className="hidden gap-1 md:flex">
          {SITE_NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cx(
                'rounded-md px-3 py-2 text-sm font-medium',
                pathname.startsWith(n.href) ? 'text-brand-700' : 'text-gray-600 hover:text-gray-900',
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <Link href="/login" className="rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900">
            Sign in
          </Link>
          <Link href="/contact" className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50">
            Book a demo
          </Link>
          <Link href="/register" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
            Start free
          </Link>
        </div>
        <button
          className="ml-auto rounded-md p-2 text-gray-600 hover:bg-gray-100 md:hidden"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label="Menu"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
            {open ? <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /> : <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>
      {open && (
        <div className="border-t border-gray-200 bg-white px-4 pb-4 md:hidden">
          <nav className="flex flex-col py-2">
            {SITE_NAV.map((n) => (
              <Link key={n.href} href={n.href} className="rounded-md px-2 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                {n.label}
              </Link>
            ))}
            <Link href="/verify" className="rounded-md px-2 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Verify a document
            </Link>
            <Link href="/login" className="rounded-md px-2 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Sign in
            </Link>
          </nav>
          <div className="grid grid-cols-2 gap-2">
            <Link href="/contact" className="rounded-lg border border-gray-300 px-4 py-2.5 text-center text-sm font-medium">
              Book a demo
            </Link>
            <Link href="/register" className="rounded-lg bg-brand-600 px-4 py-2.5 text-center text-sm font-semibold text-white">
              Start free
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
