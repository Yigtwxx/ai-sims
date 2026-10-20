import { describe, expect, it } from 'vitest';

import { MhManifestSchema } from '@/lib/assets/manifest';
import { createDefaultConfig } from '@/lib/character/defaults';

import { BASE_HEIGHT, HEIGHT_RANGE, idleSet, MIN_CALM_IDLES, resolveCharacter } from './resolve';

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

  it('picks the configured skin set, else the face default', () => {
    const withSkins = {
      ...manifest,
      skins: ['Ada', 'Aoi'].map((id) => ({
        id,
        label: id,
        tone: 0.5,
        swatch: '#a07050',
        face: {
          albedo: `skins/${id}/face_albedo.ktx2`,
          normal: `skins/${id}/face_normal.ktx2`,
          wrinkleColor: [],
          wrinkleNormal: [],
          wrinkleMasks: [],
        },
        body: { albedo: `skins/${id}/body_albedo.ktx2`, normal: `skins/${id}/body_normal.ktx2` },
      })),
    };
    const config = createDefaultConfig('female');
    config.skin.set = 'Aoi';
    expect(resolveCharacter(config, withSkins)?.skin?.id).toBe('Aoi');
    config.skin.set = 'Gone';
    expect(resolveCharacter(config, withSkins)?.skin?.id).toBe('Ada');
    expect(resolveCharacter(config, manifest)?.skin).toBeNull();
  });

  describe('idleSet', () => {
    const withIdles = (tags: string[][]) =>
      MhManifestSchema.parse({
        ...manifest,
        animations: tags.map((clipTags, i) => ({
          id: `idle${i}`,
          kind: 'body',
          file: `animations/idle${i}.glb`,
          tags: clipTags,
        })),
      });

    it('drives the whole body with enough calm clips', () => {
      const set = idleSet(withIdles([...Array(MIN_CALM_IDLES)].map(() => ['idle', 'calm'])));
      expect(set.idleLayer).toBe('full');
      expect(set.idleClips).toHaveLength(MIN_CALM_IDLES);
    });

    it('falls back to the body layer of standing clips', () => {
      const set = idleSet(
        withIdles([['idle', 'calm'], ['idle', 'standing'], ['idle', 'standing'], ['idle']]),
      );
      expect(set).toEqual({
        idleLayer: 'body',
        idleClips: ['/assets/mh/animations/idle1.glb', '/assets/mh/animations/idle2.glb'],
      });
    });

    it('has no clips when nothing is tagged idle', () => {
      expect(idleSet(manifest).idleClips).toEqual([]);
    });
  });

  it('returns null when the manifest has no body for the gender', () => {
    expect(resolveCharacter(createDefaultConfig('male'), manifest)).toBeNull();
  });
});
