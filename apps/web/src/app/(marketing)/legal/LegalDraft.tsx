import type { ReactNode } from 'react';
import { brand } from '@/lib/brand';

/**
 * Layout for legal pages. The text is an outline of what the final document
 * must cover; it is not legal advice and must be replaced by lawyer-approved text.
 */
export function LegalDraft({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <strong>Draft outline, not yet in force.</strong> This page lists what the final {title.toLowerCase()} will cover. It will be replaced by
        text approved by {brand.legalEntity}&apos;s lawyers before launch.
      </div>
      <h1 className="mt-10 text-3xl font-bold tracking-tight text-gray-900">{title}</h1>
      <div className="mt-8 space-y-8 text-gray-700 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-gray-900 [&_li]:ml-5 [&_li]:list-disc [&_p]:mt-2 [&_ul]:mt-2 [&_ul]:space-y-1">
        {children}
      </div>
    </div>
  );
}
