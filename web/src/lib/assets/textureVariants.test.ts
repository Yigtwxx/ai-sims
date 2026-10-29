import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assetUrl } from './manifest';
import {
  TEXTURE_INDEX_URL,
  isPhone,
  loadTextureVariants,
  resetTextureVariants,
  textureUrl,
} from './textureVariants';

const INDEX = {
  version: 1,
  maxSize: 1024,
  suffix: '.1k.ktx2',
  files: ['skins/Ada/face_albedo.ktx2', 'outfits/Dress/dress_normal-1a2b.ktx2'],
};

function device({ coarse, width, height }: { coarse: boolean; width: number; height: number }) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: coarse && query.includes('coarse') }));
  vi.spyOn(window.screen, 'width', 'get').mockReturnValue(width);
  vi.spyOn(window.screen, 'height', 'get').mockReturnValue(height);
}

function serve(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => resetTextureVariants());

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('isPhone', () => {
  it('needs a touch screen with a short side under 600 px', () => {
    device({ coarse: true, width: 390, height: 844 });
    expect(isPhone()).toBe(true);
    device({ coarse: true, width: 1024, height: 1366 });
    expect(isPhone()).toBe(false);
    device({ coarse: false, width: 390, height: 844 });
    expect(isPhone()).toBe(false);
  });
});

describe('textureUrl', () => {
  it('swaps listed maps for their copies on phones', async () => {
    device({ coarse: true, width: 390, height: 844 });
    const fetchMock = serve(INDEX);
    await loadTextureVariants();
    expect(fetchMock).toHaveBeenCalledWith(TEXTURE_INDEX_URL, { cache: 'no-cache' });
    expect(textureUrl(assetUrl('skins/Ada/face_albedo.ktx2'))).toBe(
      assetUrl('skins/Ada/face_albedo.1k.ktx2'),
    );
    // A map a glTF file references resolves to the same asset URL.
    expect(textureUrl(assetUrl('outfits/Dress/dress_normal-1a2b.ktx2'))).toBe(
      assetUrl('outfits/Dress/dress_normal-1a2b.1k.ktx2'),
    );
  });

  it('leaves unlisted maps and other files alone', async () => {
    device({ coarse: true, width: 390, height: 844 });
    serve(INDEX);
    await loadTextureVariants();
    const small = assetUrl('irises/Ada/color.ktx2');
    expect(textureUrl(small)).toBe(small);
    expect(textureUrl('/basis/basis_transcoder.wasm')).toBe('/basis/basis_transcoder.wasm');
  });

  it('keeps full-size maps off phones without fetching the index', async () => {
    device({ coarse: false, width: 1440, height: 900 });
    const fetchMock = serve(INDEX);
    await loadTextureVariants();
    expect(fetchMock).not.toHaveBeenCalled();
    const map = assetUrl('skins/Ada/face_albedo.ktx2');
    expect(textureUrl(map)).toBe(map);
  });

  it.each([
    ['a missing index', () => serve({}, 404)],
    ['a malformed index', () => serve({ ...INDEX, version: 2 })],
    [
      'a network error',
      () =>
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => Promise.reject(new Error('offline'))),
        ),
    ],
  ])('falls back to full-size maps on %s', async (_, setup) => {
    device({ coarse: true, width: 390, height: 844 });
    setup();
    await expect(loadTextureVariants()).resolves.toBeUndefined();
    const map = assetUrl('skins/Ada/face_albedo.ktx2');
    expect(textureUrl(map)).toBe(map);
  });
});
