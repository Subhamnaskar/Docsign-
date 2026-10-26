'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Script from 'next/script';
import { useEffect, useState } from 'react';

/** Set in Vercel; nothing loads and no banner shows until at least one is set. */
const GA_ID = process.env.NEXT_PUBLIC_GA_ID;
const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

const KEY = 'cookie-consent';
type Consent = 'granted' | 'denied';

/** Signers and the signed-in app are never tracked. */
const PRIVATE = /^\/(sign|embed|envelopes|dashboard|settings|templates|reports|admin|contacts|workflows|repository|home|f|invite|office)(\/|$)/;

/**
 * Visitor analytics (Google Analytics 4, Meta Pixel), loaded only after the
 * visitor accepts cookies (India's DPDP Act, GDPR for EU visitors).
 */
export function Analytics() {
  const pathname = usePathname() ?? '/';
  const [consent, setConsent] = useState<Consent | null | undefined>(undefined);

  useEffect(() => {
    try {
      setConsent(localStorage.getItem(KEY) as Consent | null);
    } catch {
      setConsent(null);
    }
  }, []);

  if ((!GA_ID && !PIXEL_ID) || consent === undefined || PRIVATE.test(pathname)) return null;

  function choose(value: Consent) {
    try {
      localStorage.setItem(KEY, value);
    } catch {
      // Private browsing: the choice lasts for this visit only
    }
    setConsent(value);
  }

  if (consent === null) {
    return (
      <div role="dialog" aria-label="Cookies" className="fixed inset-x-3 bottom-3 z-[60] mx-auto max-w-xl rounded-2xl bg-ink p-4 text-sm text-gray-200 shadow-2xl sm:inset-x-6 sm:p-5">
        <p>
          We use cookies to understand how visitors use this site and to measure our ads. You can say no and everything still works.{' '}
          <Link href="/legal/privacy" className="font-semibold text-brand-300 underline">
            Privacy policy
          </Link>
        </p>
        <div className="mt-3 flex gap-2">
          <button onClick={() => choose('granted')} className="rounded-full bg-gold px-5 py-2 font-semibold text-ink">
            Accept
          </button>
          <button onClick={() => choose('denied')} className="rounded-full px-5 py-2 font-semibold text-gray-200 ring-1 ring-white/30">
            No thanks
          </button>
        </div>
      </div>
    );
  }
  if (consent !== 'granted') return null;

  return (
    <>
      {GA_ID && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
          <Script id="ga4" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');`}
          </Script>
        </>
      )}
      {PIXEL_ID && (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${PIXEL_ID}');fbq('track','PageView');`}
        </Script>
      )}
    </>
  );
}
