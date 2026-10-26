import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/marketing/Site';
import { SiteHeader } from '@/components/marketing/SiteHeader';
import { JsonLd } from '@/components/JsonLd';
import { organizationLd, websiteLd } from '@/lib/seo';

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <JsonLd data={organizationLd} />
      <JsonLd data={websiteLd} />
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
