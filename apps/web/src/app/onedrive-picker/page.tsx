import Script from 'next/script';

/** Redirect target for the OneDrive file picker popup; the SDK finishes the hand-off here. */
export default function OneDrivePickerRedirect() {
  return <Script src="https://js.live.net/v7.2/OneDrive.js" strategy="afterInteractive" />;
}
