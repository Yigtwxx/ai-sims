'use client';

import { motion } from 'motion/react';

interface PremiereOverlayProps {
  name: string;
  labels: { tagline: string; start: string; edit: string };
  onStart: () => void;
  onEdit: () => void;
}

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * The premiere: house lights dim to a spotlight on the character, the name
 * lands as a title card, then the two exits appear. Runs once per "Bitti".
 */
export function PremiereOverlay({ name, labels, onStart, onEdit }: PremiereOverlayProps) {
  return (
    <motion.div
      className="absolute inset-0 z-30"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.4 } }}
      transition={{ duration: 0.9, ease: EASE }}
      role="dialog"
      aria-modal="false"
      aria-label={name}
    >
      {/* House lights: darken the edges, keep a soft pool on the character. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(42%_62%_at_50%_44%,transparent_0%,rgba(8,7,9,0.25)_55%,rgba(8,7,9,0.88)_100%)]" />

      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center px-6 pb-14 text-center">
        <motion.p
          className="text-ink-muted text-[15px] font-medium"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7, duration: 0.6, ease: EASE }}
        >
          {labels.tagline}
        </motion.p>
        <motion.h1
          className="font-display text-ink mt-2 text-[clamp(3.5rem,9vw,7.5rem)] leading-[0.88]"
          initial={{ opacity: 0, y: 30, clipPath: 'inset(0 0 100% 0)' }}
          animate={{ opacity: 1, y: 0, clipPath: 'inset(0 0 -10% 0)' }}
          transition={{ delay: 0.9, duration: 0.9, ease: EASE }}
        >
          {name}
        </motion.h1>
        <motion.span
          className="bg-marquee mt-4 h-[3px] w-24 origin-center rounded-full"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 1.35, duration: 0.7, ease: EASE }}
        />
        <motion.div
          className="mt-8 flex items-center gap-3"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.7, duration: 0.6, ease: EASE }}
        >
          <button
            type="button"
            onClick={onEdit}
            className="rounded-control text-ink-muted hover:text-ink h-12 px-5 text-[15px] font-medium ring-1 ring-white/15 transition-colors hover:bg-white/5"
          >
            {labels.edit}
          </button>
          <button
            type="button"
            onClick={onStart}
            autoFocus
            className="rounded-control bg-marquee font-display text-backstage ease-out-expo hover:bg-marquee-deep h-12 px-6 text-[1.35rem] transition-[background-color,scale] duration-300 active:scale-[0.98]"
          >
            {labels.start}
          </button>
        </motion.div>
      </div>
    </motion.div>
  );
}
