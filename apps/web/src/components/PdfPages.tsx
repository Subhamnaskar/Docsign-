'use client';

import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { signerSessionHeaders } from '@/lib/api';
import type { PageInfo } from '@/lib/types';
import { Spinner } from './ui';

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;
function loadPdfjs() {
  // Loaded lazily in the browser only: pdf.js touches DOM APIs at import time
  pdfjsPromise ??= import('pdfjs-dist').then((m) => {
    m.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    return m;
  });
  return pdfjsPromise;
}

export function usePdf(url: string | null) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    let destroy: (() => void) | undefined;
    setPdf(null);
    setError(null);
    loadPdfjs().then((pdfjs) => {
      if (cancelled) return;
      const task = pdfjs.getDocument({ url, withCredentials: true, httpHeaders: url.includes('/signing/') ? signerSessionHeaders() : undefined });
      destroy = () => void task.destroy();
      task.promise.then(
        (doc) => !cancelled && setPdf(doc),
        (err) => !cancelled && setError(err?.message ?? 'Could not load document'),
      );
    });
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [url]);
  return { pdf, error };
}

/** Displayed size, accounting for page rotation. */
export function displaySize(p: PageInfo) {
  const rotated = ((p.rotation % 360) + 360) % 180 === 90;
  return rotated ? { width: p.height, height: p.width } : { width: p.width, height: p.height };
}

export function PageCanvas({ pdf, index, width }: { pdf: PDFDocumentProxy; index: number; width: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (width <= 0) return;
    let task: RenderTask | undefined;
    let cancelled = false;
    pdf.getPage(index + 1).then((page) => {
      if (cancelled || !canvasRef.current) return;
      const base = page.getViewport({ scale: 1 });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: (width / base.width) * dpr });
      const canvas = canvasRef.current;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      task = page.render({ canvasContext: canvas.getContext('2d')!, viewport });
      task.promise.catch(() => {});
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, index, width]);
  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />;
}

/**
 * Renders every page of a PDF at the container's width. `overlay(pageIndex)`
 * draws on top of each page in a box whose coordinates match the page (0..100%).
 */
export function PdfPages({
  url,
  pages,
  overlay,
  onPageClick,
  maxWidth = 860,
  pageClassName,
}: {
  url: string;
  pages: PageInfo[];
  overlay?: (pageIndex: number) => ReactNode;
  onPageClick?: (pageIndex: number, x: number, y: number) => void;
  maxWidth?: number;
  pageClassName?: string;
}) {
  const { pdf, error } = usePdf(url);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.min(entry.contentRect.width, maxWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxWidth]);

  if (error) return <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">Could not display this document: {error}</div>;

  return (
    <div ref={containerRef} className="w-full">
      <div className="mx-auto flex flex-col gap-4" style={{ width: width || '100%' }}>
        {pages.map((p, i) => {
          const size = displaySize(p);
          return (
            <div key={i} className={pageClassName}>
              <div
                className="relative select-none bg-white shadow-md ring-1 ring-gray-200"
                style={{ aspectRatio: `${size.width} / ${size.height}` }}
                onClick={(e) => {
                  if (!onPageClick || e.target !== e.currentTarget.querySelector('[data-page-surface]')) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  onPageClick(i, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
                }}
              >
                {pdf ? (
                  <PageCanvas pdf={pdf} index={i} width={width} />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-gray-300">
                    <Spinner />
                  </div>
                )}
                <div data-page-surface className="absolute inset-0" />
                {overlay?.(i)}
              </div>
              <div className="mt-1 text-center text-xs text-gray-400">
                Page {i + 1} of {pages.length}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
