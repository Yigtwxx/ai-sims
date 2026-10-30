/**
 * Pure turntable physics: drag sets angular velocity, release coasts with damping.
 * Kept framework-free so it can be unit tested and reused by any renderer.
 */

export interface TurntableState {
  angle: number;
  velocity: number;
  dragging: boolean;
}

export interface TurntableOptions {
  /** Radians of rotation per pixel of horizontal drag. */
  sensitivity: number;
  /** Fraction of velocity kept per 1/60 s while coasting (0..1). */
  damping: number;
  /** Velocity below which coasting stops (rad/frame). */
  restThreshold: number;
}

export const DEFAULT_TURNTABLE_OPTIONS: TurntableOptions = {
  sensitivity: 0.008,
  damping: 0.92,
  restThreshold: 0.0001,
};

export function createTurntableState(angle = 0): TurntableState {
  return { angle, velocity: 0, dragging: false };
}

/** Apply a horizontal pointer delta (pixels) while dragging. */
export function applyDrag(
  state: TurntableState,
  deltaX: number,
  options: TurntableOptions = DEFAULT_TURNTABLE_OPTIONS,
): TurntableState {
  const step = deltaX * options.sensitivity;
  return { angle: state.angle + step, velocity: step, dragging: true };
}

export function release(state: TurntableState): TurntableState {
  return { ...state, dragging: false };
}

/** Advance coasting by `dt` seconds; frame-rate independent damping. */
export function stepTurntable(
  state: TurntableState,
  dt: number,
  options: TurntableOptions = DEFAULT_TURNTABLE_OPTIONS,
): TurntableState {
  if (state.dragging) return state;
  if (Math.abs(state.velocity) < options.restThreshold) {
    return state.velocity === 0 ? state : { ...state, velocity: 0 };
  }
  const frames = dt * 60;
  const velocity = state.velocity * Math.pow(options.damping, frames);
  return { ...state, angle: state.angle + velocity * frames, velocity };
}

const TURN = Math.PI * 2;

/**
 * The angle nearest to `angle` that turns the subject `heading` radians from
 * facing the viewer (0: facing them, a whole number of turns).
 */
export function nearestFront(angle: number, heading = 0): number {
  const turns = Math.round((angle - heading) / TURN);
  return heading + (turns === 0 ? 0 : turns * TURN);
}

/**
 * Glide toward `target` (radians) without coasting, frame-rate independent;
 * snaps onto it once within a hundredth of a degree.
 */
export function stepHome(
  state: TurntableState,
  target: number,
  dt: number,
  rate = 4,
): TurntableState {
  if (state.dragging) return state;
  const angle = target + (state.angle - target) * Math.exp(-rate * dt);
  return { ...state, angle: Math.abs(angle - target) < 0.0002 ? target : angle, velocity: 0 };
}
