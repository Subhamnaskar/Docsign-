'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AuthCard } from '@/components/AuthCard';
import { Alert, PageLoader } from '@/components/ui';
import { api } from '@/lib/api';

export default function VerifyEmailPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  const [message, setMessage] = useState('');
  const sent = useRef(false);

  useEffect(() => {
    // Tokens are single-use; React strict mode would otherwise send it twice
    if (sent.current) return;
    sent.current = true;
    api('/auth/verify-email', { method: 'POST', json: { token } })
      .then(() => setState('done'))
      .catch((err) => {
        setMessage((err as Error).message);
        setState('failed');
      });
  }, [token]);

  if (state === 'working') return <PageLoader />;
  return (
    <AuthCard title={state === 'done' ? 'Email confirmed' : 'Link not valid'}>
      {state === 'done' ? <p className="text-sm text-gray-600">Thanks. You can now send agreements.</p> : <Alert>{message}</Alert>}
      <Link href="/dashboard" className="mt-5 block rounded-lg bg-gold px-4 py-2.5 text-center text-sm font-bold text-ink hover:brightness-105">
        Go to your agreements
      </Link>
    </AuthCard>
  );
}
