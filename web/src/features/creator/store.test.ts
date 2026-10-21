import { beforeEach, describe, expect, it } from 'vitest';

import type { MhManifest } from '@/lib/assets/manifest';
import { createDefaultConfig } from '@/lib/character/defaults';

import { fixtureManifest } from './fixtures/manifest';
import { presetSliders, startingConfig } from './reconcile';
import { useCreatorStore } from './store';

/**
 * The fixture with a male body that has no curvy preset (as the pipeline
 * exports it) and an average that is not all defaults, so the sliders show
 * which preset was applied.
 */
function maleWithoutCurvy(): MhManifest {
  const source = fixtureManifest();
  const bodies = source.bodies.map((body) => {
    if (body.gender !== 'male') return body;
    const presets = { ...body.presets, average: { weight: 0.1 } };
    delete presets.curvy;
    return { ...body, presets };
  });
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
});
