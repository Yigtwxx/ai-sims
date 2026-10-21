'use client';

import { AnimatePresence, motion } from 'motion/react';
import type { CSSProperties } from 'react';

import { cn } from '@/lib/utils';

/**
 * Until the character first stands on the stage: a quiet caption with a
 * tungsten light crossing a hairline. It never blocks the stage, waits 300 ms
 * before showing (a fast load never flashes it) and fades out once it is done.
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
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { delay: 0.3, duration: 0.6 } }}
          exit={{ opacity: 0, transition: { duration: 0.4 } }}
          className={cn('pointer-events-none flex flex-col items-center gap-3', className)}
          style={style}
        >
          <span className="text-label text-ink-muted">{label}</span>
          <span
            aria-hidden="true"
            className="bg-hairline after:animate-skeleton-sweep relative h-px w-24 overflow-hidden after:absolute after:inset-0 after:bg-[linear-gradient(90deg,transparent,rgb(255_226_176/0.85),transparent)]"
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
