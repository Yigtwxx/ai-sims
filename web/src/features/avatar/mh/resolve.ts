import { assetUrl, type MhIris, type MhManifest, type MhSkin } from '@/lib/assets/manifest';
import type { BodySlider, CharacterConfig } from '@/lib/character/schema';

import type { MocapLayer } from './motion';

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
  /** Skin set to wear: the configured one, else the face's own, else none (GLB materials). */
  skin: MhSkin | null;
  makeup: boolean;
  /** Eyes: the configured iris, else the face's default, else the iris named like the face. */
  iris: MhIris | null;
  /** Body idle clips and how much of the body they drive (see idleSet). */
  idleClips: string[];
  idleLayer: MocapLayer;
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
    skin:
      manifest.skins.find((s) => s.id === config.skin.set) ??
      manifest.skins.find((s) => s.id === face.defaultSkin) ??
      null,
    makeup: config.skin.makeup,
    iris:
      manifest.irises.find((i) => i.id === config.eyes.iris) ??
      manifest.irises.find((i) => i.id === face.defaultIris) ??
      manifest.irises.find((i) => i.id === face.id) ??
      null,
    ...idleSet(manifest),
    height: BASE_HEIGHT[gender] + (sliders.height ?? 0) * HEIGHT_RANGE,
  };
}

/** Fewer calm clips than this would loop visibly; the body layer of standing ones is used then. */
export const MIN_CALM_IDLES = 3;

/**
 * Idle clips (manifest body animations tagged "idle"), with the retarget
 * script's tags: "calm" clips may drive the whole body; "standing" ones only
 * the pelvis, spine and legs (their hands hold phones, cross, touch the face).
 */
export function idleSet(manifest: MhManifest): Pick<ResolvedCharacter, 'idleClips' | 'idleLayer'> {
  const idles = manifest.animations.filter((a) => a.kind === 'body' && a.tags.includes('idle'));
  const calm = idles.filter((a) => a.tags.includes('calm'));
  if (calm.length >= MIN_CALM_IDLES) {
    return { idleClips: calm.map((a) => assetUrl(a.file)), idleLayer: 'full' };
  }
  return {
    idleClips: idles.filter((a) => a.tags.includes('standing')).map((a) => assetUrl(a.file)),
    idleLayer: 'body',
  };
}
