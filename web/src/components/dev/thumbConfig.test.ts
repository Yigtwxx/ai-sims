import { describe, expect, it } from 'vitest';

import { fixtureManifest } from '@/features/creator/fixtures/manifest';
import { CharacterConfigSchema } from '@/lib/character/schema';

import { irisFor, thumbConfig } from './thumbConfig';
import { thumbnailTargets } from './thumbTargets';

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
