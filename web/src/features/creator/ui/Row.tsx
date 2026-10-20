'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { ChevronIcon } from './icons';

interface RowProps {
  title: string;
  /** Short muted note beside the title (e.g. option count or current value). */
  meta?: string;
  active: boolean;
  dimmed: boolean;
  onActivate: () => void;
  /** Horizontally scrolling tiles. */
  tiles?: ReactNode;
  /** Controls rendered under the tiles (swatches, sliders). */
  children?: ReactNode;
}

/**
 * One category of the catalog wall. The active row lifts; the others dim.
 * Tiles scroll horizontally with snap, edge fades, and hover arrows.
 */
export function Row({ title, meta, active, dimmed, onActivate, tiles, children }: RowProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setEdges({
      start: el.scrollLeft <= 2,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2,
    });
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  const page = (direction: 1 | -1) => {
    const el = scroller.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  const fade = `linear-gradient(to right, ${edges.start ? '#000' : 'transparent'} 0, #000 32px, #000 calc(100% - 32px), ${edges.end ? '#000' : 'transparent'} 100%)`;

  return (
    <section
      onPointerEnter={onActivate}
      onFocusCapture={onActivate}
      data-active={active || undefined}
      className={`group/row ease-out-expo relative px-6 py-4 transition-[opacity,background-color] duration-500 ${
        dimmed ? 'opacity-55' : 'opacity-100'
      } ${active ? 'bg-backstage-raised/40' : ''}`}
    >
      <header className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-ink text-[15px] font-semibold tracking-[-0.005em]">{title}</h2>
        {meta && <span className="text-ink-muted text-[13px] tabular-nums">{meta}</span>}
      </header>

      {tiles && (
        <div className="relative -mx-6">
          <div
            ref={scroller}
            onScroll={measure}
            role="radiogroup"
            aria-label={title}
            className="flex snap-x snap-mandatory scroll-px-6 scrollbar-none gap-3 overflow-x-auto overflow-y-visible px-6 py-2"
            style={{ maskImage: fade, WebkitMaskImage: fade }}
          >
            {tiles}
          </div>
          {!edges.start && <EdgeButton side="left" onClick={() => page(-1)} />}
          {!edges.end && <EdgeButton side="right" onClick={() => page(1)} />}
        </div>
      )}
      {children && <div className={tiles ? 'mt-3' : ''}>{children}</div>}
    </section>
  );
}

function EdgeButton({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden
      onClick={onClick}
      className={`bg-backstage/90 text-ink hover:bg-backstage-lift absolute top-1/2 z-20 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full opacity-0 shadow-[0_6px_18px_rgba(0,0,0,0.5)] ring-1 ring-white/10 transition-opacity duration-300 group-hover/row:opacity-100 ${
        side === 'left' ? 'left-2' : 'right-2'
      }`}
    >
      <ChevronIcon direction={side} />
    </button>
  );
}
