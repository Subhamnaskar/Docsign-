import type { Metadata } from 'next';
import type { Viewport } from 'next';
import { ServiceWorker } from '@/components/ServiceWorker';
import { brand } from '@/lib/brand';
import './globals.css';
import { Analytics } from '@/components/Analytics';
import { SITE_URL } from '@/lib/seo';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${brand.name}: ${brand.tagline}`, template: `%s | ${brand.name}` },
  description: brand.description,
  applicationName: brand.name,
  publisher: brand.legalEntity,
  openGraph: { siteName: brand.name, type: 'website', locale: 'en_IN' },
  twitter: { card: 'summary_large_image' },
  // Google Search Console: the code from "HTML tag" verification, set in Vercel
  ...(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION && { verification: { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION } }),
  icons: { icon: '/icons/icon-32.png', apple: '/icons/icon-180.png' },
  appleWebApp: { capable: true, title: brand.name, statusBarStyle: 'default' },
};

export const viewport: Viewport = { themeColor: '#c9932e' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        {children}
        <ServiceWorker />
        <Analytics />
      </body>
    </html>
  );
}
