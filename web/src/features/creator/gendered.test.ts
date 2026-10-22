import { describe, expect, it } from 'vitest';

import type { MhManifest, MhSkin } from '@/lib/assets/manifest';
import { createDefaultConfig } from '@/lib/character/defaults';
import { CHARACTER_BASES } from '@/lib/character/schema';

import { fixtureManifest } from './fixtures/manifest';
import { randomConfig } from './randomize';
import { facesFor, reconcileConfig, skinGender, skinsFor, startingConfig } from './reconcile';

const manifest = fixtureManifest();

/** Deterministic pseudo random sequence for repeatable tests. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const genderOf = (base: 'female' | 'male') =>
  facesFor(manifest, base).map((face) => face.defaultSkin);

/** A skin no face defaults to, as several real presets are (Bo, Grace...). */
function faceless(source: MhManifest, overrides: Partial<MhSkin>): MhSkin {
  const template = source.skins[0]!;
  return { ...template, face: { ...template.face }, ...overrides };
}

describe('skin gender', () => {
  it('prefers the manifest tag, then the face that defaults to the skin', () => {
    const female = genderOf('female')[0]!;
    const skin = manifest.skins.find((entry) => entry.id === female)!;
    expect(skinGender(manifest, skin)).toBe('female');
    expect(skinGender(manifest, { ...skin, gender: 'male' })).toBe('male');
  });

  it('reads a skin without a face from its underwear straps', () => {
    const straps = faceless(manifest, {
      id: 'skin.Grace',
      face: {
        ...manifest.skins[0]!.face,
        underwear: { mask: 'skins/Grace/face_underwear.ktx2', color: '#7b7a7b' },
      },
    });
    const bare = faceless(manifest, { id: 'skin.Bo' });
    delete bare.face.underwear;
    expect(skinGender(manifest, straps)).toBe('female');
    expect(skinGender(manifest, bare)).toBe('male');
  });

  it('offers only the base gender, lightest first', () => {
    for (const base of CHARACTER_BASES) {
      const skins = skinsFor(manifest, base);
      const own = new Set(genderOf(base));
      expect(skins.length).toBeGreaterThan(0);
      expect(skins.every((skin) => own.has(skin.id))).toBe(true);
      const tones = skins.map((skin) => skin.tone);
      expect(tones).toEqual([...tones].sort((a, b) => a - b));
    }
  });

  it('reconciles a cross-gender skin to the face default', () => {
    const config = createDefaultConfig('female');
    const female = reconcileConfig(config, manifest);
    config.skin.set = genderOf('male')[0]!;
    const next = reconcileConfig(config, manifest);
    const face = manifest.faces.find((entry) => entry.id === female.face.preset)!;
    expect(next.skin.set).toBe(face.defaultSkin);
  });

  it('keeps a skin of the base gender', () => {
    const config = reconcileConfig(createDefaultConfig('male'), manifest);
    const other = skinsFor(manifest, 'male').find((skin) => skin.id !== config.skin.set)!;
    config.skin.set = other.id;
    expect(reconcileConfig(config, manifest).skin.set).toBe(other.id);
  });

  it('never randomizes into the other gender', () => {
    for (const base of CHARACTER_BASES) {
      const own = new Set(genderOf(base));
      for (let seed = 1; seed <= 40; seed += 1) {
        const next = randomConfig(createDefaultConfig(base), manifest, seeded(seed));
        expect(own.has(next.skin.set)).toBe(true);
      }
    }
  });
});

describe('starting outfit', () => {
  it('starts a new character in underwear, with no garment picked', () => {
    for (const base of CHARACTER_BASES) {
      const config = startingConfig(base, manifest);
      expect(config.outfit).toEqual({ top: null, bottom: null, shoes: null, full: null });
      expect(reconcileConfig(config, manifest)).toEqual(config);
    }
  });
});
