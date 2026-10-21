import { describe, expect, it } from 'vitest';

import { fixtureManifest } from '@/features/creator/fixtures/manifest';

import { isSafeThumbnailPath, isWebp, thumbnailTargets } from './thumbTargets';

describe('thumbnailTargets', () => {
  const manifest = fixtureManifest();

  it('lists faces first, then grooms, with manifest or derived paths', () => {
    const face = manifest.faces[0];
    const withoutThumb = {
      ...manifest,
      faces: [{ ...face, thumbnail: undefined }, ...manifest.faces.slice(1)],
    };
    const targets = thumbnailTargets(withoutThumb);
    expect(targets[0]).toEqual({
      id: face.id,
      kind: 'face',
      file: `${face.head.slice(0, face.head.lastIndexOf('/'))}/thumbnail.webp`,
      inManifest: false,
    });
    expect(targets.filter((target) => target.kind === 'face')).toHaveLength(manifest.faces.length);
    expect(targets.at(-1)?.kind).not.toBe('face');
  });

  it('lists every outfit last, its image beside its files unless the manifest names one', () => {
    const [jeans, hoodie] = ['Bottom_Jeans', 'Top_Hoodie'].map((id) =>
      manifest.outfits.find((outfit) => outfit.id === id)!,
    );
    const outfits = [
      { ...jeans, id: 'outfit.OA_Jeans', thumbnail: undefined },
      {
        ...jeans,
        id: 'outfit.OA_Boots',
        category: 'shoes' as const,
        thumbnail: undefined,
        files: { male: 'outfits/OA_Boots/male.glb' },
      },
      { ...hoodie, id: 'outfit.OA_Hoodie', thumbnail: 'outfits/OA_Hoodie/thumbnail.webp' },
      { ...hoodie, id: 'outfit.Unexported', thumbnail: undefined, files: {} },
    ];
    const targets = thumbnailTargets({ ...manifest, outfits });
    expect(targets.slice(-3)).toEqual([
      {
        id: 'outfit.OA_Jeans',
        kind: 'outfit',
        category: 'bottom',
        file: 'outfits/Bottom_Jeans/thumbnail.webp',
        inManifest: false,
      },
      {
        id: 'outfit.OA_Boots',
        kind: 'outfit',
        category: 'shoes',
        file: 'outfits/OA_Boots/thumbnail.webp',
        inManifest: false,
      },
      {
        id: 'outfit.OA_Hoodie',
        kind: 'outfit',
        category: 'top',
        file: 'outfits/OA_Hoodie/thumbnail.webp',
        inManifest: true,
      },
    ]);
    // An outfit without files cannot be rendered.
    expect(targets.some((target) => target.id === 'outfit.Unexported')).toBe(false);
    expect(
      targets
        .filter((target) => target.kind === 'outfit')
        .every((t) => isSafeThumbnailPath(t.file)),
    ).toBe(true);
  });
});

describe('isSafeThumbnailPath', () => {
  it('accepts plain manifest paths to thumbnail.webp', () => {
    expect(isSafeThumbnailPath('faces/Ada/thumbnail.webp')).toBe(true);
    expect(isSafeThumbnailPath('grooms/hair/Hair_M_Bob/thumbnail.webp')).toBe(true);
  });

  it.each([
    '../web/thumbnail.webp',
    'faces/../../thumbnail.webp',
    'faces/./thumbnail.webp',
    '/faces/Ada/thumbnail.webp',
    'C:/faces/thumbnail.webp',
    'faces\\Ada\\thumbnail.webp',
    'faces//thumbnail.webp',
    'faces/Ada/head.glb',
    'thumbnail.webp',
  ])('refuses %s', (file) => {
    expect(isSafeThumbnailPath(file)).toBe(false);
  });
});

describe('isWebp', () => {
  it('checks the RIFF/WEBP header', () => {
    const header = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 \0\0\0\0');
    expect(isWebp(header)).toBe(true);
    expect(isWebp(new TextEncoder().encode('\x89PNG\r\n\x1a\n0000000000'))).toBe(false);
  });
});
