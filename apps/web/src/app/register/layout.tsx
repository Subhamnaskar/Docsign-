import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { pageMeta } from '@/lib/seo';

export const metadata: Metadata = pageMeta({
  title: 'Start Your Free E-Signature Trial',
  description: 'Create a Nuronix eSign account in a minute. Free trial with every feature, no card needed.',
  path: '/register',
});

export default function RegisterLayout({ children }: { children: ReactNode }) {
  return children;
}
