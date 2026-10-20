import { temporal } from 'zundo';
import { create } from 'zustand';

import { createDefaultConfig } from '@/lib/character/defaults';
import {
  BODY_BUILDS,
  HEIGHT_MAX,
  HEIGHT_MIN,
  NO_PART,
  type CharacterConfig,
} from '@/lib/character/schema';

import { reconcileConfig, SKIN_TONES, skinToneValue } from './avatarProps';
import { basesFor, partsFor, type Gender, type VrmManifest } from './manifest';

export const MAX_NAME_LENGTH = 40;

interface CreatorState {
  name: string;
  config: CharacterConfig;
  setName: (name: string) => void;
  /** Apply an immutable update to the config (recorded for undo). */
  update: (recipe: (draft: CharacterConfig) => void) => void;
  setGender: (gender: Gender, manifest: VrmManifest) => void;
  randomize: (manifest: VrmManifest, random?: () => number) => void;
  load: (name: string, config: CharacterConfig, manifest: VrmManifest) => void;
}

/** Palettes used by randomize; white keeps the authored colour. */
export const HAIR_TINTS = [
  '#ffffff',
  '#f2d27a',
  '#c0573a',
  '#6b4a3a',
  '#7aa0ff',
  '#f08fb8',
  '#2b2a33',
];
export const EYE_TINTS = ['#ffffff', '#7fb3ff', '#7fe0b0', '#d9a066', '#c9a0ff', '#ff8a8a'];
export const CLOTH_TINTS = ['#ffffff', '#f6c2c2', '#bcd6ff', '#cfe8c8', '#2e2c33', '#f3e1a8'];

const pick = <T>(items: readonly T[], random: () => number): T =>
  items[Math.floor(random() * items.length) % items.length];

export const useCreatorStore = create<CreatorState>()(
  temporal(
    (set) => ({
      name: '',
      config: createDefaultConfig('anime', 'female'),
      setName: (name) => set({ name: name.slice(0, MAX_NAME_LENGTH) }),
      update: (recipe) =>
        set((state) => {
          const draft = structuredClone(state.config);
          recipe(draft);
          return { config: draft };
        }),
      setGender: (gender, manifest) =>
        set((state) => {
          if (state.config.base === gender) return state;
          const fresh = createDefaultConfig('anime', gender);
          // Keep choices that are not gendered (body shape, tints).
          fresh.body = state.config.body;
          fresh.skin = state.config.skin;
          fresh.eyes = state.config.eyes;
          return { config: reconcileConfig(fresh, manifest) };
        }),
      randomize: (manifest, random = Math.random) =>
        set((state) => {
          const gender = state.config.base;
          const next = structuredClone(state.config);
          const face = pick(basesFor(manifest, gender), random);
          if (face) next.face.preset = face.id;
          const hair = pick(partsFor(manifest, 'hair', gender), random);
          if (hair) next.hair.style = hair.id;
          for (const slot of ['top', 'bottom', 'shoes'] as const) {
            const options = partsFor(manifest, slot, gender);
            next.outfit[slot] = {
              id: options.length ? pick(options, random).id : NO_PART,
              color: pick(CLOTH_TINTS, random),
            };
          }
          next.hair.color = pick(HAIR_TINTS, random);
          next.eyes.color = pick(EYE_TINTS, random);
          next.skin.tone = skinToneValue(Math.floor(random() * SKIN_TONES.length));
          next.body = {
            build: pick(BODY_BUILDS, random),
            height: Number((HEIGHT_MIN + random() * (HEIGHT_MAX - HEIGHT_MIN)).toFixed(3)),
          };
          return { config: next };
        }),
      load: (name, config, manifest) => set({ name, config: reconcileConfig(config, manifest) }),
    }),
    {
      // Only the character is undoable; typing the name is not history.
      partialize: (state) => ({ config: state.config }),
      equality: (a, b) => a.config === b.config,
      limit: 60,
    },
  ),
);
