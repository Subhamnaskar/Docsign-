'use client';

import Script from 'next/script';
import { useState } from 'react';
import { Logo, Spinner } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const Office: any;

/**
 * Sign-in dialog for the Office add-in. It opens as a top-level window, where
 * the normal session cookie works, and hands a session token back to the pane.
 */
export default function OfficeConnect() {
  const [message, setMessage] = useState('Connecting to DocSign…');

  async function connect() {
    try {
      const { token } = await api<{ token: string }>('/auth/session-token', { method: 'POST' });
      Office.context.ui.messageParent(JSON.stringify({ token }));
      setMessage('Connected. You can close this window.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) window.location.assign(`/login?next=${encodeURIComponent('/office/connect')}`);
      else setMessage((err as Error).message);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-sm text-gray-600">
      <Script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js" strategy="afterInteractive" onLoad={() => Office.onReady(() => connect())} />
      <Logo className="text-xl text-gray-900" />
      <div className="flex items-center gap-2">
        <Spinner className="h-4 w-4" /> {message}
      </div>
    </div>
  );
}
