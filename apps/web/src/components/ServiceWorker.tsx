'use client';

import { useEffect } from 'react';

/** Registers the service worker (installable app, offline page). */
export function ServiceWorker() {
  useEffect(() => {
    if ('serviceWorker' in navigator && window.location.protocol === 'https:') {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);
  return null;
}
