import type { CharacterBase, CharacterConfig } from './schema';

// Placeholder ids; they will be replaced by real manifest ids from the asset pipeline.
const DEFAULTS_BY_BASE: Record<CharacterBase, CharacterConfig> = {
  male: {
    schemaVersion: 1,
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
    schemaVersion: 1,
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

/** Returns a fresh, independently mutable default config for the given base. */
export function createDefaultConfig(base: CharacterBase): CharacterConfig {
  return structuredClone(DEFAULTS_BY_BASE[base]);
}
