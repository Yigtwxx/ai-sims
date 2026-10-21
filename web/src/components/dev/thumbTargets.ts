/**
 * What the thumbnail bench renders and where each image goes. Pure: shared by
 * the bench page and the write endpoint, which trusts nothing but the
 * manifest (the client only ever sends an id).
 */
import type { GroomSlot, MhManifest, OutfitCategory } from '@/lib/assets/manifest';

export const THUMBNAIL_FILE = 'thumbnail.webp';

export type ThumbKind = 'face' | GroomSlot | 'outfit';

export interface ThumbTarget {
  id: string;
  kind: ThumbKind;
  /** Outfits only: what the garment covers, which sets its framing. */
  category?: OutfitCategory;
  /** Manifest-relative path of the image (POSIX separators). */
  file: string;
  /** False when the manifest has no thumbnail entry and the path is derived from the asset's folder. */
  inManifest: boolean;
}

const dirname = (file: string) => file.slice(0, Math.max(0, file.lastIndexOf('/')));

/** Next to the asset: `faces/Ada/head.glb` -> `faces/Ada/thumbnail.webp`. */
const besides = (file: string) => {
  const dir = dirname(file);
  return dir ? `${dir}/${THUMBNAIL_FILE}` : THUMBNAIL_FILE;
};

/**
 * Every face, groom and outfit, in that order and in manifest order within
 * each. An outfit's image goes in the folder of its files
 * (`outfits/OA_Jeans/female.glb` -> `outfits/OA_Jeans/thumbnail.webp`); one
 * without files cannot be rendered and is left out.
 */
export function thumbnailTargets(manifest: MhManifest): ThumbTarget[] {
  const faces = manifest.faces.map((face) => ({
    id: face.id,
    kind: 'face' as const,
    file: face.thumbnail ?? besides(face.head),
    inManifest: face.thumbnail !== undefined,
  }));
  const grooms = manifest.grooms
    .filter((groom) => groom.slot !== 'eyelashes' && groom.slot !== 'peachfuzz')
    .map((groom) => ({
      id: groom.id,
      kind: groom.slot,
      file: groom.thumbnail ?? besides(groom.glb),
      inManifest: groom.thumbnail !== undefined,
    }));
  const outfits = manifest.outfits.flatMap((outfit) => {
    const source = outfit.files.female ?? outfit.files.male;
    if (!source) return [];
    return [
      {
        id: outfit.id,
        kind: 'outfit' as const,
        category: outfit.category,
        file: outfit.thumbnail ?? besides(source),
        inManifest: outfit.thumbnail !== undefined,
      },
    ];
  });
  return [...faces, ...grooms, ...outfits];
}

/**
 * A manifest-relative path the bench may write: plain segments only (no `..`,
 * `.`, empty, absolute or drive-letter parts, no backslashes), ending in
 * `thumbnail.webp`. Anything else is refused before it reaches the disk.
 */
export function isSafeThumbnailPath(file: string): boolean {
  if (file.length > 240 || !/^[A-Za-z0-9_.\-/]+$/.test(file)) return false;
  const segments = file.split('/');
  if (segments.at(-1) !== THUMBNAIL_FILE || segments.length < 2) return false;
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/** RIFF....WEBP header check, so only WebP bytes are ever written. */
export function isWebp(bytes: Uint8Array): boolean {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  return bytes.length > 16 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
}
