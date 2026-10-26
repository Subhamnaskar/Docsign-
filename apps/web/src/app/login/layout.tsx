import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// Sign-in is for existing users; search results should send people to the home page
export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: true } };

export default function LoginLayout({ children }: { children: ReactNode }) {
  return children;
}
