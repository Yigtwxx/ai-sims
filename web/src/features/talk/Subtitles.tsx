'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

import { activeWordIndex, type SubtitleLine } from './subtitleSink';

/** How long the last line lingers after its audio ends (bridges sentence gaps). */
const LINGER_MS = 700;

/**
 * Film-style subtitles under the character, synced to what is being heard:
 * spoken words turn ink, the current one carries a thin amber underline.
 */
export function Subtitles({ line, lang }: { line: SubtitleLine | null; lang: string }) {
  const reduceMotion = useReducedMotion();
  const [shown, setShown] = useState<SubtitleLine | null>(null);
  const [active, setActive] = useState(-1);
  const frame = useRef(0);

  // Hold the last line a moment after it ends, so consecutive sentences don't flicker.
  useEffect(() => {
    const timer = window.setTimeout(() => setShown(line), line ? 0 : LINGER_MS);
    return () => window.clearTimeout(timer);
  }, [line]);

  useEffect(() => {
    if (!line) return undefined;
    const words = line.text.split(/\s+/).filter(Boolean);
    const tick = () => {
      const elapsed = (performance.now() - line.startedAt) / 1000;
      setActive(activeWordIndex(line, words, elapsed));
      if (elapsed < line.duration) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [line]);

  const words = shown ? shown.text.split(/\s+/).filter(Boolean) : [];

  return (
    <div className="pointer-events-none flex min-h-[4.5rem] items-end justify-center">
      <AnimatePresence mode="wait">
        {shown ? (
          <motion.p
            key={shown.id}
            lang={lang}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="rounded-tile bg-backstage-deep/70 text-title text-ink-faint max-w-[46ch] px-5 py-3 text-center leading-snug"
          >
            {words.map((word, index) => (
              <span key={index}>
                <span
                  className={cn(
                    'relative inline-block transition-colors duration-150',
                    index <= active && 'text-ink',
                  )}
                >
                  {word}
                  {index === active ? (
                    <span
                      aria-hidden="true"
                      className="bg-marquee absolute inset-x-0 -bottom-0.5 h-0.5 rounded-full"
                    />
                  ) : null}
                </span>{' '}
              </span>
            ))}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
