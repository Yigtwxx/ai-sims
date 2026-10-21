import { describe, expect, it } from 'vitest';

import { CharacterConfigSchema } from '@/lib/character/schema';
import { createDefaultConfig } from '@/lib/character/defaults';

import { fixtureManifest } from './fixtures/manifest';
import { randomConfig } from './randomize';
import {
  facesFor,
  groomsFor,
  outfitsFor,
  presetsFor,
  presetSliders,
  reconcileAccessories,
  reconcileConfig,
  skinsByTone,
  startingConfig,
} from './reconcile';

// Its male body has no curvy preset, as the pipeline exports it.
const manifest = fixtureManifest();

/** Deterministic pseudo random sequence for repeatable tests. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe('manifest queries', () => {
  it('returns faces of the base gender', () => {
    expect(facesFor(manifest, 'male').every((face) => face.gender === 'male')).toBe(true);
  });

  it('sorts skins from light to dark', () => {
    const tones = skinsByTone(manifest).map((skin) => skin.tone);
    expect(tones).toEqual([...tones].sort((a, b) => a - b));
  });

  it('hides male-only grooms and outfits without a mesh for the body', () => {
    expect(groomsFor(manifest, 'beard', 'female')).toEqual([]);
    expect(outfitsFor(manifest, 'top', 'male').some((o) => o.id === 'Top_CropTop')).toBe(false);
  });

  it('fills every slider of a body preset', () => {
    const sliders = presetSliders(manifest, 'female', 'athletic');
    expect(Object.keys(sliders)).toHaveLength(7);
    expect(sliders.muscle).toBeCloseTo(0.75);
    expect(sliders.height).toBe(0);
  });

  it('lists the body presets the base offers', () => {
    expect(presetsFor(manifest, 'male')).toEqual(['slim', 'average', 'athletic']);
    expect(presetsFor(manifest, 'female')).toEqual(['slim', 'average', 'athletic', 'curvy']);
  });
});

describe('reconcileConfig', () => {
  it('replaces ids the manifest does not offer with the first available', () => {
    const config = createDefaultConfig('male');
    config.face.preset = 'Nobody';
    config.skin.set = 'Missing';
    config.hair.style = 'Hair_Gone';
    config.outfit.top = { id: 'Top_Gone', tint: 'x', colors: { Foo: '#000000' } };
    const next = reconcileConfig(config, manifest);
    expect(next.face.preset).toBe(facesFor(manifest, 'male')[0].id);
    expect(next.skin.set).toBe(next.face.preset);
    expect(next.hair.style).toBe(groomsFor(manifest, 'hair', 'male')[0].id);
    // The stand-in garment wears its first colour, as if picked.
    const standIn = outfitsFor(manifest, 'top', 'male')[0];
    expect(next.outfit.top).toEqual({
      id: standIn.id,
      tint: standIn.tintPresets[0]?.id ?? null,
      colors: {},
    });
  });

  it('keeps "none" choices and drops incompatible facial hair', () => {
    const config = createDefaultConfig('female');
    config.beard.style = 'Beard_Full';
    const next = reconcileConfig(config, manifest);
    expect(next.hair.style).toBeNull();
    expect(next.beard.style).toBeNull();
  });

  it('limits face blends to other faces of the same gender', () => {
    const config = createDefaultConfig('female');
    config.face.blend = { Ada: 0.5, Bruce: 0.4, Aera: 0.3, Aoi: 0.2, Hana: 0.1, Zuri: 0.5 };
    const next = reconcileConfig(config, manifest);
    expect(Object.keys(next.face.blend)).toEqual(['Aera', 'Aoi', 'Hana']);
  });

  it('lets a one-piece outfit replace top and bottom', () => {
    const config = createDefaultConfig('female');
    config.outfit.top = { id: 'Top_Hoodie', tint: null, colors: {} };
    config.outfit.full = { id: 'Full_Techwear', tint: 'sage', colors: {} };
    const next = reconcileConfig(config, manifest);
    expect(next.outfit.top).toBeNull();
    expect(next.outfit.full?.tint).toBe('sage');
  });

  it('keeps one accessory per slot and only known tattoos', () => {
    expect(reconcileAccessories(['ear-hoop-small', 'ear-stud-pearl', 'nose-stud', 'nope'])).toEqual(
      ['ear-hoop-small', 'nose-stud'],
    );
    const config = createDefaultConfig('female');
    config.tattoos = [
      { design: 'star', placement: 'ankle' },
      { design: 'moon', placement: 'ankle' },
      { design: 'dragon', placement: 'nape' },
    ];
    expect(reconcileConfig(config, manifest).tattoos).toEqual([
      { design: 'star', placement: 'ankle' },
    ]);
  });

  it('turns makeup off when the skin has no makeup maps', () => {
    const config = createDefaultConfig('male');
    config.skin = { set: 'Bruce', tone: 0, makeup: true };
    expect(reconcileConfig(config, manifest).skin.makeup).toBe(false);
  });

  it('turns a body preset the body does not offer into average, keeping the sliders', () => {
    const male = createDefaultConfig('male');
    male.body = { preset: 'curvy', sliders: { weight: 0.2 } };
    expect(reconcileConfig(male, manifest).body).toEqual({
      preset: 'average',
      sliders: { weight: 0.2 },
    });

    const female = createDefaultConfig('female');
    female.body.preset = 'curvy';
    expect(reconcileConfig(female, manifest).body.preset).toBe('curvy');
  });
});

describe('startingConfig', () => {
  it('starts with natural eyebrows and a valid config for each base', () => {
    for (const base of ['female', 'male'] as const) {
      const config = startingConfig(base, manifest);
      expect(config.base).toBe(base);
      expect(config.eyebrows.style).toBe('Brows_Natural');
      expect(CharacterConfigSchema.safeParse(config).success).toBe(true);
    }
  });

  it('starts with a hair style from the manifest for each base', () => {
    for (const base of ['female', 'male'] as const) {
      const style = startingConfig(base, manifest).hair.style;
      expect(manifest.grooms.some((g) => g.slot === 'hair' && g.id === style)).toBe(true);
    }
  });

  it('keeps eyebrows off when the manifest has none', () => {
    const bare = { ...manifest, grooms: manifest.grooms.filter((g) => g.slot !== 'eyebrows') };
    expect(startingConfig('female', bare).eyebrows.style).toBeNull();
  });
});

describe('randomConfig', () => {
  it('stays valid and inside the manifest for many seeds', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const base = seed % 2 === 0 ? 'female' : 'male';
      const next = randomConfig(createDefaultConfig(base), manifest, seeded(seed));
      expect(CharacterConfigSchema.safeParse(next).success).toBe(true);
      expect(reconcileConfig(next, manifest)).toEqual(next);
      expect(next.base).toBe(base);
    }
  });

  it('only picks body presets the body offers', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed += 1) {
      const next = randomConfig(createDefaultConfig('male'), manifest, seeded(seed));
      seen.add(next.body.preset);
      expect(reconcileConfig(next, manifest)).toEqual(next);
    }
    expect([...seen].sort()).toEqual(['athletic', 'average', 'slim']);
  });
});
