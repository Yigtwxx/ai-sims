/**
 * Colour palettes the creator offers for the character itself (hair dye and
 * pattern colours, eye tints, garment colours). These are character content,
 * like skin swatches from the manifest, not interface colours: the UI palette
 * lives in DESIGN.md and globals.css. Each colour has a key that names it in
 * the messages (`Creator.colors.<key>`).
 */

import { NUDE_TIGHTS_COLOR } from '@/lib/character/schema';

export interface NamedColor {
  key: ColorKey;
  value: string;
}

export const COLOR_KEYS = [
  'burgundy',
  'brick',
  'copper',
  'sand',
  'champagne',
  'plum',
  'petrol',
  'sage',
  'honey',
  'platinum',
  'chestnut',
  'brown',
  'hazel',
  'green',
  'blue',
  'grey',
  'amber',
  'black',
  'white',
  'charcoal',
  'navy',
  'olive',
  'cognac',
  'wine',
  'stone',
  'greyMelange',
  'beige',
  'nude',
] as const;

export type ColorKey = (typeof COLOR_KEYS)[number];

const named = (key: ColorKey, value: string): NamedColor => ({ key, value });

/** Hair dyes that read as deliberate fashion choices, not costume. */
export const HAIR_DYES: readonly NamedColor[] = [
  named('burgundy', '#7b2f3a'),
  named('brick', '#a33a2c'),
  named('copper', '#c27a4a'),
  named('sand', '#e7d3b0'),
  named('champagne', '#d9c6a3'),
  named('plum', '#3a2a55'),
  named('petrol', '#2f4a5c'),
  named('sage', '#5c6b5a'),
];

/** Colours for ombre, roots, highlights and underlayer. */
export const HAIR_PATTERN_COLORS: readonly NamedColor[] = [
  named('honey', '#c8a46e'),
  named('sand', '#e7d3b0'),
  named('chestnut', '#9a5b3a'),
  named('burgundy', '#7b2f3a'),
  named('plum', '#3a2a55'),
  named('petrol', '#2f4a5c'),
  named('platinum', '#d7d2c8'),
];

/** Optional eye tints over the iris texture. */
export const EYE_TINTS: readonly NamedColor[] = [
  named('brown', '#4a3121'),
  named('hazel', '#7b6a3b'),
  named('green', '#5e7b4b'),
  named('blue', '#5f85a9'),
  named('grey', '#7d8a8f'),
  named('amber', '#a3712d'),
];

/** Extra garment colours beside the manifest's tint presets. */
export const GARMENT_COLORS: readonly NamedColor[] = [
  named('black', '#1b1b1d'),
  named('white', '#e9e6df'),
  named('charcoal', '#2f3136'),
  named('navy', '#22304a'),
  named('olive', '#4b5236'),
  named('cognac', '#7a4223'),
  named('wine', '#5b2430'),
  named('stone', '#c9b79a'),
];

/** Socks: the everyday knit colours. */
export const SOCK_COLORS: readonly NamedColor[] = [
  named('black', '#1b1b1d'),
  named('white', '#ecebe6'),
  named('greyMelange', '#9b9b98'),
  named('navy', '#22304a'),
  named('beige', '#cdb99a'),
  named('burgundy', '#5e1f2b'),
];

/** Tights: nude (the wearer's own tone, see NUDE_TIGHTS_COLOR) and the dark office shades. */
export const TIGHTS_COLORS: readonly NamedColor[] = [
  named('nude', NUDE_TIGHTS_COLOR),
  named('black', '#141416'),
  named('navy', '#1d2638'),
  named('charcoal', '#33353a'),
];

/**
 * Natural hair colour from the MetaHuman melanin/redness model, approximated
 * for UI previews (the renderer computes the real colour).
 */
export function naturalHairColor(melanin: number, redness: number): string {
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  // Blond (low melanin) to near black (high melanin), warmed by redness.
  const m = Math.min(1, Math.max(0, melanin));
  const r = Math.min(1, Math.max(0, redness));
  const light = [224, 196, 150];
  const dark = [22, 17, 14];
  const base = light.map((channel, index) => lerp(channel, dark[index], Math.pow(m, 0.75)));
  const red = [Math.min(255, base[0] * 1.35 + 30), base[1] * 0.78, base[2] * 0.6];
  const mixed = base.map((channel, index) => lerp(channel, red[index], r * (1 - m * 0.6)));
  return `#${mixed.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
}
