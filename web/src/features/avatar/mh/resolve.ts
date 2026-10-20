import { assetUrl, type MhManifest } from '@/lib/assets/manifest';
import type { BodySlider, CharacterConfig } from '@/lib/character/schema';

/** Standing heights (m) of the neutral MetaHuman bodies (pipeline bodies job). */
export const BASE_HEIGHT = { female: 1.66, male: 1.78 } as const;
/** The height slider spans ±14 cm (pipeline bodies job, SLIDERS["height"]). */
export const HEIGHT_RANGE = 0.14;

export interface ResolvedCharacter {
  gender: CharacterConfig['base'];
  faceId: string;
  headUrl: string;
  bodyUrl: string;
  sliders: Partial<Record<BodySlider, number>>;
  /** Approximate standing height (m), for camera framing. */
  height: number;
}

/**
 * Maps a render-independent config onto manifest files. A face the manifest no
 * longer has (curated out, renamed) falls back to the first face of the same
 * gender so a saved character still renders. Returns null when the manifest has
 * no body or face for the gender at all.
 */
export function resolveCharacter(
  config: CharacterConfig,
  manifest: MhManifest,
): ResolvedCharacter | null {
  const gender = config.base;
  const body = manifest.bodies.find((b) => b.gender === gender);
  const face =
    manifest.faces.find((f) => f.id === config.face.preset) ??
    manifest.faces.find((f) => f.gender === gender);
  if (!body || !face) return null;
  const sliders = config.body.sliders;
  return {
    gender,
    faceId: face.id,
    headUrl: assetUrl(face.head),
    bodyUrl: assetUrl(body.glb),
    sliders,
    height: BASE_HEIGHT[gender] + (sliders.height ?? 0) * HEIGHT_RANGE,
  };
}
