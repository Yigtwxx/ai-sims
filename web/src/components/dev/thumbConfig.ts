/**
 * Neutral characters for thumbnails: one item on an otherwise bare figure, so
 * every image in a grid reads the same way.
 */
import { reconcileConfig, startingConfig } from '@/features/creator/reconcile';
import type { MhFace, MhManifest } from '@/lib/assets/manifest';
import type { CharacterBase, CharacterConfig } from '@/lib/character/schema';

import type { ThumbTarget } from './thumbTargets';

/** The face a groom is shown on: the manifest's first face of that gender. */
export function modelFace(manifest: MhManifest, base: CharacterBase): MhFace | undefined {
  return manifest.faces.find((face) => face.gender === base);
}

const suffix = (id: string) => id.slice(id.indexOf('.') + 1);

/**
 * The face's own iris; for a face exported without one, the iris of the
 * preset its skin comes from, then any iris. Never none: a missing iris
 * renders as a white eye.
 */
export function irisFor(manifest: MhManifest, face: MhFace): string | null {
  if (face.defaultIris) return face.defaultIris;
  const fromSkin = manifest.irises.find((iris) => suffix(iris.id) === suffix(face.defaultSkin));
  return fromSkin?.id ?? manifest.irises[0]?.id ?? null;
}

function wearing(manifest: MhManifest, face: MhFace): CharacterConfig {
  const config = startingConfig(face.gender, manifest);
  config.face = { preset: face.id, blend: {} };
  config.skin = { ...config.skin, set: face.defaultSkin, tone: 0, makeup: false };
  config.eyes = { iris: irisFor(manifest, face), color: null };
  config.hair.style = null;
  config.beard.style = null;
  config.mustache.style = null;
  return config;
}

/**
 * Faces: the face with its default skin and iris and a natural brow, no hair.
 * Grooms: worn on a model face of a compatible gender (facial hair on a male
 * face unless it is female-only). Null when the manifest has no such face.
 */
export function thumbConfig(manifest: MhManifest, target: ThumbTarget): CharacterConfig | null {
  if (target.kind === 'face') {
    const face = manifest.faces.find((entry) => entry.id === target.id);
    return face ? reconcileConfig(wearing(manifest, face), manifest) : null;
  }

  const groom = manifest.grooms.find((entry) => entry.id === target.id);
  if (!groom) return null;
  const facial = groom.slot === 'beard' || groom.slot === 'mustache';
  const base: CharacterBase =
    groom.compat === 'female' ? 'female' : groom.compat === 'male' || facial ? 'male' : 'female';
  const face = modelFace(manifest, base);
  if (!face) return null;

  const config = wearing(manifest, face);
  if (groom.slot === 'hair') config.hair.style = groom.id;
  else if (groom.slot === 'eyebrows') config.eyebrows.style = groom.id;
  else if (groom.slot === 'beard') config.beard.style = groom.id;
  else if (groom.slot === 'mustache') config.mustache.style = groom.id;
  return reconcileConfig(config, manifest);
}
