import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { pageMeta } from '@/lib/seo';

export const metadata: Metadata = pageMeta({
  title: 'Verify a Signed PDF',
  description: 'Check that a signed PDF or certificate of completion is an unaltered original. The file is checked in your browser session and not stored.',
  path: '/verify',
  keywords: ['verify signed PDF', 'check digital signature', 'verify e-signature'],
});

export default function VerifyLayout({ children }: { children: ReactNode }) {
  return children;
}
