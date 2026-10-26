'use client';

import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PageCanvas, usePdf } from './PdfPages';
import { cx, Spinner } from './ui';

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/**
 * A PDF reader: page thumbnails (wide screens), zoom, "page x of n", download
 * and print. `toolbar` adds controls at the start (document and version pickers).
 */
export function DocumentViewer({
  url,
  filename,
  toolbar,
  footer,
  downloads = true,
  heightClassName = 'h-[calc(100dvh-9rem)]',
}: {
  url: string;
  filename: string;
  toolbar?: ReactNode;
  footer?: ReactNode;
  /** Download and print buttons (the mobile app shares files its own way) */
  downloads?: boolean;
  /** Height of the reader; defaults to the window below the site's header */
  heightClassName?: string;
}) {
  const { pdf, error } = usePdf(url);
  const sizes = usePageSizes(pdf);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [fitWidth, setFitWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [current, setCurrent] = useState(0);

  // "Fit width" follows the reading area; zoom multiplies it
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setFitWidth(Math.min(entry.contentRect.width - 32, 900)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The current page is the last one whose top has passed the upper third of the
  // reading area (zoomed pages can be taller than the screen, so visibility won't do)
  function onScroll() {
    const root = scrollRef.current;
    if (!root) return;
    const line = root.scrollTop + root.clientHeight / 3;
    let page = 0;
    pageRefs.current.forEach((el, i) => {
      if (el && el.offsetTop <= line) page = i;
    });
    // At the very bottom the last page is the one being read
    if (root.scrollTop + root.clientHeight >= root.scrollHeight - 4) page = sizes.length - 1;
    setCurrent(page);
  }

  const goTo = (i: number) => pageRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const width = Math.round(fitWidth * zoom);

  function print() {
    // The browser's own print dialog for the PDF, without leaving the page
    const frame = document.createElement('iframe');
    frame.style.display = 'none';
    frame.src = url;
    frame.onload = () => {
      frame.contentWindow?.print();
      setTimeout(() => frame.remove(), 60_000);
    };
    document.body.appendChild(frame);
  }

  return (
    <div className={cx('flex min-h-[420px] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white', heightClassName)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-3 py-2">
        {toolbar}
        <div className="ml-auto flex items-center gap-1">
          <span className="mr-2 text-sm tabular-nums text-gray-500">{sizes.length ? `Page ${current + 1} of ${sizes.length}` : ''}</span>
          <ToolButton label="Zoom out" disabled={zoom === ZOOMS[0]} onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom as (typeof ZOOMS)[number]) - 1)])}>
            −
          </ToolButton>
          <button onClick={() => setZoom(1)} className="min-w-[3.5rem] rounded-md px-2 py-1 text-sm tabular-nums text-gray-700 hover:bg-gray-100" title="Fit to width">
            {Math.round(zoom * 100)}%
          </button>
          <ToolButton label="Zoom in" disabled={zoom === ZOOMS[ZOOMS.length - 1]} onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom as (typeof ZOOMS)[number]) + 1)])}>
            +
          </ToolButton>
          {downloads && (
            <>
              <a href={url} download={filename} className="ml-2 rounded-md bg-gold px-3 py-1.5 text-sm font-semibold text-ink hover:opacity-90">
                Download
              </a>
              <button onClick={print} className="hidden rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50 sm:block">
                Print
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {sizes.length > 1 && pdf && (
          <nav aria-label="Pages" className="hidden w-36 shrink-0 space-y-3 overflow-y-auto border-r border-gray-200 bg-gray-50 p-3 lg:block">
            {sizes.map((s, i) => (
              <button key={i} onClick={() => goTo(i)} className="block w-full text-center" aria-label={`Page ${i + 1}`}>
                <div className={cx('relative mx-auto w-24 bg-white shadow-sm ring-1', i === current ? 'ring-2 ring-brand-500' : 'ring-gray-200')} style={{ aspectRatio: `${s.width} / ${s.height}` }}>
                  <PageCanvas pdf={pdf} index={i} width={96} />
                </div>
                <span className={cx('mt-1 block text-xs', i === current ? 'font-semibold text-brand-700' : 'text-gray-500')}>{i + 1}</span>
              </button>
            ))}
          </nav>
        )}

        <div ref={scrollRef} onScroll={onScroll} className="relative min-w-0 flex-1 overflow-auto bg-gray-100 p-4">
          {error ? (
            <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">Could not display this document: {error}</div>
          ) : !pdf || !sizes.length || !width ? (
            <div className="flex h-full items-center justify-center text-gray-400">
              <Spinner />
            </div>
          ) : (
            <div className="mx-auto flex flex-col gap-4" style={{ width }}>
              {sizes.map((s, i) => (
                <div
                  key={i}
                  ref={(el) => {
                    pageRefs.current[i] = el;
                  }}
                  data-page={i}
                  className="relative bg-white shadow-md ring-1 ring-gray-200"
                  style={{ aspectRatio: `${s.width} / ${s.height}` }}
                >
                  <PageCanvas pdf={pdf} index={i} width={width} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {footer}
    </div>
  );
}

function ToolButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} disabled={disabled} className="h-8 w-8 rounded-md text-lg leading-none text-gray-700 hover:bg-gray-100 disabled:opacity-40">
      {children}
    </button>
  );
}

/** Each page's size (as displayed, rotation included), read from the PDF itself. */
function usePageSizes(pdf: PDFDocumentProxy | null) {
  const [sizes, setSizes] = useState<{ width: number; height: number }[]>([]);
  useEffect(() => {
    if (!pdf) return setSizes([]);
    let cancelled = false;
    Promise.all(Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1).then((p) => p.getViewport({ scale: 1 })))).then(
      (views) => !cancelled && setSizes(views.map((v) => ({ width: v.width, height: v.height }))),
    );
    return () => {
      cancelled = true;
    };
  }, [pdf]);
  return sizes;
}
