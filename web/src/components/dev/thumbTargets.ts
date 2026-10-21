/**
 * What the thumbnail bench renders and where each image goes. Pure: shared by
 * the bench page and the write endpoint, which trusts nothing but the
 * manifest (the client only ever sends an id).
 */
import type { GroomSlot, MhManifest } from '@/lib/assets/manifest';

export const THUMBNAIL_FILE = 'thumbnail.webp';

export type ThumbKind = 'face' | GroomSlot;

export interface ThumbTarget {
  id: string;
  kind: ThumbKind;
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

/** Every face and every groom, faces first, in manifest order. */
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
  return [...faces, ...grooms];
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
