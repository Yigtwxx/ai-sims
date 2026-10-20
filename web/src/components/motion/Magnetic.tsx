'use client';

import { motion, useMotionValue, useReducedMotion, useSpring } from 'motion/react';
import { useRef, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { SPRING } from './tokens';

interface MagneticProps {
  children: ReactNode;
  /** Fraction of the pointer offset the content follows (0 to 1). */
  strength?: number;
  /** Extra hit area around the content, in px, where the pull starts. */
  padding?: number;
  className?: string;
}

/**
 * Pulls its content toward the pointer with a spring while the pointer is
 * near (inspired by React Bits "Magnet"; rebuilt on motion values so pointer
 * moves never re-render React). Inactive for touch and reduced motion.
 */
export function Magnetic({ children, strength = 0.28, padding = 28, className }: MagneticProps) {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const x = useSpring(useMotionValue(0), SPRING);
  const y = useSpring(useMotionValue(0), SPRING);

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (reduceMotion || event.pointerType !== 'mouse' || !ref.current) return;
    const box = ref.current.getBoundingClientRect();
    x.set((event.clientX - (box.left + box.width / 2)) * strength);
    y.set((event.clientY - (box.top + box.height / 2)) * strength);
  };

  const release = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <div
      ref={ref}
      onPointerMove={onPointerMove}
      onPointerLeave={release}
      className={cn('inline-flex', className)}
      style={{ padding, margin: -padding }}
    >
      <motion.div className="inline-flex" style={{ x, y }}>
        {children}
      </motion.div>
    </div>
  );
}
