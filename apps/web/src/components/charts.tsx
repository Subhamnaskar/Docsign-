'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Small SVG charts for the reports page. Colours come from the validated
 * reference palette (categorical slots 1–2; blue ordinal ramp), checked with the
 * dataviz palette validator against the white surface.
 */
export const SERIES = ['#2a78d6', '#eb6834'];
export const ORDINAL_BLUE = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab'];
const GRID = '#ececea';
const AXIS_TEXT = '#6b7280';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].find((m) => (m * pow) * 4 >= v)! * pow;
  return step * 4;
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-gray-600">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded" style={{ background: i.color, height: 2 }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** Multi-series line chart (weeks by default) with a crosshair tooltip. */
export function LineChart({
  data,
  series,
  formatX,
  height = 220,
  period = 'week',
}: {
  data: { x: string; values: number[] }[];
  series: { label: string; color: string }[];
  formatX: (x: string) => string;
  height?: number;
  period?: 'week' | 'day';
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { top: 12, right: 64, bottom: 24, left: 32 };
  const w = Math.max(width - pad.left - pad.right, 10);
  const h = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(1, ...data.flatMap((d) => d.values)));
  const x = (i: number) => (data.length <= 1 ? w / 2 : (i / (data.length - 1)) * w);
  const y = (v: number) => h - (v / max) * h;
  const ticks = [0, max / 4, max / 2, (3 * max) / 4, max];
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(w / 70))));

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - rect.left) / rect.width) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  }

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`Line chart: ${series.map((s) => s.label).join(' and ')} per ${period}`}>
          <g transform={`translate(${pad.left},${pad.top})`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={0} x2={w} y1={y(t)} y2={y(t)} stroke={GRID} />
                <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={AXIS_TEXT}>
                  {Math.round(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) =>
              i % labelEvery === 0 ? (
                <text key={d.x} x={x(i)} y={h + 16} textAnchor="middle" fontSize={11} fill={AXIS_TEXT}>
                  {formatX(d.x)}
                </text>
              ) : null,
            )}
            {series.map((s, si) => (
              <g key={s.label}>
                <polyline
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={data.map((d, i) => `${x(i)},${y(d.values[si])}`).join(' ')}
                />
                {/* Direct label at the line end; text stays in ink colour */}
                {data.length > 0 && (
                  <text x={x(data.length - 1) + 8} y={y(data[data.length - 1].values[si])} dy="0.32em" fontSize={11} fill="#374151">
                    {s.label}
                  </text>
                )}
              </g>
            ))}
            {hover !== null && (
              <g pointerEvents="none">
                <line x1={x(hover)} x2={x(hover)} y1={0} y2={h} stroke="#9ca3af" strokeDasharray="3 3" />
                {series.map((s, si) => (
                  <circle key={s.label} cx={x(hover)} cy={y(data[hover].values[si])} r={4.5} fill={s.color} stroke="#fff" strokeWidth={2} />
                ))}
              </g>
            )}
            <rect width={w} height={h} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
          </g>
        </svg>
      )}
      {hover !== null && width > 0 && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg"
          style={{ left: Math.min(pad.left + x(hover) + 12, width - 150), top: pad.top }}
        >
          <div className="font-medium text-gray-900">{period === 'week' ? 'Week of ' : ''}{formatX(data[hover].x)}</div>
          {series.map((s, si) => (
            <div key={s.label} className="mt-1 flex items-center gap-2 text-gray-600">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.label}
              <span className="ml-auto pl-3 font-semibold tabular-nums text-gray-900">{data[hover].values[si]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Horizontal bars with labels and values; one colour per bar (single series or ordinal ramp). */
export function HBars({ rows, colors, format }: { rows: { label: string; value: number; note?: string }[]; colors: string[]; format?: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={r.label} className="grid grid-cols-[110px_1fr_auto] items-center gap-3 text-sm" onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
          <span className="truncate text-gray-600">{r.label}</span>
          <div className="relative h-5">
            <div
              className="absolute inset-y-0 left-0 rounded-r"
              style={{ width: `${Math.max((r.value / max) * 100, r.value > 0 ? 1 : 0)}%`, background: colors[Math.min(i, colors.length - 1)], borderRadius: '0 4px 4px 0' }}
            />
            {hover === i && r.note && (
              <div className="pointer-events-none absolute -top-8 left-0 z-10 whitespace-nowrap rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 shadow">
                {r.note}
              </div>
            )}
          </div>
          <span className="w-16 text-right font-semibold tabular-nums text-gray-900">{format ? format(r.value) : r.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Card with a chart / table toggle so every chart has an accessible table view. */
export function ChartCard({ title, subtitle, legend, chart, table }: { title: string; subtitle?: string; legend?: ReactNode; chart: ReactNode; table: ReactNode }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-gray-900">{title}</h2>
          {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
        </div>
        <div className="flex rounded-md bg-gray-100 p-0.5 text-xs">
          {(['chart', 'table'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`rounded px-2.5 py-1 font-medium capitalize ${view === v ? 'bg-white shadow-sm' : 'text-gray-500'}`}>
              {v}
            </button>
          ))}
        </div>
      </div>
      {legend && view === 'chart' && <div className="mt-3">{legend}</div>}
      <div className="mt-4">{view === 'chart' ? chart : table}</div>
    </div>
  );
}
