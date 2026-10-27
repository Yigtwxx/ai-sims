'use client';

import { useEffect, useRef } from 'react';

import { loadSilhouette } from '@/features/landing/particles/silhouette';

/** Dots drawn: enough to read as a person, cheap enough to draw once on the CPU. */
const POINTS = 4000;
/** Ink #171a21 (DESIGN.md). */
const INK = '23, 26, 33';

/**
 * The landing's last frame, still: the dot silhouette stands where the
 * character will appear while the 3D stage loads, so the landing's dots seem
 * to become the character. Drawn once per size (2D canvas, no loop). Its box
 * stands on `--stage-floor` at `--stage-x`, like the character.
 */
export function DotPoster() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const abort = new AbortController();
    let points: Float32Array | undefined;

    const draw = () => {
      const context = canvas.getContext('2d');
      if (!context || !points) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      const half = height / 2;
      const count = Math.min(POINTS, points.length / 3);
      for (let i = 0; i < count; i++) {
        const x = points[i * 3];
        const y = points[i * 3 + 1];
        const z = points[i * 3 + 2];
        // Front-facing: nearer dots (+z) darker, like the landing's depth fade.
        const alpha = Math.min(1, Math.max(0.2, 0.62 + z * 0.9));
        context.fillStyle = `rgba(${INK}, ${alpha.toFixed(2)})`;
        context.beginPath();
        context.arc(width / 2 + x * half, half - y * half, 0.9, 0, Math.PI * 2);
        context.fill();
      }
      canvas.dataset.drawn = 'true';
    };

    void loadSilhouette(abort.signal).then((loaded) => {
      if (abort.signal.aborted || !loaded) return;
      points = loaded;
      draw();
    });
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => {
      abort.abort();
      observer.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="ease-out-expo absolute h-[74%] max-h-[860px] -translate-x-1/2 -translate-y-full opacity-0 transition-opacity duration-700 data-[drawn=true]:opacity-100 data-[drawn=true]:motion-safe:animate-[dot-breathe_3.2s_ease-in-out_infinite_alternate]"
      style={{ left: 'var(--stage-x)', top: 'var(--stage-floor)', aspectRatio: '1 / 2' }}
    />
  );
}
