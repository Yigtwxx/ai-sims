import { CURRENT_SCHEMA_VERSION, type CharacterBase, type CharacterConfig } from './schema';

/**
 * Starting ids are MetaHuman preset names (the manifest's face and skin ids,
 * which may carry a `face.` / `skin.` prefix). The creator reconciles every id
 * with the loaded manifest, so a curated-out or missing item falls back to the
 * first available option.
 */
export const STARTING_PRESET: Record<CharacterBase, string> = { female: 'Jelena', male: 'Victor' };

/** Returns a fresh, independently mutable default config for the given base. */
export function createDefaultConfig(base: CharacterBase): CharacterConfig {
  const preset = STARTING_PRESET[base];
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    style: 'realistic',
    base,
    face: { preset, blend: {} },
    body: { preset: 'average', sliders: {} },
    skin: { set: preset, tone: 0, makeup: false },
    eyes: { iris: null, color: null },
    hair: {
      style: null,
      color: { melanin: 0.75, redness: 0.25, dye: null },
      pattern: { type: 'none', color: '#c8a46e', amount: 0.5 },
    },
    eyebrows: { style: null },
    beard: { style: null },
    mustache: { style: null },
    outfit: { top: null, bottom: null, shoes: null, full: null },
    socks: { style: 'none', color: '#1b1b1d', sheer: 0.5 },
    accessories: [],
    tattoos: [],
    voice: { gender: base },
  };
}
