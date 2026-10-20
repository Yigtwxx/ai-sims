/**
 * Procedural "aliveness": blink timing and eye saccades. Pure functions so
 * the schedule can be tested without a renderer.
 */

export interface BlinkState {
  /** Seconds until the next blink starts. */
  nextIn: number;
  /** Seconds into the current blink, or -1 when eyes are open. */
  phase: number;
}

export const BLINK_DURATION = 0.16;

/** Natural inter-blink interval is ~2-6 s; `random` is injected for tests. */
export function nextBlinkInterval(random: () => number): number {
  return 2 + random() * 4;
}

export function stepBlink(
  state: BlinkState,
  dt: number,
  random: () => number,
): { state: BlinkState; weight: number } {
  if (state.phase >= 0) {
    const phase = state.phase + dt;
    if (phase >= BLINK_DURATION) {
      return { state: { nextIn: nextBlinkInterval(random), phase: -1 }, weight: 0 };
    }
    return { state: { ...state, phase }, weight: blinkCurve(phase / BLINK_DURATION) };
  }
  const nextIn = state.nextIn - dt;
  if (nextIn <= 0) return { state: { nextIn: 0, phase: 0 }, weight: 0 };
  return { state: { ...state, nextIn }, weight: 0 };
}

/** Fast close, slower open: peak at 35% of the blink. */
export function blinkCurve(t: number): number {
  const clamped = Math.min(Math.max(t, 0), 1);
  return clamped < 0.35 ? clamped / 0.35 : 1 - (clamped - 0.35) / 0.65;
}
