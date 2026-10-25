'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '@/lib/api';
import type { Me } from '@/lib/types';
import { cx, Logo, PageLoader } from './ui';

const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext);

const NAV = [
  { href: '/dashboard', label: 'Agreements' },
  { href: '/templates', label: 'Templates' },
  { href: '/reports', label: 'Reports' },
  { href: '/verify', label: 'Verify' },
  { href: '/settings', label: 'Settings' },
];

/** Layout for signed-in pages; redirects to /login when the session is missing. */
export function AppShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    api<Me>('/auth/me')
      .then(setMe)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      });
  }, [router, pathname]);

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    router.replace('/login');
  }

  return (
    <MeContext.Provider value={me}>
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className={cx('mx-auto flex h-14 items-center gap-6 px-4 sm:px-6', wide ? 'max-w-[1400px]' : 'max-w-6xl')}>
          <Link href="/dashboard">
            <Logo className="text-gray-900" />
          </Link>
          <nav className="flex gap-1">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={cx(
                  'rounded-md px-3 py-1.5 text-sm font-medium',
                  pathname.startsWith(n.href) ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:text-gray-900',
                )}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {me && (
              <span className="hidden text-right leading-tight text-gray-600 sm:block">
                <span className="block font-medium text-gray-900">{me.user?.name}</span>
                <span className="block text-xs">{me.organization.name}</span>
              </span>
            )}
            <button onClick={logout} className="rounded-md px-2 py-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800">
              Sign out
            </button>
          </div>
        </div>
      </header>
      {me && <BillingBanner me={me} wide={wide} />}
      <main className={cx('mx-auto px-4 py-6 sm:px-6 sm:py-8', wide ? 'max-w-[1400px]' : 'max-w-6xl')}>
        {me ? children : <PageLoader />}
      </main>
    </MeContext.Provider>
  );
}

const TRIAL_WARN_DAYS = 5;

/** Trial and subscription notices; admins get a link to Billing. */
function BillingBanner({ me, wide }: { me: Me; wide?: boolean }) {
  const b = me.billing;
  if (!b) return null;
  const admin = !me.user || me.user.role === 'OWNER' || me.user.role === 'ADMIN';
  let text: string | null = null;
  let urgent = false;
  if (b.state === 'trialing' && b.trialEndsAt) {
    const days = Math.max(0, Math.ceil((new Date(b.trialEndsAt).getTime() - Date.now()) / 86_400_000));
    if (days <= TRIAL_WARN_DAYS) text = `Your free trial ends in ${days} day${days === 1 ? '' : 's'}.`;
  } else if (b.state === 'past_due') {
    text = 'Your last payment failed. Update your payment method to avoid interruption.';
  } else if (!b.canSend) {
    text = b.blockedReason;
    urgent = true;
  }
  if (!text) return null;
  return (
    <div className={cx('border-b text-sm', urgent ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900')}>
      <div className={cx('mx-auto flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:px-6', wide ? 'max-w-[1400px]' : 'max-w-6xl')}>
        <span>{text}</span>
        {admin ? (
          <Link href="/settings?tab=billing" className="font-semibold underline">
            {b.state === 'past_due' ? 'Go to billing' : 'Choose a plan'}
          </Link>
        ) : (
          <span>Ask an admin to choose a plan.</span>
        )}
      </div>
    </div>
  );
}
