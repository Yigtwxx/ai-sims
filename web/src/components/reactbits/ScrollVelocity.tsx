'use client';

/*
 * ScrollVelocity: adapted from React Bits "ScrollVelocity-TS-TW"
 * (https://reactbits.dev, MIT + Commons Clause). A single endless row that
 * drifts slowly and speeds up (and reverses) with scroll velocity. Trimmed:
 * no dragging, no skew or stretch (DESIGN.md: nothing is skewed), edges fade.
 * Under reduced motion the row stands still.
 */
import {
  motion,
  useAnimationFrame,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
} from 'motion/react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface ScrollVelocityProps {
  children: ReactNode;
  /** Base drift in px per second; negative drifts right. */
  velocity?: number;
  /** Copies rendered to cover wide screens; the first is the accessible one. */
  copies?: number;
  className?: string;
  rowClassName?: string;
}

const FADE_MASK = 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)';

function wrap(min: number, max: number, value: number): number {
  const range = max - min;
  return ((((value - min) % range) + range) % range) + min;
}

function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export function ScrollVelocity({
  children,
  velocity = 40,
  copies = 4,
  className,
  rowClassName,
}: ScrollVelocityProps) {
  const reduceMotion = useReducedMotion();
  const baseX = useMotionValue(0);
  const { scrollY } = useScroll();
  const scrollVelocity = useVelocity(scrollY);
  const smoothVelocity = useSpring(scrollVelocity, { damping: 50, stiffness: 400 });
  const velocityFactor = useTransform(smoothVelocity, [0, 1000], [0, 4], { clamp: false });
  const direction = useRef(1);

  const copyRef = useRef<HTMLDivElement>(null);
  const copyWidth = useElementWidth(copyRef);
  const x = useTransform(baseX, (value) =>
    copyWidth === 0 ? '0px' : `${wrap(-copyWidth, 0, value)}px`,
  );

  useAnimationFrame((_, delta) => {
    if (reduceMotion) return;
    const factor = velocityFactor.get();
    if (factor < 0) direction.current = -1;
    else if (factor > 0) direction.current = 1;
    let moveBy = direction.current * velocity * (Math.min(delta, 64) / 1000);
    moveBy += direction.current * moveBy * factor;
    baseX.set(baseX.get() + moveBy);
  });

  return (
    <div
      className={cn('relative overflow-hidden', className)}
      style={{ maskImage: FADE_MASK, WebkitMaskImage: FADE_MASK }}
    >
      <motion.div className="flex w-max whitespace-nowrap" style={{ x }}>
        {Array.from({ length: copies }, (_, index) => (
          <div
            key={index}
            ref={index === 0 ? copyRef : undefined}
            aria-hidden={index > 0 ? true : undefined}
            className={cn('flex shrink-0 items-center', rowClassName)}
          >
            {children}
          </div>
        ))}
      </motion.div>
    </div>
  );
}

export default ScrollVelocity;
