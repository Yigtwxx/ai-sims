import type { Rgb } from './hairColor';

/** Linear albedo gain at the ends of the tone slider (-1 lighter, 1 darker). */
const LIGHTEST_GAIN = 1.4;
const DARKEST_GAIN = 0.58;

/**
 * Per-channel exponents of the gain: melanin absorbs blue most and red least,
 * so darker skin also turns warmer and more saturated (lighter, the reverse).
 */
const CHANNEL_POWER: Rgb = [1, 1.1, 1.25];

/**
 * The linear multiplier the skin albedo takes for a fine tone adjustment of
 * the chosen skin set: 0 leaves the set as it is.
 */
export function skinToneGain(tone: number): Rgb {
  const t = Math.min(1, Math.max(-1, tone));
  const gain = t >= 0 ? DARKEST_GAIN ** t : LIGHTEST_GAIN ** -t;
  const [r, g, b] = CHANNEL_POWER;
  return [gain ** r, gain ** g, gain ** b];
}
