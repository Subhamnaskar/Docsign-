'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, cx, Input } from './ui';

type Mode = 'draw' | 'type' | 'upload';

const INK = '#111c59';

/** Trims transparent margins so the signature fills its field when stamped. */
function trimCanvas(src: HTMLCanvasElement): string | null {
  const ctx = src.getContext('2d')!;
  const { width, height } = src;
  const data = ctx.getImageData(0, 0, width, height).data;
  let top = height, left = width, right = 0, bottom = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 10) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < left || bottom < top) return null;
  const pad = 6;
  const w = right - left + 1 + pad * 2;
  const h = bottom - top + 1 + pad * 2;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')!.drawImage(src, left - pad, top - pad, w, h, 0, 0, w, h);
  return out.toDataURL('image/png');
}

function DrawPad({ onChange }: { onChange: (png: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * dpr;
    c.height = c.offsetHeight * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.4;
  }, []);

  const point = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div>
      <div className="relative rounded-lg border border-gray-300 bg-white">
        <canvas
          ref={ref}
          className="h-44 w-full touch-none cursor-crosshair"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drawing.current = true;
            last.current = point(e);
          }}
          onPointerMove={(e) => {
            if (!drawing.current || !last.current) return;
            const p = point(e);
            const ctx = ref.current!.getContext('2d')!;
            ctx.beginPath();
            ctx.moveTo(last.current.x, last.current.y);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            last.current = p;
            if (empty) setEmpty(false);
          }}
          onPointerUp={() => {
            drawing.current = false;
            last.current = null;
            onChange(trimCanvas(ref.current!));
          }}
        />
        <div className="pointer-events-none absolute inset-x-6 bottom-10 border-b border-dashed border-gray-300" />
        {empty && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-gray-400">Draw your signature here</div>}
      </div>
      <button
        type="button"
        className="mt-2 text-sm text-gray-500 hover:text-gray-800"
        onClick={() => {
          const c = ref.current!;
          c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
          setEmpty(true);
          onChange(null);
        }}
      >
        Clear
      </button>
    </div>
  );
}

function renderTyped(text: string): string | null {
  if (!text.trim()) return null;
  const c = document.createElement('canvas');
  const font = `64px "Segoe Script", "Brush Script MT", "Lucida Handwriting", cursive`;
  const ctx = c.getContext('2d')!;
  ctx.font = font;
  c.width = Math.ceil(ctx.measureText(text).width) + 40;
  c.height = 110;
  ctx.font = font;
  ctx.fillStyle = INK;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 20, 55);
  return trimCanvas(c);
}

async function normaliseUpload(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Unsupported image'));
      i.src = url;
    });
    const scale = Math.min(1, 600 / img.width, 200 / img.height);
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Draw / type / upload a signature; produces a PNG data URL. */
export function SignaturePad({
  defaultText,
  kind,
  onAdopt,
  onCancel,
}: {
  defaultText: string;
  kind: 'signature' | 'initials';
  onAdopt: (png: string) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<Mode>('type');
  const [typed, setTyped] = useState(defaultText);
  const [drawn, setDrawn] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const typedPng = mode === 'type' ? renderTyped(typed) : null;
  const result = mode === 'draw' ? drawn : mode === 'type' ? typedPng : uploaded;

  return (
    <div>
      <div className="mb-4 flex gap-1 rounded-lg bg-gray-100 p-1 text-sm">
        {(['type', 'draw', 'upload'] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cx('flex-1 rounded-md px-3 py-1.5 font-medium capitalize', mode === m ? 'bg-white shadow-sm' : 'text-gray-600')}
          >
            {m}
          </button>
        ))}
      </div>

      {mode === 'type' && (
        <div>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={kind === 'initials' ? 6 : 60} aria-label={`Type your ${kind}`} />
          <div className="mt-3 flex h-28 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-white">
            {typedPng ? <img src={typedPng} alt="Signature preview" className="max-h-24 max-w-full" /> : <span className="text-sm text-gray-400">Preview</span>}
          </div>
        </div>
      )}
      {mode === 'draw' && <DrawPad onChange={setDrawn} />}
      {mode === 'upload' && (
        <div>
          <input
            type="file"
            accept="image/png,image/jpeg"
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setError(null);
              try {
                setUploaded(await normaliseUpload(f));
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          />
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          {uploaded && (
            <div className="mt-3 flex h-28 items-center justify-center rounded-lg border border-gray-200 bg-white">
              <img src={uploaded} alt="Uploaded signature" className="max-h-24 max-w-full" />
            </div>
          )}
        </div>
      )}

      <p className="mt-4 text-xs text-gray-500">
        By selecting Adopt, I agree that this {kind} is the electronic representation of my {kind} for all purposes when I use it on documents.
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={!result} onClick={() => result && onAdopt(result)}>
          Adopt and sign
        </Button>
      </div>
    </div>
  );
}
