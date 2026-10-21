import { describe, expect, it } from 'vitest';

import { fixtureManifest } from '@/features/creator/fixtures/manifest';
import { createDefaultConfig } from '@/lib/character/defaults';
import { CharacterConfigSchema } from '@/lib/character/schema';

import { irisFor, outfitBase, thumbConfig, thumbFocus } from './thumbConfig';
import { thumbnailTargets, type ThumbTarget } from './thumbTargets';

const manifest = fixtureManifest();
const target = (id: string) => {
  const found = thumbnailTargets(manifest).find((entry) => entry.id === id);
  if (!found) throw new Error(`no target ${id}`);
  return found;
};

describe('thumbConfig', () => {
  it('shows a face with its own skin and iris, a natural brow and no hair', () => {
    const face = manifest.faces.find((entry) => entry.gender === 'male')!;
    const config = thumbConfig(manifest, target(face.id));
    expect(config).toMatchObject({
      base: 'male',
      face: { preset: face.id, blend: {} },
      skin: { set: face.defaultSkin },
      hair: { style: null },
      eyebrows: { style: 'Brows_Natural' },
      beard: { style: null },
    });
    expect(config?.eyes.iris).toBe(irisFor(manifest, face));
    expect(config?.eyes.iris).not.toBeNull();
    expect(CharacterConfigSchema.safeParse(config).success).toBe(true);
  });

  it('wears a beard on the first male face', () => {
    const config = thumbConfig(manifest, target('Beard_Full'));
    const male = manifest.faces.find((entry) => entry.gender === 'male')!;
    expect(config).toMatchObject({
      base: 'male',
      face: { preset: male.id },
      beard: { style: 'Beard_Full' },
      hair: { style: null },
    });
  });

  it('wears unisex hair on the first female face', () => {
    const hair = manifest.grooms.find(
      (groom) => groom.slot === 'hair' && groom.compat === 'unisex',
    )!;
    const config = thumbConfig(manifest, target(hair.id));
    expect(config).toMatchObject({ base: 'female', hair: { style: hair.id } });
  });
});

describe('thumbConfig for outfits', () => {
  const outfitTarget = (id: string): ThumbTarget => {
    const outfit = manifest.outfits.find((entry) => entry.id === id)!;
    return {
      id,
      kind: 'outfit',
      category: outfit.category,
      file: `outfits/${id}/thumbnail.webp`,
      inManifest: false,
    };
  };

  it('wears a unisex outfit alone, in its first colourway, on the default female figure', () => {
    const hoodie = manifest.outfits.find((entry) => entry.id === 'Top_Hoodie')!;
    const config = thumbConfig(manifest, outfitTarget(hoodie.id));
    const female = createDefaultConfig('female');
    const face = manifest.faces.find((entry) => entry.id === female.face.preset)!;
    expect(config).toMatchObject({
      base: 'female',
      face: { preset: face.id },
      skin: { set: face.defaultSkin },
      hair: { style: null },
      beard: { style: null },
      mustache: { style: null },
      outfit: {
        top: { id: hoodie.id, tint: hoodie.tintPresets[0]!.id, colors: {} },
        bottom: null,
        shoes: null,
        full: null,
      },
    });
    expect(CharacterConfigSchema.safeParse(config).success).toBe(true);
  });

  it('shows a male-only outfit on the default male figure', () => {
    const jeans = manifest.outfits.find((entry) => entry.id === 'Bottom_Jeans')!;
    const maleOnly = {
      ...jeans,
      id: 'Bottom_MaleOnly',
      compat: 'male' as const,
      files: { male: 'outfits/Bottom_MaleOnly/male.glb' },
    };
    const config = thumbConfig(
      { ...manifest, outfits: [...manifest.outfits, maleOnly] },
      { ...outfitTarget(jeans.id), id: maleOnly.id },
    );
    expect(config?.base).toBe('male');
    expect(config?.face.preset).toBe(createDefaultConfig('male').face.preset);
    expect(config?.outfit.bottom?.id).toBe(maleOnly.id);
  });

  it('falls back to the other base when the outfit has no file for its own yet', () => {
    const hoodie = manifest.outfits.find((entry) => entry.id === 'Top_Hoodie')!;
    const maleOnlyFile = { ...hoodie, files: { male: 'outfits/Top_Hoodie/male.glb' } };
    expect(outfitBase(maleOnlyFile)).toBe('male');
    expect(outfitBase({ ...hoodie, files: {} })).toBeNull();
    const config = thumbConfig({ ...manifest, outfits: [maleOnlyFile] }, outfitTarget(hoodie.id));
    expect(config).toMatchObject({ base: 'male', outfit: { top: { id: hoodie.id } } });
  });

  it('returns null for an outfit it cannot show', () => {
    expect(thumbConfig(manifest, { ...outfitTarget('Top_Hoodie'), id: 'Nobody' })).toBeNull();
  });
});

describe('thumbFocus', () => {
  const of = (kind: ThumbTarget['kind'], category?: ThumbTarget['category']) =>
    thumbFocus({ id: 'x', kind, category, file: 'x/thumbnail.webp', inManifest: false });

  it('frames faces and hair head and shoulders, brows and facial hair close up', () => {
    expect(of('face')).toBe('face');
    expect(of('hair')).toBe('face');
    expect(of('eyebrows')).toBe('brows');
    expect(of('beard')).toBe('mouth');
    expect(of('mustache')).toBe('mouth');
  });

  it('frames an outfit on the part of the body it covers', () => {
    expect(of('outfit', 'top')).toBe('torso');
    expect(of('outfit', 'bottom')).toBe('legs');
    expect(of('outfit', 'shoes')).toBe('feet');
    expect(of('outfit', 'full')).toBe('body');
  });
});

describe('irisFor', () => {
  it('falls back to the iris of the skin preset, then to any iris', () => {
    const face = { ...manifest.faces[0], defaultIris: undefined, defaultSkin: 'skin.Zed' };
    const other = { ...manifest.irises[0], id: 'iris.Other' };
    const zed = { ...manifest.irises[0], id: 'iris.Zed' };
    expect(irisFor({ ...manifest, irises: [other, zed] }, face)).toBe('iris.Zed');
    expect(irisFor({ ...manifest, irises: [other] }, face)).toBe('iris.Other');
    expect(irisFor({ ...manifest, irises: [] }, face)).toBeNull();
    expect(irisFor(manifest, { ...face, defaultIris: 'iris.Own' })).toBe('iris.Own');
  });
});
