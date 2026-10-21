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
