'use client';

import { AnimatePresence, motion } from 'motion/react';
import type { CSSProperties } from 'react';

import { cn } from '@/lib/utils';

/**
 * A quiet slate in a lower corner of the stage while the character is on its
 * way (first load) or catching up with an edit: a tungsten light crossing a
 * hairline beside the caption, on the same dark pill as the drag hint so it
 * reads over any backdrop and never over the character. It never blocks the
 * stage, waits 300 ms before showing (a fast load never flashes it) and fades
 * out once it is done. The caller places it (`className`, `style`).
 */
export function StageLoading({
  show,
  label,
  className,
  style,
}: {
  show: boolean;
  label: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          key="stage-loading"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0, transition: { delay: 0.3, duration: 0.5 } }}
          exit={{ opacity: 0, transition: { duration: 0.35 } }}
          className={cn('pointer-events-none', className)}
          style={style}
        >
          <span className="border-hairline bg-backstage/75 text-label text-ink-muted inline-flex max-w-full items-center gap-2.5 rounded-full border py-1.5 pr-4 pl-3">
            <span
              aria-hidden="true"
              className="bg-hairline after:animate-skeleton-sweep relative h-px w-6 shrink-0 overflow-hidden after:absolute after:inset-0 after:bg-[linear-gradient(90deg,transparent,rgb(255_226_176/0.9),transparent)]"
            />
            {/* The label swaps (loading, then updating) without remounting the slate. */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={label}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.2 } }}
                exit={{ opacity: 0, transition: { duration: 0.12 } }}
                className="truncate"
              >
                {label}
              </motion.span>
            </AnimatePresence>
          </span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
