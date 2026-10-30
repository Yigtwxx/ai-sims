import { describe, expect, it } from 'vitest';

import { MhManifestSchema } from '@/lib/assets/manifest';
import { createDefaultConfig } from '@/lib/character/defaults';

import {
  BASE_HEIGHT,
  groomWears,
  HEIGHT_RANGE,
  idleSet,
  MIN_CALM_IDLES,
  outfitWears,
  resolveCharacter,
  tattooWears,
} from './resolve';

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

describe('groomWears', () => {
  const withGrooms = MhManifestSchema.parse({
    ...manifest,
    grooms: [
      { id: 'groom.hair.Bob', slot: 'hair', label: 'Bob', glb: 'grooms/hair/Bob/cards.glb' },
      {
        id: 'groom.eyebrows.Fine',
        slot: 'eyebrows',
        label: 'Fine',
        glb: 'grooms/eyebrows/Fine/cards.glb',
      },
    ],
  });

  it('wears the configured styles the manifest has and skips the rest', () => {
    const config = createDefaultConfig('female');
    config.hair.style = 'groom.hair.Bob';
    config.eyebrows.style = 'groom.eyebrows.Fine';
    config.beard.style = 'groom.beard.Gone';
    expect(groomWears(config, withGrooms).map((wear) => wear.groom.id)).toEqual([
      'groom.hair.Bob',
      'groom.eyebrows.Fine',
    ]);
  });

  it('gives facial hair the hair colour without the hair pattern', () => {
    const config = createDefaultConfig('female');
    config.hair.style = 'groom.hair.Bob';
    config.eyebrows.style = 'groom.eyebrows.Fine';
    config.hair.color = { melanin: 0.2, redness: 0.6, dye: '#ffffff' };
    config.hair.pattern = { type: 'ombre', color: '#000000', amount: 0.8 };
    const [hair, brows] = groomWears(config, withGrooms);
    expect(hair!.look).toMatchObject({ melanin: 0.2, pattern: 'ombre', patternAmount: 0.8 });
    expect(brows!.look).toMatchObject({ melanin: 0.2, redness: 0.6, pattern: 'none' });
    for (const channel of brows!.look.dye!) expect(channel).toBeCloseTo(1);
  });
});

describe('outfitWears', () => {
  const colorParams = ['A', 'B', 'C'].map((name) => ({
    name,
    type: 'color',
    default: '#444444',
  }));
  const piece = (
    id: string,
    category: 'top' | 'bottom' | 'shoes' | 'full',
    files: { female?: string; male?: string },
  ) => ({
    id,
    category,
    label: id,
    files,
    params: colorParams,
    tintPresets: [
      // The non-colour value is not a colour parameter and must be ignored.
      { id: 'mono', values: { A: '#ffffff', B: '#000000', C: '#808080', Gloss: 0.5 } },
    ],
  });
  const withOutfits = MhManifestSchema.parse({
    ...manifest,
    outfits: [
      piece('outfit.Suit', 'full', { female: 'outfits/Suit/f.glb', male: 'outfits/Suit/m.glb' }),
      piece('outfit.Hoodie', 'top', {
        female: 'outfits/Hoodie/f.glb',
        male: 'outfits/Hoodie/m.glb',
      }),
      piece('outfit.Jeans', 'bottom', { female: 'outfits/Jeans/f.glb' }),
      piece('outfit.Boots', 'shoes', { male: 'outfits/Boots/m.glb' }),
      piece('outfit.Flats', 'shoes', { female: 'outfits/Flats/f.glb' }),
    ],
  });
  const item = (id: string, tint: string | null = null, colors: Record<string, string> = {}) => ({
    id,
    tint,
    colors,
  });
  const expectRgb = (actual: readonly number[] | undefined, expected: readonly number[]) => {
    expect(actual).toHaveLength(3);
    expected.forEach((channel, i) => expect(actual![i]).toBeCloseTo(channel, 5));
  };

  it('wears nothing by default', () => {
    expect(outfitWears(createDefaultConfig('female'), withOutfits)).toEqual([]);
  });

  it('lists the one-piece outfit first, then top, bottom and shoes', () => {
    const config = createDefaultConfig('female');
    config.outfit = {
      shoes: item('outfit.Flats'),
      bottom: item('outfit.Jeans'),
      top: item('outfit.Hoodie'),
      full: item('outfit.Suit'),
    };
    const wears = outfitWears(config, withOutfits);
    expect(wears.map((wear) => wear.outfit.id)).toEqual([
      'outfit.Suit',
      'outfit.Hoodie',
      'outfit.Jeans',
      'outfit.Flats',
    ]);
    expect(wears.map((wear) => wear.file)).toEqual([
      'outfits/Suit/f.glb',
      'outfits/Hoodie/f.glb',
      'outfits/Jeans/f.glb',
      'outfits/Flats/f.glb',
    ]);
  });

  it('skips ids the manifest lacks and items without a mesh for the body', () => {
    const config = createDefaultConfig('female');
    config.outfit = {
      full: null,
      top: item('outfit.Gone'),
      bottom: item('outfit.Jeans'),
      shoes: item('outfit.Boots'),
    };
    expect(outfitWears(config, withOutfits).map((wear) => wear.outfit.id)).toEqual([
      'outfit.Jeans',
    ]);

    const male = createDefaultConfig('male');
    male.outfit = config.outfit;
    const wears = outfitWears(male, withOutfits);
    expect(wears.map((wear) => [wear.outfit.id, wear.file])).toEqual([
      ['outfit.Boots', 'outfits/Boots/m.glb'],
    ]);
  });

  it('converts the tint preset from sRGB hex to linear RGB', () => {
    const config = createDefaultConfig('female');
    config.outfit.top = item('outfit.Hoodie', 'mono');
    const [wear] = outfitWears(config, withOutfits);
    expect(Object.keys(wear!.colors).sort()).toEqual(['A', 'B', 'C']);
    expectRgb(wear!.colors.A, [1, 1, 1]);
    expectRgb(wear!.colors.B, [0, 0, 0]);
    // sRGB 0x80 is 0.2159 in linear light, not 0.5.
    expectRgb(wear!.colors.C, [0.21586, 0.21586, 0.21586]);
  });

  it('lets the creator picks override the preset', () => {
    const config = createDefaultConfig('female');
    config.outfit.top = item('outfit.Hoodie', 'mono', { B: '#ffffff', A: '#000000' });
    const [wear] = outfitWears(config, withOutfits);
    expectRgb(wear!.colors.A, [0, 0, 0]);
    expectRgb(wear!.colors.B, [1, 1, 1]);
    expectRgb(wear!.colors.C, [0.21586, 0.21586, 0.21586]);
  });

  it('uses only the picks without a tint preset', () => {
    const config = createDefaultConfig('female');
    config.outfit.top = item('outfit.Hoodie', null, { B: '#ffffff' });
    config.outfit.bottom = item('outfit.Jeans', 'gone');
    const [top, bottom] = outfitWears(config, withOutfits);
    expect(Object.keys(top!.colors)).toEqual(['B']);
    expectRgb(top!.colors.B, [1, 1, 1]);
    expect(bottom!.colors).toEqual({});
  });
});

describe('iris fallback', () => {
  const base = {
    version: 2,
    generatedAt: 'test',
    bodies: manifest.bodies,
    skins: [
      {
        id: 'skin.Aoi',
        label: 'Aoi',
        tone: 0.4,
        swatch: '#8a5a44',
        face: { albedo: 'a.ktx2', normal: 'n.ktx2' },
        body: { albedo: 'b.ktx2', normal: 'bn.ktx2' },
      },
    ],
    irises: [
      { id: 'iris.Ada', label: 'Ada', color: 'ia.ktx2', swatch: '#241706' },
      { id: 'iris.Aoi', label: 'Aoi', color: 'io.ktx2', swatch: '#3a2a18' },
    ],
  };

  it("borrows the skin preset's iris for a face exported without eyes", () => {
    const withBruce = MhManifestSchema.parse({
      ...base,
      faces: [
        {
          id: 'face.Bruce',
          label: 'Bruce',
          gender: 'female',
          head: 'faces/Bruce/head.glb',
          defaultSkin: 'skin.Aoi',
        },
      ],
    });
    const config = createDefaultConfig('female');
    config.face.preset = 'face.Bruce';
    expect(resolveCharacter(config, withBruce)?.iris?.id).toBe('iris.Aoi');
  });
});

describe('iris tint', () => {
  const withIris = MhManifestSchema.parse({
    ...manifest,
    irises: [{ id: 'iris.Ada', label: 'Ada', color: 'ia.ktx2', swatch: '#808080' }],
  });

  it('is off without a configured colour', () => {
    const config = createDefaultConfig('female');
    config.eyes.color = null;
    expect(resolveCharacter(config, withIris)?.irisTint).toBeNull();
  });

  it("is the linear colour against the worn iris's own brightness", () => {
    const config = createDefaultConfig('female');
    config.eyes.iris = 'iris.Ada';
    config.eyes.color = '#ffffff';
    const tint = resolveCharacter(config, withIris)?.irisTint;
    expect(tint?.color).toEqual([1, 1, 1]);
    // #808080 is 0.2159 in linear light.
    expect(tint?.reference).toBeCloseTo(0.2159, 3);
  });
});

describe('socks', () => {
  it('wears none by default and the configured length for the body', () => {
    const config = createDefaultConfig('female');
    expect(resolveCharacter(config, manifest)?.socks).toBeNull();
    config.socks = { style: 'tights', color: '#1b1b1d', sheer: 0.7 };
    expect(resolveCharacter(config, manifest)?.socks).toMatchObject({
      fabric: 'nylon',
      sheer: 0.7,
    });
  });

  it("points at the body's toe envelope when the manifest has one", () => {
    const config = createDefaultConfig('female');
    expect(resolveCharacter(config, manifest)?.sockToesUrl).toBeNull();
    const withToes = MhManifestSchema.parse({
      ...manifest,
      bodies: manifest.bodies.map((body) => ({
        ...body,
        socks: `bodies/${body.gender}/socks.bin`,
      })),
    });
    expect(resolveCharacter(config, withToes)?.sockToesUrl).toMatch(/bodies\/female\/socks\.bin$/);
  });
});

describe('face blend', () => {
  const blendManifest = MhManifestSchema.parse({
    ...manifest,
    faces: [
      ...manifest.faces,
      {
        id: 'Cara',
        label: 'Cara',
        gender: 'female',
        head: 'faces/Cara/head.glb',
        defaultSkin: 'Cara',
      },
      {
        id: 'Dana',
        label: 'Dana',
        gender: 'female',
        head: 'faces/Dana/head.glb',
        defaultSkin: 'Dana',
      },
      {
        id: 'Esra',
        label: 'Esra',
        gender: 'female',
        head: 'faces/Esra/head.glb',
        defaultSkin: 'Esra',
      },
    ],
  });

  it('is empty without blend weights', () => {
    expect(resolveCharacter(createDefaultConfig('female'), blendManifest)?.blend).toEqual([]);
  });

  it('maps blend faces to their heads, heaviest first', () => {
    const config = createDefaultConfig('female');
    config.face.preset = 'Ada';
    config.face.blend = { Aoi: 0.2, Cara: 0.5 };
    expect(resolveCharacter(config, blendManifest)?.blend).toEqual([
      { headUrl: '/assets/mh/faces/Cara/head.glb', weight: 0.5 },
      { headUrl: '/assets/mh/faces/Aoi/head.glb', weight: 0.2 },
    ]);
  });

  it('skips unknown faces, the other gender, the worn face and zero weights', () => {
    const config = createDefaultConfig('female');
    config.face.preset = 'Ada';
    config.face.blend = { Gone: 0.5, Bruce: 0.5, Ada: 0.5, Aoi: 0 };
    expect(resolveCharacter(config, blendManifest)?.blend).toEqual([]);
  });

  it('keeps at most three faces, the heaviest', () => {
    const config = createDefaultConfig('female');
    config.face.preset = 'Ada';
    config.face.blend = { Aoi: 0.1, Cara: 0.4, Dana: 0.3, Esra: 0.2 };
    expect(resolveCharacter(config, blendManifest)?.blend.map((b) => b.weight)).toEqual([
      0.4, 0.3, 0.2,
    ]);
  });
});

describe('tattooWears', () => {
  it('keeps known designs, the first tattoo per placement', () => {
    const config = createDefaultConfig('female');
    config.tattoos = [
      { design: 'star', placement: 'nape' },
      { design: 'moon', placement: 'nape' },
      { design: 'dragon', placement: 'ankle' },
      { design: 'leaf', placement: 'elbow' },
      { design: 'bird', placement: 'ankle' },
    ];
    expect(tattooWears(config)).toEqual([
      { design: 'star', placement: 'nape' },
      { design: 'bird', placement: 'ankle' },
    ]);
  });
});
