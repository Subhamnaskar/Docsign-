import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { pageMeta } from '@/lib/seo';

export const metadata: Metadata = pageMeta({
  title: 'Sign a PDF Online Free, No Account Needed',
  description: 'Upload a joining letter, rental agreement or any PDF, add your signature, then download the signed PDF or send it back. Free, legally valid and sealed.',
  path: '/sign-yourself',
  keywords: ['sign PDF online free', 'sign a document online', 'e-sign PDF free', 'sign joining letter online', 'free electronic signature'],
});

export default function SignYourselfLayout({ children }: { children: ReactNode }) {
  return children;
}
