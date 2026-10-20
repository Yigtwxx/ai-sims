import { describe, expect, it } from 'vitest';

import { MhManifestSchema } from '@/lib/assets/manifest';
import { createDefaultConfig } from '@/lib/character/defaults';

import { BASE_HEIGHT, HEIGHT_RANGE, resolveCharacter } from './resolve';

const manifest = MhManifestSchema.parse({
  version: 2,
  generatedAt: 'test',
  faces: [
    { id: 'Ada', label: 'Ada', gender: 'female', head: 'faces/Ada/head.glb', defaultSkin: 'Ada' },
    { id: 'Aoi', label: 'Aoi', gender: 'female', head: 'faces/Aoi/head.glb', defaultSkin: 'Aoi' },
    {
      id: 'Bruce',
      label: 'Bruce',
      gender: 'male',
      head: 'faces/Bruce/head.glb',
      defaultSkin: 'Bruce',
    },
  ],
  skins: [],
  bodies: [
    {
      gender: 'female',
      glb: 'bodies/female/body.glb',
      sliders: [{ id: 'height', min: -1, max: 1, default: 0 }],
      presets: {},
    },
  ],
});

describe('resolveCharacter', () => {
  it('maps the face preset and gender body to asset URLs', () => {
    const config = createDefaultConfig('female');
    config.face.preset = 'Aoi';
    const resolved = resolveCharacter(config, manifest);
    expect(resolved).toMatchObject({
      faceId: 'Aoi',
      headUrl: '/assets/mh/faces/Aoi/head.glb',
      bodyUrl: '/assets/mh/bodies/female/body.glb',
      height: BASE_HEIGHT.female,
    });
  });

  it('falls back to the first face of the same gender for an unknown preset', () => {
    const config = createDefaultConfig('female');
    config.face.preset = 'Gone';
    expect(resolveCharacter(config, manifest)?.faceId).toBe('Ada');
  });

  it('frames taller characters by the height slider', () => {
    const config = createDefaultConfig('female');
    config.body.sliders.height = 0.5;
    expect(resolveCharacter(config, manifest)?.height).toBeCloseTo(
      BASE_HEIGHT.female + 0.5 * HEIGHT_RANGE,
    );
  });

  it('returns null when the manifest has no body for the gender', () => {
    expect(resolveCharacter(createDefaultConfig('male'), manifest)).toBeNull();
  });
});
