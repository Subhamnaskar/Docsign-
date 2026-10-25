'use client';

import { useEffect, useRef, useState } from 'react';
import { brand } from '@/lib/brand';
import { cx, Logo } from '../ui';
import { Icon, type IconName } from './Icons';

/**
 * Hero product scene: the agreements list, a signature card visitors can
 * really use (draw, type or upload, then insert) and a phone that shows the
 * inserted signature.
 */

type Signature = { kind: 'image'; src: string } | { kind: 'text'; text: string } | null;

const ROWS: { title: string; party: string; status: string; tone: string }[] = [
  { title: 'Sales contract', party: 'Acme Co.', status: 'Waiting for signature', tone: 'bg-amber-50 text-amber-800 ring-amber-200' },
  { title: 'NDA', party: 'Globex Corporation', status: 'Completed', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  { title: 'Partnership agreement', party: 'Stark Industries', status: 'In review', tone: 'bg-sky-50 text-sky-700 ring-sky-200' },
  { title: 'Employment offer', party: 'Wayne Enterprises', status: 'Completed', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
];

const NAV: [IconName, string][] = [
  ['home', 'Home'],
  ['document', 'Agreements'],
  ['layers', 'Templates'],
  ['flow', 'Workflows'],
  ['users', 'Contacts'],
  ['chart', 'Reports'],
];

export function HeroShowcase() {
  const [signature, setSignature] = useState<Signature>(null);
  const [signed, setSigned] = useState(false);

  return (
    <div className="relative mx-auto w-full max-w-[640px] pb-16 pt-10 sm:pb-40">
      <div className="absolute right-0 top-0 z-20 hidden items-center gap-2 rounded-full border border-white/15 bg-[#1a1726]/90 py-1.5 pl-1.5 pr-4 text-xs text-gray-200 shadow-lg backdrop-blur sm:flex">
        <span className="flex -space-x-1.5">
          {['IN', 'US', 'UK', 'EU'].map((c) => (
            <span key={c} className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-night bg-gold text-[9px] font-bold text-ink">
              {c}
            </span>
          ))}
        </span>
        Legally binding in 4 jurisdictions
      </div>

      {/* App window */}
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl shadow-black/40 lg:[transform:perspective(1800px)_rotateY(-7deg)_rotateX(3deg)]" aria-hidden>
        <div className="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[132px_minmax(0,1fr)]">
          <div className="hidden border-r border-gray-100 bg-gray-50/80 p-3 sm:block">
            <Logo className="text-[13px] text-ink" />
            <ul className="mt-4 space-y-0.5">
              {NAV.map(([icon, label]) => (
                <li key={label} className={cx('flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px]', label === 'Agreements' ? 'bg-brand-100 font-semibold text-ink' : 'text-gray-500')}>
                  <Icon name={icon} className="h-3.5 w-3.5" />
                  {label}
                </li>
              ))}
            </ul>
          </div>
          <div className="p-4">
            <div className="flex items-center justify-between">
              <div className="h-5 w-32 rounded bg-gray-100" />
              <div className="flex items-center gap-2">
                <Icon name="bell" className="h-3.5 w-3.5 text-gray-400" />
                <span className="h-5 w-5 rounded-full bg-gradient-to-br from-brand-300 to-brand-600" />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <p className="text-[15px] font-bold text-ink">Agreements</p>
              <span className="rounded-md bg-gold px-2.5 py-1 text-[10px] font-bold text-ink">New agreement</span>
            </div>
            <div className="mt-2 flex gap-3 border-b border-gray-100 text-[10px] text-gray-500">
              {['All', 'Drafts', 'Waiting for others', 'Completed'].map((t, i) => (
                <span key={t} className={cx('pb-1.5', i === 0 && 'border-b-2 border-brand-500 font-semibold text-ink')}>
                  {t}
                </span>
              ))}
            </div>
            <ul className="mt-1 divide-y divide-gray-100">
              {ROWS.map((r) => (
                <li key={r.title} className="flex items-center gap-2.5 py-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-50 text-brand-600">
                    <Icon name="document" className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-semibold text-ink">{r.title}</p>
                    <p className="truncate text-[10px] text-gray-500">{r.party}</p>
                  </div>
                  <span className={cx('rounded-full px-2 py-0.5 text-[9px] font-medium ring-1', r.tone)}>{r.status}</span>
                  <span className="text-gray-300">⋯</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Working signature card */}
      <div className="relative z-10 mx-auto -mt-10 w-[250px] sm:absolute sm:-left-4 sm:bottom-0 sm:mt-0 lg:-left-10">
        <SignatureCard
          onInsert={(s) => {
            setSignature(s);
            setSigned(false);
          }}
        />
      </div>

      {/* Phone */}
      <div className="absolute -right-4 bottom-10 z-10 hidden w-[170px] rotate-[4deg] rounded-[2rem] border-[6px] border-night bg-white p-3 shadow-2xl shadow-black/50 sm:block lg:-right-8">
        <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-gray-200" />
        <p className="text-[12px] font-bold text-ink">Contract</p>
        <div className="mt-2 space-y-1.5">
          {[100, 90, 96, 70, 85].map((w, i) => (
            <div key={i} className="h-1 rounded bg-gray-100" style={{ width: `${w}%` }} />
          ))}
        </div>
        <div className="mt-4 flex h-14 items-center justify-center rounded-lg border border-dashed border-brand-300 bg-brand-50/60">
          {signature ? <SignaturePreview signature={signature} className="max-h-11" /> : <span className="text-[10px] text-gray-400">Signature</span>}
        </div>
        <button
          type="button"
          disabled={!signature}
          onClick={() => setSigned(true)}
          className="mt-3 w-full rounded-lg bg-gold py-1.5 text-[11px] font-bold text-ink disabled:opacity-50"
        >
          {signed ? 'Signed ✓' : 'Sign & complete'}
        </button>
      </div>
    </div>
  );
}

function SignaturePreview({ signature, className }: { signature: NonNullable<Signature>; className?: string }) {
  return signature.kind === 'image' ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={signature.src} alt="Your signature" className={cx('object-contain', className)} />
  ) : (
    <span className={cx('truncate font-script text-2xl text-[#1d1a4d]', className)}>{signature.text}</span>
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
    ctx.lineWidth = 2.2;
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
    <div className="rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-2xl shadow-black/40">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-bold text-ink">Add your signature</p>
        <button type="button" onClick={clear} className="text-[11px] font-medium text-gray-500 hover:text-ink">
          Clear
        </button>
      </div>
      <div className="mt-2 grid grid-cols-3 rounded-lg bg-gray-100 p-0.5 text-[11px]" role="tablist" aria-label="Signature style">
        {(['draw', 'type', 'upload'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx('rounded-md py-1 font-medium capitalize', tab === t ? 'bg-white text-ink shadow-sm' : 'text-gray-500')}>
            {t}
          </button>
        ))}
      </div>
      <div className="mt-2 h-24 overflow-hidden rounded-lg border border-gray-200 bg-white">
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
            <p className="mt-1 h-8 truncate font-script text-2xl text-[#1d1a4d]">{typed}</p>
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
      <button type="button" disabled={!ready} onClick={insert} className="mt-3 w-full rounded-lg bg-gold py-2 text-[12px] font-bold text-ink hover:brightness-105 disabled:opacity-50">
        Insert signature
      </button>
      <p className="mt-2 text-center text-[10px] text-gray-400">Try it. This demo stays in your browser; {brand.name} signing works the same way.</p>
    </div>
  );
}
