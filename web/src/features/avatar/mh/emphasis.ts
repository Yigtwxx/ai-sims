/**
 * Speech emphasis: people nod a little and lift their brows on stressed
 * syllables, not in proportion to loudness all the time (that reads as
 * bobbing). Stresses are loudness onsets: a fast envelope rising well above a
 * slow one. Each onset kicks a short nod and, often but not always, a brow
 * raise; both rise quickly and fade over a few hundred milliseconds.
 */

export interface EmphasisState {
  /** Loudness envelopes: ~30 ms and ~450 ms. */
  fast: number;
  slow: number;
  /** Seconds since the last stress. */
  since: number;
  /** Decaying kicks and the smoothed outputs that follow them (0..1). */
  nodKick: number;
  browKick: number;
  nod: number;
  brow: number;
}

export function createEmphasis(): EmphasisState {
  return { fast: 0, slow: 0, since: 10, nodKick: 0, browKick: 0, nod: 0, brow: 0 };
}

const FAST = 0.03;
const SLOW = 0.45;
/** Loudness a stress must reach, and how far above the running level. */
const ONSET_LEVEL = 0.22;
const ONSET_RISE = 1.3;
/** Shortest gap between two stresses (s): roughly one per stressed word. */
const MIN_GAP = 0.45;
const BROW_CHANCE = 0.55;
const NOD_FADE = 0.2;
const BROW_FADE = 0.38;
/** How fast the outputs follow their kicks (s). */
const FOLLOW = 0.07;

const follow = (value: number, target: number, dt: number, time: number) =>
  value + (target - value) * Math.min(1, dt / time);

export function stepEmphasis(
  state: EmphasisState,
  loudness: number,
  dt: number,
  speaking: boolean,
  random: () => number,
): EmphasisState {
  const fast = follow(state.fast, loudness, dt, FAST);
  const slow = follow(state.slow, loudness, dt, SLOW);
  let since = state.since + dt;
  let nodKick = state.nodKick * Math.exp(-dt / NOD_FADE);
  let browKick = state.browKick * Math.exp(-dt / BROW_FADE);
  const onset = speaking && fast > ONSET_LEVEL && fast > slow * ONSET_RISE && since > MIN_GAP;
  if (onset) {
    const strength = Math.min(1, Math.max(0.35, (fast - slow) * 3));
    since = 0;
    nodKick = Math.max(nodKick, strength);
    if (random() < BROW_CHANCE) browKick = Math.max(browKick, strength);
  }
  return {
    fast,
    slow,
    since,
    nodKick,
    browKick,
    nod: follow(state.nod, nodKick, dt, FOLLOW),
    brow: follow(state.brow, browKick, dt, FOLLOW),
  };
}
