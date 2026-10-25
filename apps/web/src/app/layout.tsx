import type { Metadata } from 'next';
import type { Viewport } from 'next';
import { ServiceWorker } from '@/components/ServiceWorker';
import { brand } from '@/lib/brand';
import './globals.css';

export const metadata: Metadata = {
  title: { default: `${brand.name}: ${brand.tagline}`, template: `%s | ${brand.name}` },
  description: brand.description,
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
      </body>
    </html>
  );
}
