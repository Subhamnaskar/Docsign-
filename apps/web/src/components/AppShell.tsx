'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '@/lib/api';
import type { Me } from '@/lib/types';
import { cx, Logo, PageLoader } from './ui';
import { HelpPanel } from './HelpPanel';
import { AppLocaleContext, type AppKey, appT } from '@/lib/appI18n';

const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext);

const NAV: { href: string; label: AppKey }[] = [
  { href: '/dashboard', label: 'nav.agreements' },
  { href: '/templates', label: 'nav.templates' },
  { href: '/repository', label: 'nav.repository' },
  { href: '/reports', label: 'nav.reports' },
  { href: '/verify', label: 'nav.verify' },
  { href: '/settings', label: 'nav.settings' },
];

/** Layout for signed-in pages; redirects to /login when the session is missing. */
export function AppShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    api<Me>('/auth/me')
      .then((m) => {
        // Organisation policy: nothing else works until two-factor is set up
        if (m.user?.mfaSetupRequired && pathname !== '/settings') router.replace('/settings?tab=security');
        setMe(m);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      });
  }, [router, pathname]);

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    router.replace('/login');
  }

  const locale = me?.user?.locale ?? 'en';
  const t = (key: AppKey, vars?: Record<string, string | number>) => appT(locale, key, vars);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <AppLocaleContext.Provider value={locale}>
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
                {t(n.label)}
              </Link>
            ))}
            {me?.user?.platformAdmin && (
              <Link
                href="/admin"
                className={cx('rounded-md px-3 py-1.5 text-sm font-semibold', pathname.startsWith('/admin') ? 'bg-ink text-white' : 'text-brand-700 hover:bg-brand-50')}
              >
                {t('nav.console')}
              </Link>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {me && (
              <span className="hidden text-right leading-tight text-gray-600 sm:block">
                <span className="block font-medium text-gray-900">{me.user?.name}</span>
                <span className="block text-xs">{me.organization.name}</span>
              </span>
            )}
            <button onClick={() => setHelpOpen(true)} className="rounded-md px-2 py-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800">
              {t('nav.help')}
            </button>
            <button onClick={logout} className="rounded-md px-2 py-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800">
              {t('nav.signOut')}
            </button>
          </div>
        </div>
      </header>
      <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />
      {me && <AccountBanner me={me} wide={wide} />}
      {me && <BillingBanner me={me} wide={wide} />}
      <main className={cx('mx-auto px-4 py-6 sm:px-6 sm:py-8', wide ? 'max-w-[1400px]' : 'max-w-6xl')}>
        {me ? children : <PageLoader />}
      </main>
    </MeContext.Provider>
    </AppLocaleContext.Provider>
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
  const t = (key: AppKey, vars?: Record<string, string | number>) => appT(me.user?.locale ?? 'en', key, vars);
  if (b.state === 'trialing' && b.trialEndsAt) {
    const days = Math.max(0, Math.ceil((new Date(b.trialEndsAt).getTime() - Date.now()) / 86_400_000));
    if (days <= TRIAL_WARN_DAYS) text = t('banner.trialEnds', { days });
  } else if (b.state === 'past_due') {
    text = t('banner.paymentFailed');
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
            {b.state === 'past_due' ? t('banner.goToBilling') : t('banner.choosePlan')}
          </Link>
        ) : (
          <span>{t('banner.askAdmin')}</span>
        )}
      </div>
    </div>
  );
}

/** Unconfirmed email (can't send yet) and required two-factor setup. */
function AccountBanner({ me, wide }: { me: Me; wide?: boolean }) {
  const [resent, setResent] = useState(false);
  const u = me.user;
  if (!u) return null;
  const t = (key: AppKey, vars?: Record<string, string | number>) => appT(u.locale ?? 'en', key, vars);
  const width = wide ? 'max-w-[1400px]' : 'max-w-6xl';
  if (u.mfaSetupRequired) {
    return (
      <div className="border-b border-amber-200 bg-amber-50 text-sm text-amber-900">
        <div className={cx('mx-auto px-4 py-2 sm:px-6', width)}>{t('banner.mfaRequired')}</div>
      </div>
    );
  }
  if (u.emailVerified !== false) return null;
  return (
    <div className="border-b border-brand-100 bg-brand-50 text-sm text-brand-800">
      <div className={cx('mx-auto flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:px-6', width)}>
        <span>{t('banner.confirmEmail', { email: u.email })}</span>
        {resent ? (
          <span className="font-medium">{t('banner.resent')}</span>
        ) : (
          <button className="font-semibold underline" onClick={() => api('/auth/verify-email/resend', { method: 'POST' }).then(() => setResent(true))}>
            {t('banner.resend')}
          </button>
        )}
      </div>
    </div>
  );
}
