import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DocSign',
  description: 'Sign, send and verify agreements: compliant by design.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
