'use client';

import { useMotionValueEvent, useScroll } from 'motion/react';
import { useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** Scroll distance after which the header picks up its backstage ground. */
const SOLID_AFTER_PX = 24;

/**
 * Fixed site header. Transparent over the hero stage; once the page scrolls it
 * gains a backstage ground and a hairline. Named for view transitions so it
 * stays anchored while page content changes.
 */
export function HeaderFrame({ children }: { children: ReactNode }) {
  const { scrollY } = useScroll();
  const [solid, setSolid] = useState(false);

  useMotionValueEvent(scrollY, 'change', (y) => {
    const next = y > SOLID_AFTER_PX;
    setSolid((previous) => (previous === next ? previous : next));
  });

  return (
    <header
      data-solid={solid || undefined}
      style={{ viewTransitionName: 'site-header' }}
      className={cn(
        // `right-scroll-bar-position`: the dialog scroll lock (react-remove-scroll)
        // pads this fixed bar by the removed scrollbar width, so it doesn't jump.
        'right-scroll-bar-position ease-out-quint fixed inset-x-0 top-0 z-(--z-header) h-(--header-h) border-b border-transparent transition-[background-color,border-color] duration-300',
        solid &&
          'border-hairline/70 bg-backstage/92 supports-[backdrop-filter]:bg-backstage/80 supports-[backdrop-filter]:backdrop-blur-md',
      )}
    >
      <div className="mx-auto flex h-full max-w-[1440px] items-center px-5 md:px-8 lg:px-12">
        {children}
      </div>
    </header>
  );
}
