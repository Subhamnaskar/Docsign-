import { useEffect, useState } from 'react';

/**
 * True inside the mobile app's web view (apps/mobile), where the app has its own
 * navigation: the server sets the ds_app cookie when the app opens a page.
 */
export function useInApp() {
  const [inApp, setInApp] = useState(false);
  useEffect(() => setInApp(/(^|;\s*)ds_app=1/.test(document.cookie)), []);
  return inApp;
}
