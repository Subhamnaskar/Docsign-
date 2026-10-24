import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from './ui';

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-8">
        <Logo className="text-xl text-gray-900" />
      </Link>
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-7 shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
