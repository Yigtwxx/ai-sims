import { describe, expect, it } from 'vitest';

import { createDefaultConfig } from './defaults';
import { migrateConfig } from './migrations';
import { CharacterConfigSchema, CURRENT_SCHEMA_VERSION } from './schema';

const V1_ANIME = {
  schemaVersion: 1,
  style: 'anime',
  base: 'female',
  face: { preset: 'fem_vroid__base', blend: {} },
  skin: { tone: 0 },
  eyes: { color: '#ffffff' },
  hair: { style: 'AvatarSample_B__hair', color: '#ffffff' },
  facialHair: { style: null, color: '#ffffff' },
  outfit: {
    top: { id: 'AvatarSample_B__top', color: '#ffffff' },
    bottom: { id: 'AvatarSample_B__bottom', color: '#ffffff' },
    shoes: { id: 'AvatarSample_B__shoes', color: '#ffffff' },
  },
  body: { build: 'curvy', height: 1.04 },
  accessories: ['earring_hoop'],
  tattoos: [{ design: 'rose', placement: 'wrist' }],
};

describe('CharacterConfigSchema', () => {
  it.each(['male', 'female'] as const)('accepts the default %s config', (base) => {
    const config = createDefaultConfig(base);
    expect(config.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(config.voice.gender).toBe(base);
    expect(CharacterConfigSchema.safeParse(config).success).toBe(true);
  });

  it('returns independent copies from createDefaultConfig', () => {
    const a = createDefaultConfig('male');
    a.accessories.push('earring_hoop');
    a.body.sliders.height = 0.5;
    const b = createDefaultConfig('male');
    expect(b.accessories).toEqual([]);
    expect(b.body.sliders).toEqual({});
  });

  it('rejects body sliders outside -1..1 and unknown sliders', () => {
    const config = createDefaultConfig('female');
    config.body.sliders.weight = 1.5;
    expect(CharacterConfigSchema.safeParse(config).success).toBe(false);
    const unknown = createDefaultConfig('female') as unknown as { body: { sliders: object } };
    unknown.body.sliders = { tail: 0.2 };
    expect(CharacterConfigSchema.safeParse(unknown).success).toBe(false);
  });

  it('starts without socks and rejects an unknown sock style or sheerness', () => {
    const config = createDefaultConfig('female');
    expect(config.socks).toEqual({ style: 'none', color: '#1b1b1d', sheer: 0.5 });
    (config.socks as { style: string }).style = 'fishnet';
    expect(CharacterConfigSchema.safeParse(config).success).toBe(false);
    const sheer = createDefaultConfig('female');
    sheer.socks.sheer = 1.2;
    expect(CharacterConfigSchema.safeParse(sheer).success).toBe(false);
  });

  it('rejects an unknown hair pattern and malformed colours', () => {
    const config = createDefaultConfig('female');
    (config.hair.pattern as { type: string }).type = 'rainbow';
    expect(CharacterConfigSchema.safeParse(config).success).toBe(false);
    const colour = createDefaultConfig('female');
    colour.hair.color.dye = 'red';
    expect(CharacterConfigSchema.safeParse(colour).success).toBe(false);
  });
});

describe('migrateConfig', () => {
  it('passes a current config through unchanged', () => {
    const config = createDefaultConfig('male');
    expect(migrateConfig(config)).toEqual(config);
  });

  it('turns a v1 anime config into a valid v2 config keeping what carries over', () => {
    const migrated = migrateConfig(V1_ANIME);
    expect(migrated).not.toBeNull();
    expect(CharacterConfigSchema.safeParse(migrated).success).toBe(true);
    expect(migrated!.base).toBe('female');
    expect(migrated!.style).toBe('realistic');
    expect(migrated!.body.preset).toBe('curvy');
    expect(migrated!.body.sliders.height).toBeCloseTo(0.5);
    expect(migrated!.accessories).toEqual(['earring_hoop']);
    expect(migrated!.tattoos).toEqual([{ design: 'rose', placement: 'wrist' }]);
  });

  it('gives a v2 config no socks and keeps everything else', () => {
    // A default config has no socks on: stripped of them, it is a stored v2 document.
    const current = createDefaultConfig('female');
    current.hair.style = 'groom.hair.Hair_M_BobCurly';
    const v2: Record<string, unknown> = { ...current, schemaVersion: 2 };
    delete v2.socks;
    expect(migrateConfig(v2)).toEqual(current);
  });

  it('brings a v1 config to the current version with no socks', () => {
    const migrated = migrateConfig(V1_ANIME);
    expect(migrated!.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated!.socks.style).toBe('none');
  });

  it('returns null for values that are no config at all', () => {
    expect(migrateConfig(null)).toBeNull();
    expect(migrateConfig({ schemaVersion: 1, base: 'robot' })).toBeNull();
    expect(migrateConfig({ schemaVersion: 99 })).toBeNull();
    expect(migrateConfig({ schemaVersion: 2, base: 'female' })).toBeNull();
  });
});
