'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Card, PageLoader } from '@/components/ui';
import { api, setSignerSession } from '@/lib/api';

/**
 * Entry point for embedded signing. Exchanges the one-time ticket for a signing
 * session (kept in sessionStorage, sent as a header) and opens the document.
 */
export default function EmbedStartPage() {
  const { ticket } = useParams<{ ticket: string }>();
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    // Tickets are single use; guard against React's double effect in development
    if (started.current) return;
    started.current = true;
    api<{ signPath: string; sessionToken: string }>(`/embed-sessions/${ticket}`, { method: 'POST' })
      .then(({ signPath, sessionToken }) => {
        setSignerSession(sessionToken);
        router.replace(signPath);
      })
      .catch(() => {
        setFailed(true);
        if (window.parent !== window) window.parent.postMessage({ type: 'docsign:session_expired' }, '*');
      });
  }, [ticket, router]);

  if (failed) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="max-w-md p-8 text-center">
          <h1 className="text-lg font-semibold">This signing session has expired</h1>
          <p className="mt-2 text-sm text-gray-500">Return to the app you came from and open the document again.</p>
        </Card>
      </div>
    );
  }
  return <PageLoader />;
}
