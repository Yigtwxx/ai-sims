import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './defaults';
import { CharacterConfigSchema } from './schema';

describe('CharacterConfigSchema', () => {
  it.each(['male', 'female'] as const)('accepts the default %s config', (base) => {
    const config = createDefaultConfig(base);
    expect(config.base).toBe(base);
    expect(CharacterConfigSchema.safeParse(config).success).toBe(true);
  });

  it('returns independent copies from createDefaultConfig', () => {
    const a = createDefaultConfig('male');
    a.hair.color = '#ffffff';
    expect(createDefaultConfig('male').hair.color).not.toBe('#ffffff');
  });

  it('rejects an invalid hex color', () => {
    const config = createDefaultConfig('male');
    config.eyes.color = 'blue';
    expect(CharacterConfigSchema.safeParse(config).success).toBe(false);

    const outfit = createDefaultConfig('female');
    outfit.outfit.top.color = '#12345';
    expect(CharacterConfigSchema.safeParse(outfit).success).toBe(false);
  });

  it('rejects an out-of-range skin tone', () => {
    for (const tone of [-0.1, 1.1]) {
      const config = createDefaultConfig('male');
      config.skin.tone = tone;
      expect(CharacterConfigSchema.safeParse(config).success).toBe(false);
    }
  });

  it('rejects out-of-range face blend weights', () => {
    const config = createDefaultConfig('male');
    config.face.blend = { face_m_02: 1.5 };
    expect(CharacterConfigSchema.safeParse(config).success).toBe(false);
  });

  it('rejects a wrong schemaVersion', () => {
    const config = { ...createDefaultConfig('male'), schemaVersion: 2 };
    expect(CharacterConfigSchema.safeParse(config).success).toBe(false);
  });

  it('rejects an unknown base', () => {
    const config = { ...createDefaultConfig('male'), base: 'other' };
    expect(CharacterConfigSchema.safeParse(config).success).toBe(false);
  });
});
