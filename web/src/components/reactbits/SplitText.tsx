'use client';

/*
 * SplitText: adapted from React Bits "SplitText-TS-TW" (https://reactbits.dev,
 * MIT + Commons Clause). Trimmed to the one move this site uses: words (or
 * chars/lines) rising out of a mask like a title card, on load or when
 * scrolled into view. Built on GSAP SplitText, which also sets aria-label on
 * the element and hides the split pieces from assistive tech.
 *
 * Visibility contract: the element carries `data-split-reveal`; globals.css
 * hides it (only when JS runs and motion is allowed) until `data-split-ready`
 * is set, with a CSS failsafe so the text can never stay hidden.
 */
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText as GSAPSplitText } from 'gsap/SplitText';
import { useEffect, useRef, useState, type CSSProperties } from 'react';

import { GSAP_EASE, prefersReducedMotion } from '@/components/motion/tokens';
import { cn } from '@/lib/utils';

gsap.registerPlugin(ScrollTrigger, GSAPSplitText, useGSAP);

type SplitUnit = 'words' | 'chars' | 'lines';

export interface SplitTextProps {
  text: string;
  id?: string;
  as?: 'h1' | 'h2' | 'h3' | 'p' | 'span';
  className?: string;
  style?: CSSProperties;
  splitType?: SplitUnit;
  /** 'load' plays immediately, 'view' when the element scrolls into view. */
  trigger?: 'load' | 'view';
  /** Seconds before the first piece moves. */
  delay?: number;
  /** Seconds between pieces. */
  stagger?: number;
  /** Seconds per piece. */
  duration?: number;
  onComplete?: () => void;
}

const fontsReady = () =>
  typeof document !== 'undefined' && (!document.fonts || document.fonts.status === 'loaded');

export function SplitText({
  text,
  id,
  as: Tag = 'p',
  className,
  style,
  splitType = 'words',
  trigger = 'view',
  delay = 0,
  stagger = 0.06,
  duration = 1.1,
  onComplete,
}: SplitTextProps) {
  const ref = useRef<HTMLElement>(null);
  const onCompleteRef = useRef(onComplete);
  // Not rendered, only gates the split, so reading the document on the client is safe.
  const [fontsLoaded, setFontsLoaded] = useState(fontsReady);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  });

  useEffect(() => {
    if (fontsLoaded) return undefined;
    let active = true;
    void document.fonts.ready.then(() => {
      if (active) setFontsLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [fontsLoaded]);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el || !fontsLoaded) return;

      if (prefersReducedMotion()) {
        el.setAttribute('data-split-ready', '');
        onCompleteRef.current?.();
        return;
      }

      const split = new GSAPSplitText(el, {
        type: splitType,
        mask: splitType,
        autoSplit: splitType === 'lines',
        smartWrap: true,
        reduceWhiteSpace: false,
        // Spans keep the markup valid inside headings and inline parents.
        tag: 'span',
        // A heading can carry aria-label; generic spans cannot, so leave their
        // split text readable instead of hiding it behind a label.
        aria: /^h[1-6]$/.test(Tag) ? 'auto' : 'none',
        wordsClass: 'split-word',
        charsClass: 'split-char',
        linesClass: 'split-line',
        onSplit: (self: GSAPSplitText) => {
          const pieces = self[splitType];
          el.setAttribute('data-split-ready', '');
          // On-load reveals are timed from navigation start, so a slow
          // hydration never pushes the title behind the CSS-timed copy.
          const start = trigger === 'load' ? Math.max(0, delay - performance.now() / 1000) : delay;
          return gsap.from(pieces, {
            yPercent: 112,
            opacity: 0,
            duration,
            ease: GSAP_EASE.outExpo,
            stagger,
            delay: start,
            clearProps: 'transform,opacity',
            onComplete: () => onCompleteRef.current?.(),
            scrollTrigger:
              trigger === 'view' ? { trigger: el, start: 'top 86%', once: true } : undefined,
          });
        },
      });

      return () => split.revert();
    },
    { dependencies: [text, splitType, trigger, delay, stagger, duration, fontsLoaded], scope: ref },
  );

  return (
    <Tag
      // The ref type differs per tag; all of them are HTMLElements.
      ref={ref as React.Ref<never>}
      id={id}
      data-split-reveal=""
      className={cn('split-parent', className)}
      style={style}
    >
      {text}
    </Tag>
  );
}

export default SplitText;
