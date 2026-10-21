/**
 * Neutral characters for thumbnails: one item on an otherwise bare figure, so
 * every image in a grid reads the same way.
 */
import type { CameraFocus } from '@/features/avatar/cameraFocus';
import { reconcileConfig, startingConfig } from '@/features/creator/reconcile';
import type { MhFace, MhManifest, MhOutfit, OutfitCategory } from '@/lib/assets/manifest';
import { createDefaultConfig } from '@/lib/character/defaults';
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
 * The base an outfit is shown on: female for female and unisex, male for male
 * (as in the curation preview), or the other base when the outfit has no file
 * for that one yet.
 */
export function outfitBase(outfit: MhOutfit): CharacterBase | null {
  const preferred: CharacterBase = outfit.compat === 'male' ? 'male' : 'female';
  const other: CharacterBase = preferred === 'male' ? 'female' : 'male';
  if (outfit.files[preferred]) return preferred;
  return outfit.files[other] ? other : null;
}

function outfitConfig(manifest: MhManifest, outfit: MhOutfit): CharacterConfig | null {
  const base = outfitBase(outfit);
  if (!base) return null;
  // The base's default face, as a new character of that base starts with.
  const preset = reconcileConfig(createDefaultConfig(base), manifest).face.preset;
  const face = manifest.faces.find((entry) => entry.id === preset);
  if (!face) return null;
  const config = wearing(manifest, face);
  config.outfit = { top: null, bottom: null, shoes: null, full: null };
  config.outfit[outfit.category] = {
    id: outfit.id,
    tint: outfit.tintPresets[0]?.id ?? null,
    colors: {},
  };
  const reconciled = reconcileConfig(config, manifest);
  // Reconcile swaps an unwearable outfit for another one: never render that.
  return reconciled.outfit[outfit.category]?.id === outfit.id ? reconciled : null;
}

/**
 * Faces: the face with its default skin and iris and a natural brow, no hair.
 * Grooms: worn on a model face of a compatible gender (facial hair on a male
 * face unless it is female-only). Outfits: worn alone, first colourway, on the
 * default face of their base, no hair. Null when the manifest has no such face.
 */
export function thumbConfig(manifest: MhManifest, target: ThumbTarget): CharacterConfig | null {
  if (target.kind === 'face') {
    const face = manifest.faces.find((entry) => entry.id === target.id);
    return face ? reconcileConfig(wearing(manifest, face), manifest) : null;
  }
  if (target.kind === 'outfit') {
    const outfit = manifest.outfits.find((entry) => entry.id === target.id);
    return outfit ? outfitConfig(manifest, outfit) : null;
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

const OUTFIT_FOCUS: Record<OutfitCategory, CameraFocus> = {
  top: 'torso',
  bottom: 'legs',
  shoes: 'feet',
  full: 'body',
};

/**
 * Framing per kind: faces and hair head and shoulders, brows and facial hair
 * a close-up of their part of the face, outfits the part of the body they cover.
 */
export function thumbFocus(target: ThumbTarget): CameraFocus {
  switch (target.kind) {
    case 'eyebrows':
      return 'brows';
    case 'beard':
    case 'mustache':
      return 'mouth';
    case 'outfit':
      return OUTFIT_FOCUS[target.category ?? 'full'];
    default:
      return 'face';
  }
}
