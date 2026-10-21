import { beforeEach, describe, expect, it } from 'vitest';

import { createDefaultConfig } from '@/lib/character/defaults';

import { useCreatorStore } from './store';

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
