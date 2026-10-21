/**
 * When is a thumbnail stage done? Its first frame comes before skin textures
 * and grooms (they stream in afterwards), so the bench watches the picture:
 * asset requests have gone quiet, the centre shows detail (not the bare
 * backdrop), and consecutive samples agree.
 */

/** Side of the luminance grid the canvas is reduced to. */
export const GRID = 64;

/** Rec. 709 luma of an RGBA buffer, one value per pixel. */
export function lumaOf(pixels: Uint8ClampedArray): Float32Array {
  const out = new Float32Array(pixels.length / 4);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = 0.2126 * pixels[i * 4] + 0.7152 * pixels[i * 4 + 1] + 0.0722 * pixels[i * 4 + 2];
  }
  return out;
}

/**
 * Mean horizontal and vertical luma step in the central half of the grid.
 * The backdrop is a smooth gradient (close to 0); a face or hair is not.
 */
export function centreDetail(luma: Float32Array, side = GRID): number {
  const from = Math.floor(side / 4);
  const to = Math.ceil((side * 3) / 4);
  let sum = 0;
  let count = 0;
  for (let y = from; y < to - 1; y += 1) {
    for (let x = from; x < to - 1; x += 1) {
      const index = y * side + x;
      sum += Math.abs(luma[index + 1] - luma[index]) + Math.abs(luma[index + side] - luma[index]);
      count += 2;
    }
  }
  return count ? sum / count : 0;
}

/** Mean absolute luma difference between two samples of the same size. */
export function meanDifference(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

export interface SettleRule {
  /** Asset responses must have stopped this long ago. */
  quietMs: number;
  /** Minimum centre detail that means "something is on stage". */
  minDetail: number;
  /** Samples closer than this count as calm. */
  maxDifference: number;
  /** Calm samples in a row before the frame is taken. */
  calmSamples: number;
}

export const SETTLE_RULE: SettleRule = {
  quietMs: 1500,
  minDetail: 1.2,
  maxDifference: 2.5,
  calmSamples: 3,
};

export type SettleBlocker = 'assets' | 'detail' | 'motion' | 'first';

/** Why a sample is not calm yet, or null when it is. */
export function settleBlocker(
  sample: { luma: Float32Array; previous: Float32Array | null; sinceAssetMs: number },
  rule: SettleRule = SETTLE_RULE,
): SettleBlocker | null {
  if (sample.sinceAssetMs < rule.quietMs) return 'assets';
  if (centreDetail(sample.luma) < rule.minDetail) return 'detail';
  if (!sample.previous) return 'first';
  return meanDifference(sample.luma, sample.previous) <= rule.maxDifference ? null : 'motion';
}

/** One step of the settle check: the next calm count (reaching `calmSamples` means done). */
export function nextCalm(
  calm: number,
  sample: { luma: Float32Array; previous: Float32Array | null; sinceAssetMs: number },
  rule: SettleRule = SETTLE_RULE,
): number {
  return settleBlocker(sample, rule) === null ? calm + 1 : 0;
}
