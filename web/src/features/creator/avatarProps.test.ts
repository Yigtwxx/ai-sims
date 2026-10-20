import { describe, expect, it } from 'vitest';

import { createDefaultConfig } from '@/lib/character/defaults';

import {
  reconcileConfig,
  skinToneHex,
  SKIN_TONES,
  skinToneValue,
  toAvatarProps,
} from './avatarProps';
import type { VrmManifest } from './manifest';

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
    entry('cap__hair', 'hair', 'unisex'),
  ],
} as VrmManifest;

describe('skin tone ramp', () => {
  it('maps the ends of the slider to the ends of the ramp', () => {
    expect(skinToneHex(0)).toBe(SKIN_TONES[0]);
    expect(skinToneHex(1)).toBe(SKIN_TONES.at(-1));
  });

  it('round-trips swatch indices', () => {
    SKIN_TONES.forEach((hex, i) => expect(skinToneHex(skinToneValue(i))).toBe(hex));
  });
});

describe('toAvatarProps', () => {
  it('resolves base, parts and tints from the manifest', () => {
    const config = createDefaultConfig('anime', 'female');
    config.face.preset = 'fem__base';
    config.hair.style = 'donor__hair';
    config.outfit.top.id = 'donor__top';
    config.outfit.bottom.id = 'none';
    config.outfit.shoes.id = 'base';
    const props = toAvatarProps(config, MANIFEST)!;
    expect(props.baseUrl).toBe('/assets/vrm/parts/fem__base.vrm');
    expect(props.parts.hair).toBe('/assets/vrm/parts/donor__hair.vrm');
    expect(props.parts.bottom).toBeNull();
    expect(props.parts.shoes).toBeUndefined();
    expect(props.tints.skin).toBe(SKIN_TONES[0]);
  });
});

describe('reconcileConfig', () => {
  it('replaces ids the manifest does not offer for the gender', () => {
    const config = createDefaultConfig('anime', 'male');
    config.face.preset = 'missing__base';
    config.hair.style = 'donor__hair'; // female-only
    const next = reconcileConfig(config, MANIFEST);
    expect(next.face.preset).toBe('masc__base');
    expect(next.hair.style).toBe('cap__hair');
  });

  it('keeps sentinel ids untouched', () => {
    const config = createDefaultConfig('anime', 'female');
    config.face.preset = 'fem__base';
    config.outfit.top.id = 'none';
    config.outfit.shoes.id = 'base';
    const next = reconcileConfig(config, MANIFEST);
    expect(next.outfit.top.id).toBe('none');
    expect(next.outfit.shoes.id).toBe('base');
  });
});
