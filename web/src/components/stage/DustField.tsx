'use client';

import { useEffect, useRef } from 'react';

import { seededRandom } from '@/features/landing/particles/shapes';

/** Ink #171a21 (DESIGN.md). */
const INK = '23, 26, 33';
/** Dots per 10,000 CSS px² of the field. */
const DENSITY = 0.9;

/**
 * The landing's first frame, still: scattered ink dots that have not become
 * anything yet. Empty and error states stand on it. Drawn once per size.
 */
export function DustField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const context = canvas.getContext('2d');
      if (!context) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      const rnd = seededRandom(11);
      const count = Math.round(((width * height) / 10000) * DENSITY);
      for (let i = 0; i < count; i++) {
        const accent = rnd() < 0.06;
        context.fillStyle = accent
          ? `rgba(45, 75, 211, ${(0.35 + rnd() * 0.4).toFixed(2)})`
          : `rgba(${INK}, ${(0.18 + rnd() * 0.5).toFixed(2)})`;
        context.beginPath();
        context.arc(rnd() * width, rnd() * height, accent ? 1.2 : 0.9, 0, Math.PI * 2);
        context.fill();
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
}
