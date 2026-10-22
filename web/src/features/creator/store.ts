import { temporal } from 'zundo';
import { create } from 'zustand';

import type { MhManifest } from '@/lib/assets/manifest';
import { createDefaultConfig } from '@/lib/character/defaults';
import type { BodyPreset, CharacterBase, CharacterConfig } from '@/lib/character/schema';

import { randomConfig, type Random } from './randomize';
import { presetSliders, reconcileConfig, reconcilePreset, startingConfig } from './reconcile';

export const MAX_NAME_LENGTH = 40;

/** Config at the start of the running gesture (history is paused meanwhile). */
let gestureBase: CharacterConfig | null = null;

/** What autosave compares: the trimmed name and the config. */
export const snapshotOf = (name: string, config: CharacterConfig) =>
  JSON.stringify([name.trim(), config]);

interface CreatorState {
  name: string;
  config: CharacterConfig;
  /** Snapshot of the last saved name and config; null before anything is saved or loaded. */
  savedSnapshot: string | null;
  /** Records the current name and config as saved. */
  markSaved: (snapshot?: string) => void;
  setName: (name: string) => void;
  /** Apply an update to a draft copy of the config (recorded for undo). */
  update: (recipe: (draft: CharacterConfig) => void) => void;
  /** Starts a continuous edit (a slider drag): its steps are not recorded one by one. */
  beginGesture: () => void;
  /** Ends it, recording the whole gesture as a single undo entry. */
  endGesture: () => void;
  /** Switch body base; gender-specific picks are re-chosen from the manifest. */
  setBase: (base: CharacterBase, manifest: MhManifest) => void;
  /** Named body preset: sets the slider vector the manifest defines for it. */
  setBodyPreset: (preset: BodyPreset, manifest: MhManifest) => void;
  randomize: (manifest: MhManifest, random?: Random) => void;
  /** Start editing: a saved character, or a fresh default for the base. */
  load: (name: string, config: CharacterConfig, manifest: MhManifest) => void;
}

export const useCreatorStore = create<CreatorState>()(
  temporal(
    (set, get) => ({
      name: '',
      config: createDefaultConfig('female'),
      savedSnapshot: null,
      markSaved: (snapshot) =>
        set((state) => ({ savedSnapshot: snapshot ?? snapshotOf(state.name, state.config) })),
      setName: (name) => set({ name: name.slice(0, MAX_NAME_LENGTH) }),
      update: (recipe) =>
        set((state) => {
          const draft = structuredClone(state.config);
          recipe(draft);
          return { config: draft };
        }),
      beginGesture: () => {
        if (gestureBase) return;
        gestureBase = get().config;
        useCreatorStore.temporal.getState().pause();
      },
      endGesture: () => {
        const before = gestureBase;
        if (!before) return;
        gestureBase = null;
        const history = useCreatorStore.temporal.getState();
        const after = get().config;
        if (after === before) {
          history.resume();
          return;
        }
        // Rewind untracked, then replay tracked: history gains one before -> after step.
        set({ config: before });
        history.resume();
        set({ config: after });
      },
      setBase: (base, manifest) =>
        set((state) => {
          if (state.config.base === base) return state;
          const fresh = startingConfig(base, manifest);
          // Keep choices that are not gendered; the body preset only if the new body has it.
          const preset = reconcilePreset(manifest, base, state.config.body.preset);
          fresh.body = { preset, sliders: presetSliders(manifest, base, preset) };
          fresh.eyes = state.config.eyes;
          // Picked garments carry over (reconciled to the new body); none stays underwear.
          fresh.outfit = state.config.outfit;
          fresh.hair.color = state.config.hair.color;
          fresh.hair.pattern = state.config.hair.pattern;
          fresh.accessories = state.config.accessories;
          fresh.tattoos = state.config.tattoos;
          return { config: reconcileConfig(fresh, manifest) };
        }),
      setBodyPreset: (preset, manifest) =>
        set((state) => ({
          config: {
            ...state.config,
            body: { preset, sliders: presetSliders(manifest, state.config.base, preset) },
          },
        })),
      randomize: (manifest, random) =>
        set((state) => ({ config: randomConfig(state.config, manifest, random) })),
      load: (name, config, manifest) =>
        set({ name: name.slice(0, MAX_NAME_LENGTH), config: reconcileConfig(config, manifest) }),
    }),
    {
      // Only the character is undoable; typing the name is not history.
      partialize: (state) => ({ config: state.config }),
      equality: (a, b) => a.config === b.config,
      limit: 80,
    },
  ),
);
