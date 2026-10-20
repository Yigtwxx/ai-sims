import { beforeEach, describe, expect, it } from 'vitest';

import { createDefaultConfig } from '@/lib/character/defaults';
import { CharacterConfigSchema } from '@/lib/character/schema';

import type { VrmManifest } from './manifest';
import { MAX_NAME_LENGTH, useCreatorStore } from './store';

const entry = (id: string, category: string, gender: string) => ({
  id,
  category,
  gender,
  label: id,
  source: id.split('__')[0],
  url: `/assets/vrm/parts/${id}.vrm`,
  bytes: 1,
});

const MANIFEST = {
  version: 1,
  bases: [entry('fem__base', 'base', 'female'), entry('masc__base', 'base', 'male')],
  parts: [
    entry('donor__hair', 'hair', 'female'),
    entry('donor__top', 'top', 'female'),
    entry('masc__hair', 'hair', 'male'),
  ],
} as VrmManifest;

beforeEach(() => {
  useCreatorStore.setState({ name: '', config: createDefaultConfig('anime', 'female') });
  useCreatorStore.temporal.getState().clear();
});

describe('creator store', () => {
  it('records config edits for undo and redo', () => {
    const { update } = useCreatorStore.getState();
    update((c) => {
      c.body.build = 'athletic';
    });
    expect(useCreatorStore.getState().config.body.build).toBe('athletic');
    useCreatorStore.temporal.getState().undo();
    expect(useCreatorStore.getState().config.body.build).toBe('average');
    useCreatorStore.temporal.getState().redo();
    expect(useCreatorStore.getState().config.body.build).toBe('athletic');
  });

  it('does not record name typing in the undo history', () => {
    useCreatorStore.getState().setName('Ayşe');
    expect(useCreatorStore.temporal.getState().pastStates).toHaveLength(0);
  });

  it('caps the name length', () => {
    useCreatorStore.getState().setName('x'.repeat(100));
    expect(useCreatorStore.getState().name).toHaveLength(MAX_NAME_LENGTH);
  });

  it('switches gender to a valid male config while keeping body and skin', () => {
    const { update, setGender } = useCreatorStore.getState();
    update((c) => {
      c.body.build = 'curvy';
      c.skin.tone = 0.6;
    });
    setGender('male', MANIFEST);
    const { config } = useCreatorStore.getState();
    expect(config.base).toBe('male');
    expect(config.face.preset).toBe('masc__base');
    expect(config.body.build).toBe('curvy');
    expect(config.skin.tone).toBe(0.6);
  });

  it('randomizes into a schema-valid config using only offered parts', () => {
    let seed = 0.37;
    const random = () => {
      seed = ((seed * 9301 + 49297) % 233280) / 233280;
      return seed;
    };
    useCreatorStore.getState().randomize(MANIFEST, random);
    const { config } = useCreatorStore.getState();
    expect(CharacterConfigSchema.safeParse(config).success).toBe(true);
    expect(['donor__hair']).toContain(config.hair.style);
    expect(config.face.preset).toBe('fem__base');
  });
});
