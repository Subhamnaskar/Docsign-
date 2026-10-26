'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '@/lib/api';
import type { Me } from '@/lib/types';
import { cx, Logo, PageLoader } from './ui';
import { HelpPanel } from './HelpPanel';
import { Icon, type IconName } from './marketing/Icons';
import { AppLocaleContext, type AppKey, appT } from '@/lib/appI18n';

const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext);

const NAV: { href: string; label: AppKey; icon: IconName }[] = [
  { href: '/home', label: 'nav.home', icon: 'home' },
  { href: '/dashboard', label: 'nav.agreements', icon: 'document' },
  { href: '/templates', label: 'nav.templates', icon: 'layers' },
  { href: '/workflows', label: 'nav.workflows', icon: 'flow' },
  { href: '/contacts', label: 'nav.contacts', icon: 'users' },
  { href: '/repository', label: 'nav.repository', icon: 'folder' },
  { href: '/reports', label: 'nav.reports', icon: 'chart' },
  { href: '/verify', label: 'nav.verify', icon: 'shield' },
  { href: '/settings', label: 'nav.settings', icon: 'gear' },
];

/** Layout for signed-in pages: navy sidebar, top bar, banners. Redirects to /login when the session is missing. */
export function AppShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const router = useRouter();
  const pathname = usePathname()!;
  const [me, setMe] = useState<Me | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');

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
  useEffect(() => setMenuOpen(false), [pathname]);

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    router.replace('/login');
  }

  const locale = me?.user?.locale ?? 'en';
  const t = (key: AppKey, vars?: Record<string, string | number>) => appT(locale, key, vars);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`) || (href === '/dashboard' && pathname.startsWith('/envelopes'));
  const initials = (me?.user?.name ?? '?')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const sidebar = (
    <div className="flex h-full flex-col bg-[#121428] text-gray-300">
      <Link href="/home" className="flex h-16 shrink-0 items-center px-5">
        <Logo className="text-white" />
      </Link>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2" aria-label="Main">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active(n.href) ? 'page' : undefined}
            className={cx(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
              active(n.href) ? 'bg-brand-500/15 text-brand-300 shadow-[inset_3px_0_0_#c9932e]' : 'text-gray-400 hover:bg-white/5 hover:text-white',
            )}
          >
            <Icon name={n.icon} className="h-[18px] w-[18px]" />
            {t(n.label)}
          </Link>
        ))}
        {me?.user?.platformAdmin && (
          <Link
            href="/admin"
            className={cx('mt-3 flex items-center gap-3 rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold', pathname.startsWith('/admin') ? 'bg-gold text-ink' : 'text-brand-300 hover:bg-white/5')}
          >
            <Icon name="grid" className="h-[18px] w-[18px]" />
            {t('nav.console')}
          </Link>
        )}
      </nav>
      <div className="border-t border-white/10 p-3">
        <button onClick={() => setHelpOpen(true)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-white/5 hover:text-white">
          <Icon name="globe" className="h-[18px] w-[18px]" />
          {t('nav.help')}
        </button>
        {me && (
          <div className="mt-2 flex items-center gap-3 rounded-lg px-3 py-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold text-xs font-bold text-ink">{initials}</span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-medium text-white">{me.user?.name}</span>
              <span className="block truncate text-xs text-gray-500">{me.organization.name}</span>
            </span>
            <button onClick={logout} title={t('nav.signOut')} aria-label={t('nav.signOut')} className="rounded-md p-1.5 text-gray-400 hover:bg-white/10 hover:text-white">
              <Icon name="arrow" className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <AppLocaleContext.Provider value={locale}>
    <MeContext.Provider value={me}>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 lg:block">{sidebar}</aside>
      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
          <aside className="relative h-full w-64 shadow-2xl">{sidebar}</aside>
        </div>
      )}
      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/90 backdrop-blur">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <button className="rounded-md p-2 text-gray-600 hover:bg-gray-100 lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Menu">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <form
              className="relative max-w-md flex-1"
              onSubmit={(e) => {
                e.preventDefault();
                router.push(`/dashboard?q=${encodeURIComponent(query.trim())}`);
              }}
            >
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">⌕</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('dash.search')}
                aria-label={t('dash.search')}
                className="h-9 w-full rounded-lg bg-gray-100 pl-8 pr-3 text-sm text-ink placeholder:text-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40"
              />
            </form>
            <div className="ml-auto flex items-center gap-1">
              <Link href="/home" title="Needs your attention" className="rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-ink">
                <Icon name="bell" className="h-5 w-5" />
              </Link>
              <Link href="/settings" title={me?.user?.name ?? ''} className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-gold text-xs font-bold text-ink">
                {initials}
              </Link>
            </div>
          </div>
        </header>
        <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />
        {me?.support && <SupportBanner me={me} wide={wide} />}
        {me && <AccountBanner me={me} wide={wide} />}
        {me && <BillingBanner me={me} wide={wide} />}
        <main className={cx('mx-auto px-4 py-6 sm:px-6 sm:py-8', wide ? 'max-w-[1400px]' : 'max-w-6xl')}>{me ? children : <PageLoader />}</main>
      </div>
    </MeContext.Provider>
    </AppLocaleContext.Provider>
  );
}

/** Shown to NuronixAI staff while they view a customer's account read-only. */
function SupportBanner({ me, wide }: { me: Me; wide?: boolean }) {
  const [busy, setBusy] = useState(false);
  async function end() {
    setBusy(true);
    const { redirect } = await api<{ redirect: string }>('/auth/support/end', { method: 'POST' });
    window.location.href = redirect;
  }
  const ends = me.support?.endsAt ? new Date(me.support.endsAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <div className="border-b border-ink bg-ink text-sm text-white">
      <div className={cx('mx-auto flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:px-6', wide ? 'max-w-[1400px]' : 'max-w-6xl')}>
        <span className="rounded bg-gold px-1.5 py-0.5 text-xs font-bold text-ink">Support session</span>
        <span>
          Viewing <strong>{me.organization.name}</strong> as {me.user?.email}, read-only{ends ? `, until ${ends}` : ''}.
        </span>
        <button onClick={end} disabled={busy} className="ml-auto rounded-full bg-white px-3 py-1 text-xs font-semibold text-ink hover:bg-brand-50 disabled:opacity-60">
          End support session
        </button>
      </div>
    </div>
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
  if (u.guest) {
    return (
      <div className="border-b border-brand-100 bg-brand-50 text-sm text-brand-800">
        <div className={cx('mx-auto flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:px-6', width)}>
          <span>This is your free personal account. Set a password to sign in again and keep your signed documents.</span>
          <Link href={`/forgot-password?email=${encodeURIComponent(u.email)}`} className="font-semibold underline">
            Set a password
          </Link>
        </div>
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
