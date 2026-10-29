import { z } from 'zod';

import { ASSET_ROOT } from './manifest';

/**
 * Phone-sized texture copies (pipeline `asset_pipeline/mh/mobile.py`): every KTX2 map
 * larger than 1024 px has a sibling without its top mip levels, listed in
 * `mobile-textures.json`. A phone never draws those levels, even in the face close-up,
 * yet they are most of the download (70 -> 26 MB for the first character) and of the
 * GPU memory. On phones the KTX2 loader fetches the copies instead (`textureUrl`).
 */
export const TEXTURE_INDEX_URL = `${ASSET_ROOT}/mobile-textures.json`;

const TextureIndexSchema = z.object({
  version: z.literal(1),
  maxSize: z.number().int().positive(),
  suffix: z.string().regex(/^\.[a-z0-9]+\.ktx2$/),
  files: z.array(z.string().min(1)),
});

let copies: ReadonlySet<string> = new Set();
let suffix = '';
let pending: Promise<void> | null = null;

/** A touch screen whose short side is under 600 CSS px; tablets keep the full maps. */
export function isPhone(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  const shortSide = Math.min(window.screen.width, window.screen.height);
  return window.matchMedia('(pointer: coarse)').matches && shortSide < 600;
}

/**
 * Reads the index once per page on phones, before the first texture loads (the
 * manifest hook waits for it). Elsewhere, and when the index is missing or
 * malformed, every texture loads at full size; it never rejects.
 */
export function loadTextureVariants(): Promise<void> {
  if (!isPhone()) return Promise.resolve();
  pending ??= fetch(TEXTURE_INDEX_URL, { cache: 'no-cache' })
    .then(async (response) => {
      if (!response.ok) return;
      const index = TextureIndexSchema.parse(await response.json());
      copies = new Set(index.files);
      suffix = index.suffix;
    })
    .catch(() => undefined);
  return pending;
}

/** The URL to fetch for a texture: its phone copy when it has one, else the URL as is. */
export function textureUrl(url: string): string {
  const prefix = `${ASSET_ROOT}/`;
  if (copies.size === 0 || !url.startsWith(prefix)) return url;
  const file = url.slice(prefix.length);
  return copies.has(file) ? `${prefix}${file.replace(/\.ktx2$/, suffix)}` : url;
}

/** Test hook: forgets the loaded index. */
export function resetTextureVariants(): void {
  copies = new Set();
  suffix = '';
  pending = null;
}
