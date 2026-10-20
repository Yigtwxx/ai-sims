import type { CharacterBase, CharacterConfig, CharacterStyle } from './schema';

const NO_TINT = '#ffffff';

type StyleDefaults = Omit<CharacterConfig, 'style'>;

const SHARED: Pick<StyleDefaults, 'schemaVersion' | 'body' | 'accessories' | 'tattoos'> = {
  schemaVersion: 1,
  body: { build: 'average', height: 1 },
  accessories: [],
  tattoos: [],
};

// Anime ids reference the VRM part manifest (pipeline/vroid_sources.json). The
// creator reconciles them with the manifest it loads, so missing parts fall
// back to the first available option.
const ANIME: Record<CharacterBase, StyleDefaults> = {
  female: {
    ...SHARED,
    base: 'female',
    face: { preset: 'fem_vroid__base', blend: {} },
    skin: { tone: 0 },
    eyes: { color: NO_TINT },
    hair: { style: 'AvatarSample_B__hair', color: NO_TINT },
    facialHair: { style: null, color: NO_TINT },
    outfit: {
      top: { id: 'AvatarSample_B__top', color: NO_TINT },
      bottom: { id: 'AvatarSample_B__bottom', color: NO_TINT },
      shoes: { id: 'AvatarSample_B__shoes', color: NO_TINT },
    },
  },
  male: {
    ...SHARED,
    base: 'male',
    face: { preset: 'masc_vroid__base', blend: {} },
    skin: { tone: 0 },
    eyes: { color: NO_TINT },
    hair: { style: 'masc_vroid__hair', color: NO_TINT },
    facialHair: { style: null, color: NO_TINT },
    outfit: {
      top: { id: 'none', color: NO_TINT },
      bottom: { id: 'none', color: NO_TINT },
      shoes: { id: 'none', color: NO_TINT },
    },
  },
};

// Realistic ids are placeholders until the MPFB part pipeline lands.
const REALISTIC: Record<CharacterBase, StyleDefaults> = {
  male: {
    ...SHARED,
    base: 'male',
    face: { preset: 'face_m_01', blend: {} },
    skin: { tone: 0.5 },
    eyes: { color: '#5b7c99' },
    hair: { style: 'hair_m_short_01', color: '#3b2a20' },
    facialHair: { style: null, color: '#3b2a20' },
    outfit: {
      top: { id: 'top_m_tshirt_01' },
      bottom: { id: 'bottom_m_jeans_01' },
      shoes: { id: 'shoes_m_sneaker_01' },
    },
  },
  female: {
    ...SHARED,
    base: 'female',
    face: { preset: 'face_f_01', blend: {} },
    skin: { tone: 0.5 },
    eyes: { color: '#5b7c99' },
    hair: { style: 'hair_f_long_01', color: '#3b2a20' },
    facialHair: { style: null, color: '#3b2a20' },
    outfit: {
      top: { id: 'top_f_tshirt_01' },
      bottom: { id: 'bottom_f_jeans_01' },
      shoes: { id: 'shoes_f_sneaker_01' },
    },
  },
};

/** Returns a fresh, independently mutable default config for the given style and base. */
export function createDefaultConfig(style: CharacterStyle, base: CharacterBase): CharacterConfig {
  const source = style === 'anime' ? ANIME : REALISTIC;
  return { style, ...structuredClone(source[base]) };
}
