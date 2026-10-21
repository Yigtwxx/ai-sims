/*
 * Skin swatches as the skin looks on the creator stage, not as its albedo.
 *
 * The manifest swatch is the cheek albedo. On stage the face reads warmer and
 * deeper: subsurface scattering and the warm key pull blue out of the shadow
 * side, and the lit side sits a little above the albedo. Each shade below is a
 * per-channel response `gain * albedo^power` in linear light, fitted to the
 * face skin of the 20 presets the creator offers, as rendered on the stage (2026-10-21,
 * head framing, Neutral tone mapping; mean error about 4/255 per channel):
 * shadow is the median face pixel, lit the 75th and highlight the 90th
 * luminance percentile. Refit when the stage lighting or skin shader changes.
 */

type Response = readonly [power: number, gain: number];
type Rgb = readonly [number, number, number];

const STAGE_RESPONSE = {
  shadow: [
    [1.088, 0.938],
    [1.009, 0.833],
    [0.906, 0.569],
  ],
  lit: [
    [1.067, 1.18],
    [0.983, 1.088],
    [0.864, 0.771],
  ],
  highlight: [
    [1.005, 1.292],
    [0.903, 1.121],
    [0.784, 0.806],
  ],
} as const satisfies Record<string, readonly [Response, Response, Response]>;

export type SkinShade = keyof typeof STAGE_RESPONSE;
export type StageShades = Record<SkinShade, string>;

const toLinear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const toSrgb = (linear: number) => {
  const c = Math.min(1, Math.max(0, linear));
  const encoded = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
};

const hex = (rgb: readonly number[]) =>
  `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;

export function parseHex(color: string): Rgb | undefined {
  const match = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return undefined;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** The shadow, lit and highlight colours a skin albedo swatch takes on stage. */
export function stageShades(albedo: string): StageShades {
  const rgb = parseHex(albedo) ?? [128, 128, 128];
  const linear = rgb.map(toLinear);
  const shade = (shadeName: SkinShade) =>
    hex(
      STAGE_RESPONSE[shadeName].map(([power, gain], channel) =>
        toSrgb(gain * Math.max(linear[channel], 1e-5) ** power),
      ),
    );
  return { shadow: shade('shadow'), lit: shade('lit'), highlight: shade('highlight') };
}

/**
 * A small lit sphere: highlight up left where the key light falls, the lit
 * tone across the middle and the warm shadow at the far edge.
 */
export function stageSwatchBackground(albedo: string): string {
  const { shadow, lit, highlight } = stageShades(albedo);
  return `radial-gradient(circle at 34% 30%, ${highlight} 0%, ${lit} 42%, ${shadow} 100%)`;
}

export const TONE_BANDS = ['light', 'medium', 'deep'] as const;
export type ToneBand = (typeof TONE_BANDS)[number];

/**
 * Manifest tone (0 lightest .. 1 darkest) to a named band. The edges sit in
 * the widest gaps of the current presets, so near twins share a band.
 */
export function toneBand(tone: number): ToneBand {
  if (tone < 0.45) return 'light';
  if (tone < 0.75) return 'medium';
  return 'deep';
}

/** Items grouped by tone band, lightest band first; empty bands are left out. */
export function groupByToneBand<T extends { tone: number }>(
  items: readonly T[],
): { band: ToneBand; items: T[] }[] {
  return TONE_BANDS.map((band) => ({
    band,
    items: items.filter((item) => toneBand(item.tone) === band),
  })).filter((group) => group.items.length > 0);
}
