'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { cx } from '@/components/ui';

/** Rises into view the first time it scrolls on screen. */
export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          el.classList.add('in');
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={cx('reveal', className)} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/** Twinkling dots and drifting gold glows behind a dark section. */
export function Starfield({ count = 70 }: { count?: number }) {
  // Fixed pseudo-random positions so the server and browser render the same dots
  const stars = Array.from({ length: count }, (_, i) => {
    // Rounded: Math.sin differs in the last digits between server and browser
    const r = (n: number) => Math.round((((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1) + 1) % 1 * 1000) / 1000;
    return { left: r(1) * 100, top: r(2) * 100, size: r(3) > 0.85 ? 2.5 : 1.5, delay: r(4) * 4 };
  });
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="drift absolute -left-24 top-10 h-[28rem] w-[28rem] rounded-full bg-[#b8860b]/20 blur-3xl" />
      <div className="drift absolute -right-32 bottom-0 h-[32rem] w-[32rem] rounded-full bg-[#6d4cff]/15 blur-3xl" style={{ animationDelay: '-7s' }} />
      {stars.map((s, i) => (
        <span key={i} className="twinkle absolute rounded-full bg-white" style={{ left: `${s.left}%`, top: `${s.top}%`, width: s.size, height: s.size, animationDelay: `${s.delay}s` }} />
      ))}
    </div>
  );
}

const ACTIVITY = [
  { tag: 'Just signed', title: 'Rental agreement', note: 'Bengaluru · sealed PDF sent', tone: 'bg-emerald-100 text-emerald-700', icon: '✓' },
  { tag: 'Aadhaar eSign', title: 'Loan agreement', note: 'Mumbai · OTP verified', tone: 'bg-amber-100 text-amber-700', icon: '₹' },
  { tag: 'Offer accepted', title: 'Joining letter', note: 'Pune · signed on phone', tone: 'bg-indigo-100 text-indigo-700', icon: '✎' },
  { tag: 'Completed', title: 'NDA · Globex', note: 'London · 3 of 3 signed', tone: 'bg-sky-100 text-sky-700', icon: '★' },
];

/** "Happening now" cards that take turns, as on nuronixai.in. */
export function LiveToasts({ className }: { className?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % ACTIVITY.length), 3200);
    return () => clearInterval(t);
  }, []);
  const a = ACTIVITY[i];
  return (
    <div className={className} aria-live="polite">
      <div key={i} className="toast-in flex items-center gap-3 rounded-2xl bg-white/95 p-3 pr-5 text-ink shadow-2xl ring-1 ring-black/5 backdrop-blur">
        <span className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg font-bold', a.tone)}>{a.icon}</span>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-700">{a.tag}</p>
          <p className="text-sm font-semibold">{a.title}</p>
          <p className="text-xs text-gray-500">{a.note}</p>
        </div>
      </div>
      <div className="mt-2 flex justify-end gap-1.5">
        {ACTIVITY.map((_, n) => (
          <span key={n} className={cx('h-1 rounded-full transition-all', n === i ? 'w-6 bg-white' : 'w-2 bg-white/40')} />
        ))}
      </div>
    </div>
  );
}

/** Items scrolling sideways forever (the list is drawn twice for a seamless loop). */
export function Marquee({ children }: { children: ReactNode }) {
  return (
    <div className="relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)]">
      <div className="marquee flex w-max items-center gap-14 pr-14">
        {children}
        <div aria-hidden className="flex items-center gap-14">
          {children}
        </div>
      </div>
    </div>
  );
}
