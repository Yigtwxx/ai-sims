import { beforeEach, describe, expect, it } from 'vitest';

import type { MhManifest } from '@/lib/assets/manifest';
import { createDefaultConfig } from '@/lib/character/defaults';

import { fixtureManifest } from './fixtures/manifest';
import { outfitsFor, presetSliders, startingConfig } from './reconcile';
import { useCreatorStore } from './store';

/**
 * The fixture (its male body has no curvy preset, as the pipeline exports it)
 * with a male average that is not all defaults, so the sliders show which
 * preset was applied.
 */
function maleWithoutCurvy(): MhManifest {
  const source = fixtureManifest();
  const bodies = source.bodies.map((body) =>
    body.gender === 'male'
      ? { ...body, presets: { ...body.presets, average: { weight: 0.1 } } }
      : body,
  );
  return { ...source, bodies };
}

const tone = () => useCreatorStore.getState().config.skin.tone;
const setTone = (value: number) =>
  useCreatorStore.getState().update((draft) => {
    draft.skin.tone = value;
  });

describe('creator store history', () => {
  beforeEach(() => {
    useCreatorStore.setState({ config: createDefaultConfig('female') });
    useCreatorStore.temporal.getState().clear();
  });

  it('records a slider drag as one undo step', () => {
    useCreatorStore.getState().beginGesture();
    for (const value of [0.1, 0.2, 0.3, 0.4]) setTone(value);
    useCreatorStore.getState().endGesture();

    expect(tone()).toBe(0.4);
    expect(useCreatorStore.temporal.getState().pastStates).toHaveLength(1);
    useCreatorStore.temporal.getState().undo();
    expect(tone()).toBe(0);
  });

  it('records nothing for a gesture that changed nothing, and resumes tracking', () => {
    useCreatorStore.getState().beginGesture();
    useCreatorStore.getState().endGesture();
    expect(useCreatorStore.temporal.getState().pastStates).toHaveLength(0);

    setTone(0.5);
    expect(useCreatorStore.temporal.getState().pastStates).toHaveLength(1);
  });

  it('keeps single edits as separate steps', () => {
    setTone(0.1);
    setTone(0.2);
    expect(useCreatorStore.temporal.getState().pastStates).toHaveLength(2);
  });
});

describe('creator store base switch', () => {
  it('gives a male the average body when the female preset was curvy', () => {
    const manifest = maleWithoutCurvy();
    const female = startingConfig('female', manifest);
    female.body = { preset: 'curvy', sliders: presetSliders(manifest, 'female', 'curvy') };
    useCreatorStore.setState({ config: female });

    useCreatorStore.getState().setBase('male', manifest);

    expect(useCreatorStore.getState().config.body).toEqual({
      preset: 'average',
      sliders: presetSliders(manifest, 'male', 'average'),
    });
  });

  it('keeps a preset the new body offers', () => {
    const manifest = maleWithoutCurvy();
    const female = startingConfig('female', manifest);
    female.body = { preset: 'athletic', sliders: presetSliders(manifest, 'female', 'athletic') };
    useCreatorStore.setState({ config: female });

    useCreatorStore.getState().setBase('male', manifest);

    expect(useCreatorStore.getState().config.body).toEqual({
      preset: 'athletic',
      sliders: presetSliders(manifest, 'male', 'athletic'),
    });
  });

  it('stays in underwear when no outfit was picked', () => {
    const manifest = maleWithoutCurvy();
    useCreatorStore.setState({ config: startingConfig('female', manifest) });

    useCreatorStore.getState().setBase('male', manifest);

    expect(useCreatorStore.getState().config.outfit).toEqual({
      top: null,
      bottom: null,
      shoes: null,
      full: null,
    });
  });

  it('keeps picked garments, swapping one the new body cannot wear', () => {
    const manifest = maleWithoutCurvy();
    const unisex = outfitsFor(manifest, 'bottom', 'female').find((o) => o.compat === 'unisex')!;
    const femaleOnly = outfitsFor(manifest, 'top', 'female').find((o) => o.compat === 'female')!;
    const female = startingConfig('female', manifest);
    female.outfit.bottom = { id: unisex.id, tint: null, colors: {} };
    female.outfit.top = { id: femaleOnly.id, tint: null, colors: {} };
    useCreatorStore.setState({ config: female });

    useCreatorStore.getState().setBase('male', manifest);

    const { outfit } = useCreatorStore.getState().config;
    expect(outfit.bottom?.id).toBe(unisex.id);
    expect(outfit.top?.id).toBe(outfitsFor(manifest, 'top', 'male')[0]?.id);
    expect(outfit.shoes).toBeNull();
  });
});
