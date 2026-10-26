import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { pageMeta } from '@/lib/seo';

export const metadata: Metadata = pageMeta({
  title: 'Contact Sales: Book an E-Signature Demo',
  description: 'Talk to the Nuronix eSign team about a demo, pricing for your team, API and embedded signing, or a partnership.',
  path: '/contact',
});

export default function ContactLayout({ children }: { children: ReactNode }) {
  return children;
}
