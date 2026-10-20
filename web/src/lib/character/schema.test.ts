import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './defaults';
import { CharacterConfigSchema } from './schema';

describe('CharacterConfigSchema', () => {
  it.each([
    ['anime', 'male'],
    ['anime', 'female'],
    ['realistic', 'male'],
    ['realistic', 'female'],
  ] as const)('accepts the default %s %s config', (style, base) => {
    const config = createDefaultConfig(style, base);
    expect(config.style).toBe(style);
    expect(config.base).toBe(base);
    expect(CharacterConfigSchema.safeParse(config).success).toBe(true);
  });

  it('returns independent copies from createDefaultConfig', () => {
    const a = createDefaultConfig('anime', 'male');
    a.hair.color = '#123456';
    a.accessories.push('earring_hoop');
    const b = createDefaultConfig('anime', 'male');
    expect(b.hair.color).not.toBe('#123456');
    expect(b.accessories).toEqual([]);
  });

  it('rejects a height outside the supported range', () => {
    for (const height of [0.5, 1.5]) {
      const config = createDefaultConfig('anime', 'female');
      config.body.height = height;
      expect(CharacterConfigSchema.safeParse(config).success).toBe(false);
    }
  });

  it('rejects an unknown body build', () => {
    const config = createDefaultConfig('anime', 'female');
    (config.body as { build: string }).build = 'giant';
    expect(CharacterConfigSchema.safeParse(config).success).toBe(false);
  });

  it('limits the number of tattoos', () => {
    const config = createDefaultConfig('anime', 'female');
    config.tattoos = Array.from({ length: 5 }, (_, i) => ({ design: `d${i}`, placement: 'arm' }));
    expect(CharacterConfigSchema.safeParse(config).success).toBe(false);
  });

  it('rejects an invalid hex color', () => {
    const config = createDefaultConfig('anime', 'male');
    config.eyes.color = 'blue';
    expect(CharacterConfigSchema.safeParse(config).success).toBe(false);

    const outfit = createDefaultConfig('anime', 'female');
    outfit.outfit.top.color = '#12345';
    expect(CharacterConfigSchema.safeParse(outfit).success).toBe(false);
  });

  it('rejects an out-of-range skin tone', () => {
    for (const tone of [-0.1, 1.1]) {
      const config = createDefaultConfig('anime', 'male');
      config.skin.tone = tone;
      expect(CharacterConfigSchema.safeParse(config).success).toBe(false);
    }
  });

  it('rejects out-of-range face blend weights', () => {
    const config = createDefaultConfig('anime', 'male');
    config.face.blend = { face_m_02: 1.5 };
    expect(CharacterConfigSchema.safeParse(config).success).toBe(false);
  });

  it('rejects a wrong schemaVersion', () => {
    const config = { ...createDefaultConfig('anime', 'male'), schemaVersion: 2 };
    expect(CharacterConfigSchema.safeParse(config).success).toBe(false);
  });

  it('rejects an unknown style', () => {
    const config = { ...createDefaultConfig('anime', 'male'), style: 'cartoon' };
    expect(CharacterConfigSchema.safeParse(config).success).toBe(false);
  });

  it('rejects an unknown base', () => {
    const config = { ...createDefaultConfig('anime', 'male'), base: 'other' };
    expect(CharacterConfigSchema.safeParse(config).success).toBe(false);
  });
});
