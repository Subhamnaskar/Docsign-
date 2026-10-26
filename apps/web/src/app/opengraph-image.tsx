import { ImageResponse } from 'next/og';
import { brand } from '@/lib/brand';

/** The share card shown when a page is posted on LinkedIn, WhatsApp, X or Facebook. */
export const alt = `${brand.name}: e-signatures for India and the world`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 72, background: 'linear-gradient(135deg, #0a0a12 0%, #14110b 60%, #2a1f08 100%)', color: '#f4f1ea', fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <svg width="88" height="88" viewBox="0 0 32 32">
            <defs>
              <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#d4a24e" />
                <stop offset="1" stopColor="#b8860b" />
              </linearGradient>
            </defs>
            <rect width="32" height="32" rx="8" fill="url(#g)" />
            <path d="M8 21c3-1 4.5-9 7-9s1 7 3 7 2.5-4 6-4" stroke="#14110b" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div style={{ fontSize: 52, fontWeight: 800 }}>{brand.name}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ fontSize: 76, fontWeight: 900, lineHeight: 1.05 }}>Send. Sign. Manage.</div>
          <div style={{ fontSize: 76, fontWeight: 900, lineHeight: 1.05, color: '#d4a24e' }}>All in one place.</div>
          <div style={{ fontSize: 32, color: '#c9c3b5', marginTop: 8 }}>Legally valid e-signatures, Aadhaar eSign and sealed PDFs, for India and the world.</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 28, color: '#a39e92' }}>
          <span>{brand.domain}</span>
          <span>by {brand.legalEntity}</span>
        </div>
      </div>
    ),
    size,
  );
}
