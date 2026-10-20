/**
 * Motion tokens (mirrors the CSS custom properties in src/app/globals.css and
 * the "Motion" section of /DESIGN.md). Durations are in seconds for Motion and
 * GSAP; use `ms()` for anime.js, which takes milliseconds.
 */
export const DURATION = {
  instant: 0.12,
  quick: 0.2,
  base: 0.32,
  slow: 0.64,
  cinematic: 1.2,
} as const;

/** Cubic-bezier control points, usable directly as a Motion `ease`. */
export const EASE = {
  outExpo: [0.16, 1, 0.3, 1],
  outQuint: [0.22, 1, 0.36, 1],
  inOutQuart: [0.76, 0, 0.24, 1],
  inQuart: [0.5, 0, 0.75, 0],
} as const satisfies Record<string, readonly [number, number, number, number]>;

/** The same curves as GSAP ease names (CustomEase-free equivalents). */
export const GSAP_EASE = {
  outExpo: 'expo.out',
  outQuint: 'power4.out',
  inOutQuart: 'power3.inOut',
  inQuart: 'power3.in',
} as const;

/** Spring used by magnetic controls and small physical responses. */
export const SPRING = { stiffness: 220, damping: 22, mass: 0.6 } as const;

export const ms = (seconds: number): number => Math.round(seconds * 1000);

/** True when the user asked the OS to reduce motion. Safe on the server (false). */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}
