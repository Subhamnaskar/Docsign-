import { Logo } from '@/components/ui';

export const metadata = { title: 'Offline' };

/** Shown by the service worker when there is no connection. */
export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <Logo className="text-xl text-gray-900" />
      <h1 className="text-lg font-semibold text-gray-900">You&apos;re offline</h1>
      <p className="max-w-sm text-sm text-gray-600">Check your connection and try again. Agreements and signing need an internet connection.</p>
    </div>
  );
}
