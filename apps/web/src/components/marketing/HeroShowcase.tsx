'use client';

import { useEffect, useRef, useState } from 'react';
import { brand } from '@/lib/brand';
import { cx } from '../ui';
import { Icon, type IconName } from './Icons';

/**
 * Hero product scene in 3D: the app window tilted in perspective with a gold
 * ribbon behind it, a signature card visitors can really use (draw, type or
 * upload, then insert) and a phone that shows and completes the signature.
 */

type Signature = { kind: 'image'; src: string } | { kind: 'text'; text: string } | null;

const ROWS: { title: string; party: string; status: string; tone: string; icon: string }[] = [
  { title: 'Sales Contract', party: 'Acme Co.', status: 'Waiting for signature', tone: 'bg-amber-50 text-amber-700', icon: 'bg-blue-50 text-blue-500' },
  { title: 'NDA', party: 'Globex Corporation', status: 'Completed', tone: 'bg-emerald-50 text-emerald-700', icon: 'bg-orange-50 text-orange-500' },
  { title: 'Partnership Agreement', party: 'Stark Industries', status: 'In review', tone: 'bg-blue-50 text-blue-600', icon: 'bg-blue-50 text-blue-500' },
  { title: 'Employment Offer', party: 'Wayne Enterprises', status: 'Completed', tone: 'bg-emerald-50 text-emerald-700', icon: 'bg-orange-50 text-orange-500' },
];

const NAV: [IconName, string][] = [
  ['home', 'Home'],
  ['document', 'Agreements'],
  ['layers', 'Templates'],
  ['flow', 'Workflows'],
  ['users', 'Contacts'],
  ['chart', 'Reports'],
];

/** A written-looking default signature, so the scene never starts empty. */
const SAMPLE_SIGNATURE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 70"><path d="M10 50 C 22 10, 34 10, 30 42 S 46 58, 58 30 C 64 18, 70 46, 80 40 S 96 26, 104 40 S 120 48, 132 36 L 210 34" fill="none" stroke="#1d1a4d" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  );

export function HeroShowcase() {
  const [signature, setSignature] = useState<Signature>({ kind: 'image', src: SAMPLE_SIGNATURE });
  const [signed, setSigned] = useState(false);

  return (
    <div className="relative mx-auto w-full max-w-[700px] pb-16 pt-12 sm:pb-36">
      <Ribbon />
      <div className="bg-dots pointer-events-none absolute -right-6 top-24 hidden h-40 w-24 opacity-60 sm:block" aria-hidden />
      <div className="bg-dots pointer-events-none absolute -left-10 top-6 hidden h-24 w-24 opacity-50 sm:block" aria-hidden />

      <div className="absolute right-4 top-0 z-30 hidden items-center gap-3 rounded-2xl border border-white/15 bg-[#161827]/90 py-2 pl-2 pr-5 text-sm text-gray-200 shadow-xl shadow-black/40 backdrop-blur sm:flex">
        <span className="flex -space-x-2">
          {[
            ['IN', 'from-amber-300 to-orange-500'],
            ['US', 'from-sky-300 to-blue-600'],
            ['UK', 'from-rose-300 to-red-600'],
            ['EU', 'from-indigo-300 to-indigo-700'],
          ].map(([c, g]) => (
            <span key={c} className={`flex h-9 w-9 items-center justify-center rounded-full border-2 border-[#161827] bg-gradient-to-br ${g} text-[10px] font-bold text-white`}>
              {c}
            </span>
          ))}
        </span>
        Legally binding in 4 jurisdictions
      </div>

      {/* App window, tilted in 3D */}
      <div className="relative z-10 [perspective:2200px]">
        <div
          className="relative overflow-hidden rounded-[22px] border-[7px] border-[#1a1d2e] bg-white ring-1 ring-white/15 sm:[transform:rotateY(-16deg)_rotateX(6deg)_rotateZ(1.5deg)] sm:[transform-origin:30%_50%]"
          style={{ boxShadow: '10px 10px 0 -1px #11131f, 18px 20px 0 -2px #0c0d17, 40px 60px 90px rgba(0,0,0,0.6), 0 0 80px rgba(201,147,46,0.12)' }}
          aria-hidden
        >
          <div className="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[150px_minmax(0,1fr)]">
            <div className="hidden bg-[#121428] px-3 py-5 text-gray-300 sm:block">
              <div className="flex items-center gap-2 px-2">
                <svg viewBox="0 0 32 32" className="h-6 w-6">
                  <rect width="32" height="32" rx="8" fill="#c9932e" />
                  <path d="M8 21c3-1 4.5-9 7-9s1 7 3 7 2.5-4 6-4" stroke="#14110b" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="text-[14px] font-bold text-white">{brand.name}</span>
              </div>
              <ul className="mt-6 space-y-1">
                {NAV.map(([icon, label]) => (
                  <li
                    key={label}
                    className={cx(
                      'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[12.5px]',
                      label === 'Agreements' ? 'bg-brand-500/15 font-semibold text-brand-300 shadow-[inset_3px_0_0_#c9932e]' : 'text-gray-400',
                    )}
                  >
                    <Icon name={icon} className="h-4 w-4" />
                    {label}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-[#fbfbfd] p-5">
              <div className="flex items-center justify-between">
                <div className="flex h-8 w-44 items-center gap-2 rounded-lg bg-gray-100 px-3 text-gray-400">
                  <span className="text-xs">⌕</span>
                  <span className="h-1.5 w-20 rounded bg-gray-200" />
                </div>
                <div className="flex items-center gap-3 text-gray-400">
                  <Icon name="document" className="h-4 w-4" />
                  <Icon name="bell" className="h-4 w-4" />
                  <span className="h-7 w-7 rounded-full bg-gradient-to-br from-rose-200 to-amber-600 ring-2 ring-white" />
                </div>
              </div>
              <div className="mt-5 flex items-center justify-between">
                <p className="text-[22px] font-bold tracking-tight text-ink">Agreements</p>
                <span className="rounded-lg bg-gold px-4 py-2 text-[12px] font-bold text-ink shadow-md shadow-brand-500/30">New agreement</span>
              </div>
              <div className="mt-3 flex gap-6 border-b border-gray-200 text-[12px] text-gray-500">
                {['All', 'Drafts', 'Waiting for others', 'Completed'].map((t, i) => (
                  <span key={t} className={cx('pb-2', i === 0 && 'border-b-2 border-brand-500 font-semibold text-brand-600')}>
                    {t}
                  </span>
                ))}
              </div>
              <ul className="mt-4 space-y-2.5">
                {ROWS.map((r) => (
                  <li key={r.title} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-3.5 py-3 shadow-[0_2px_8px_rgba(15,20,40,0.05)]">
                    <span className={cx('flex h-10 w-10 items-center justify-center rounded-lg', r.icon)}>
                      <Icon name="document" className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-semibold text-ink">{r.title}</p>
                      <p className="truncate text-[11.5px] text-gray-500">{r.party}</p>
                    </div>
                    <span className={cx('whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-medium', r.tone)}>{r.status}</span>
                    <span className="text-gray-400">•••</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Working signature card */}
      <div className="relative z-20 mx-auto -mt-8 w-[270px] sm:absolute sm:-left-8 sm:bottom-2 sm:mt-0 lg:-left-4">
        <SignatureCard
          onInsert={(s) => {
            setSignature(s);
            setSigned(false);
          }}
        />
      </div>

      {/* Phone, tilted in 3D */}
      <div className="absolute -right-4 bottom-0 z-20 hidden [perspective:1200px] sm:block lg:-right-10">
        <div
          className="relative w-[200px] rounded-[2.6rem] border-[8px] border-[#0f1120] bg-[#0f1120] [transform:rotateY(-18deg)_rotateZ(5deg)]"
          style={{ boxShadow: '6px 8px 0 -1px #1d2033, 30px 40px 70px rgba(0,0,0,0.65)' }}
        >
          <div className="absolute left-1/2 top-1.5 z-10 h-5 w-20 -translate-x-1/2 rounded-full bg-[#0f1120]" aria-hidden />
          <div className="overflow-hidden rounded-[2rem] bg-[#f4f5f8] px-3.5 pb-4 pt-9">
            <div className="rounded-xl bg-white p-3 shadow-sm">
              <p className="text-[15px] font-bold text-ink">Contract</p>
              <div className="mt-3 space-y-1.5">
                {[100, 92, 96, 78, 88, 64].map((w, i) => (
                  <div key={i} className="h-1.5 rounded bg-gray-100" style={{ width: `${w}%` }} />
                ))}
              </div>
              <div className="mt-5 flex h-16 items-end justify-center border-b border-gray-200 pb-1">
                {signature ? <SignaturePreview signature={signature} className="max-h-14" /> : <span className="text-[11px] text-gray-400">Sign here</span>}
              </div>
            </div>
            <button
              type="button"
              disabled={!signature}
              onClick={() => setSigned(true)}
              className="mt-3 w-full rounded-xl bg-gold py-2.5 text-[13px] font-bold text-ink shadow-md shadow-brand-500/30 disabled:opacity-50"
            >
              {signed ? 'Signed ✓' : 'Sign & complete'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Glowing gold ribbon swooping behind the window. */
function Ribbon() {
  return (
    <svg className="pointer-events-none absolute -left-48 -top-24 z-0 h-[calc(100%+160px)] w-[calc(100%+300px)]" viewBox="0 0 900 600" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="ribbon" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#c9932e" stopOpacity="0.1" />
          <stop offset="0.3" stopColor="#f0cf87" stopOpacity="1" />
          <stop offset="0.7" stopColor="#c9932e" stopOpacity="0.7" />
          <stop offset="1" stopColor="#c9932e" stopOpacity="0" />
        </linearGradient>
        <filter id="ribbon-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
      </defs>
      <path d="M0 470 C 120 520, 230 300, 330 170 S 620 -10, 900 110" fill="none" stroke="url(#ribbon)" strokeWidth="70" strokeLinecap="round" opacity="0.45" filter="url(#ribbon-glow)" />
      <path d="M0 470 C 120 520, 230 300, 330 170 S 620 -10, 900 110" fill="none" stroke="url(#ribbon)" strokeWidth="4" strokeLinecap="round" />
      <path d="M10 500 C 140 545, 250 330, 350 200 S 640 25, 900 140" fill="none" stroke="url(#ribbon)" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
      <circle cx="60" cy="300" r="4" fill="#fff" opacity="0.8" />
    </svg>
  );
}

function SignaturePreview({ signature, className }: { signature: NonNullable<Signature>; className?: string }) {
  return signature.kind === 'image' ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={signature.src} alt="Your signature" className={cx('object-contain', className)} />
  ) : (
    <span className={cx('truncate font-script text-3xl text-[#1d1a4d]', className)}>{signature.text}</span>
  );
}

function SignatureCard({ onInsert }: { onInsert: (s: NonNullable<Signature>) => void }) {
  const [tab, setTab] = useState<'draw' | 'type' | 'upload'>('draw');
  const [typed, setTyped] = useState('');
  const [upload, setUpload] = useState<string | null>(null);
  const [drawn, setDrawn] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1d1a4d';
  }, [tab]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = e.currentTarget.getContext('2d')!;
    ctx.beginPath();
    ctx.moveTo(...point(e));
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext('2d')!;
    ctx.lineTo(...point(e));
    ctx.stroke();
    setDrawn(true);
  };
  const clear = () => {
    const c = canvas.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    setDrawn(false);
    setTyped('');
    setUpload(null);
  };

  const ready = tab === 'draw' ? drawn : tab === 'type' ? typed.trim().length > 0 : Boolean(upload);
  function insert() {
    if (tab === 'draw' && canvas.current) onInsert({ kind: 'image', src: canvas.current.toDataURL('image/png') });
    else if (tab === 'type') onInsert({ kind: 'text', text: typed.trim() });
    else if (upload) onInsert({ kind: 'image', src: upload });
  }

  return (
    <div className="rounded-2xl border border-white/60 bg-white p-4 text-left shadow-[0_30px_60px_rgba(0,0,0,0.5)]">
      <div className="flex items-center justify-between">
        <p className="text-[14px] font-bold text-ink">Add your signature</p>
        <button type="button" onClick={clear} className="text-[11px] font-medium text-gray-500 hover:text-ink">
          Clear
        </button>
      </div>
      <div className="mt-2 grid grid-cols-3 border-b border-gray-200 text-[12px]" role="tablist" aria-label="Signature style">
        {(['draw', 'type', 'upload'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cx('-mb-px border-b-2 pb-2 pt-1 font-medium capitalize', tab === t ? 'border-brand-500 text-ink' : 'border-transparent text-gray-400 hover:text-gray-600')}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="mt-3 h-24 overflow-hidden rounded-xl border border-gray-200 bg-white">
        {tab === 'draw' && (
          <canvas
            ref={canvas}
            aria-label="Draw your signature here"
            className="h-full w-full touch-none cursor-crosshair"
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={() => (drawing.current = false)}
            onPointerLeave={() => (drawing.current = false)}
          />
        )}
        {tab === 'type' && (
          <div className="flex h-full flex-col justify-center px-3">
            <input
              aria-label="Type your name"
              value={typed}
              maxLength={40}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Type your name"
              className="w-full border-b border-gray-200 pb-1 text-[12px] text-ink focus:border-brand-400 focus:outline-none"
            />
            <p className="mt-1 h-9 truncate font-script text-3xl text-[#1d1a4d]">{typed}</p>
          </div>
        )}
        {tab === 'upload' && (
          <label className="flex h-full cursor-pointer flex-col items-center justify-center gap-1 text-[11px] text-gray-500 hover:bg-gray-50">
            {upload ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={upload} alt="Uploaded signature" className="max-h-20 object-contain" />
            ) : (
              <>
                <Icon name="document" className="h-5 w-5" />
                Choose an image of your signature
              </>
            )}
            <input
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file || file.size > 2_000_000) return;
                const reader = new FileReader();
                reader.onload = () => setUpload(String(reader.result));
                reader.readAsDataURL(file);
              }}
            />
          </label>
        )}
      </div>
      <button type="button" disabled={!ready} onClick={insert} className="mt-3 w-full rounded-xl bg-gold py-2.5 text-[12.5px] font-bold text-ink shadow-md shadow-brand-500/30 hover:brightness-105 disabled:opacity-50">
        Insert signature
      </button>
      <p className="mt-2 text-center text-[10px] text-gray-400">Try it: draw, type or upload, then insert.</p>
    </div>
  );
}
