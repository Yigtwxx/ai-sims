import { describe, expect, it } from 'vitest';

import { fixtureManifest } from '@/features/creator/fixtures/manifest';
import { startingConfig } from '@/features/creator/reconcile';
import { createDefaultConfig } from '@/lib/character/defaults';
import { CharacterConfigSchema } from '@/lib/character/schema';

import { irisFor, outfitBase, thumbConfig, thumbShot } from './thumbConfig';
import { thumbnailTargets, type ThumbTarget } from './thumbTargets';

const manifest = fixtureManifest();
const target = (id: string) => {
  const found = thumbnailTargets(manifest).find((entry) => entry.id === id);
  if (!found) throw new Error(`no target ${id}`);
  return found;
};

describe('thumbConfig', () => {
  it('shows a face with its own skin and iris, a natural brow and the starting cut', () => {
    const face = manifest.faces.find((entry) => entry.gender === 'male')!;
    const config = thumbConfig(manifest, target(face.id));
    expect(config).toMatchObject({
      base: 'male',
      face: { preset: face.id, blend: {} },
      skin: { set: face.defaultSkin },
      hair: { style: startingConfig('male', manifest).hair.style },
      eyebrows: { style: 'Brows_Natural' },
      beard: { style: null },
    });
    expect(config?.hair.style).not.toBeNull();
    expect(config?.eyes.iris).toBe(irisFor(manifest, face));
    expect(config?.eyes.iris).not.toBeNull();
    expect(CharacterConfigSchema.safeParse(config).success).toBe(true);
  });

  it("shows a woman's face with the starting cut", () => {
    const face = manifest.faces.find((entry) => entry.gender === 'female')!;
    const config = thumbConfig(manifest, target(face.id));
    expect(config?.hair.style).toBe(startingConfig('female', manifest).hair.style);
    expect(config?.hair.style).not.toBeNull();
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

  it('shows faces and grooms undressed, though new characters start dressed', () => {
    const face = manifest.faces[0];
    const bare = { top: null, bottom: null, shoes: null, full: null };
    expect(thumbConfig(manifest, target(face.id))?.outfit).toEqual(bare);
    expect(thumbConfig(manifest, target('Beard_Full'))?.outfit).toEqual(bare);
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

describe('thumbShot', () => {
  const of = (kind: ThumbTarget['kind'], category?: ThumbTarget['category']) =>
    thumbShot({ kind, category });

  it('frames faces and hair as one bust, brows and facial hair close up', () => {
    expect(of('face')).toBe('bust');
    expect(of('hair')).toBe('bust');
    expect(of('eyebrows')).toBe('brows');
    expect(of('beard')).toBe('beard');
    expect(of('mustache')).toBe('mustache');
  });

  it('frames an outfit on the part of the body it covers', () => {
    expect(of('outfit', 'top')).toBe('top');
    expect(of('outfit', 'bottom')).toBe('bottom');
    expect(of('outfit', 'shoes')).toBe('shoes');
    expect(of('outfit', 'full')).toBe('full');
    expect(of('outfit')).toBe('full');
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
