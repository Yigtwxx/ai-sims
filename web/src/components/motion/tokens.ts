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

/**
 * Indicators that slide between options (active category, segment, chip,
 * selected tile ring). Damping ratio ~0.98: no overshoot, settles in ~250 ms,
 * so a fast series of picks never wobbles.
 */
export const SPRING_SNAP = { type: 'spring', stiffness: 520, damping: 44, mass: 0.9 } as const;

/**
 * Content arriving in place (a category's controls, a title card). Softer
 * than the indicators so the frame leads and the content follows.
 */
export const SPRING_SOFT = { type: 'spring', stiffness: 300, damping: 34, mass: 0.9 } as const;

export const ms = (seconds: number): number => Math.round(seconds * 1000);

/** True when the user asked the OS to reduce motion. Safe on the server (false). */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}
