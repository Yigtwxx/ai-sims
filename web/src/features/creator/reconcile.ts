/**
 * Keeps a CharacterConfig consistent with the loaded MetaHuman manifest: ids
 * the manifest does not offer (curated out, other gender, not exported yet)
 * fall back to the first available option, values are clamped to the
 * manifest's ranges. Pure functions, shared by the creator store and tests.
 */
import { ACCESSORIES, findAccessory } from '@/features/avatar/accessories/catalog';
import type {
  GroomSlot,
  MhBody,
  MhFace,
  MhGroom,
  MhManifest,
  MhOutfit,
  MhSkin,
  OutfitCategory,
} from '@/lib/assets/manifest';
import { createDefaultConfig } from '@/lib/character/defaults';
import {
  BODY_SLIDERS,
  type BodyPreset,
  type BodySlider,
  type CharacterBase,
  type CharacterConfig,
  type OutfitItem,
} from '@/lib/character/schema';

import { isTattooDesign, isTattooPlacement, MAX_TATTOOS } from './tattoos';

/** Most face presets a character can blend towards at once. */
export const MAX_FACE_BLENDS = 3;
export const MAX_ACCESSORIES = 8;

type FacialGroomSlot = Extract<GroomSlot, 'hair' | 'eyebrows' | 'beard' | 'mustache'>;
export type OutfitSlot = keyof CharacterConfig['outfit'];

const compatible = (compat: 'female' | 'male' | 'unisex', base: CharacterBase) =>
  compat === 'unisex' || compat === base;

/** Faces for the base gender, in manifest order (all faces if none match). */
export function facesFor(manifest: MhManifest, base: CharacterBase): MhFace[] {
  const matching = manifest.faces.filter((face) => face.gender === base);
  return matching.length > 0 ? matching : manifest.faces;
}

/** Skins sorted from lightest to darkest. */
export function skinsByTone(manifest: MhManifest): MhSkin[] {
  return [...manifest.skins].sort((a, b) => a.tone - b.tone);
}

export function groomsFor(manifest: MhManifest, slot: GroomSlot, base: CharacterBase): MhGroom[] {
  return manifest.grooms.filter((groom) => groom.slot === slot && compatible(groom.compat, base));
}

/** Outfits of a category that ship a mesh for this body. */
export function outfitsFor(
  manifest: MhManifest,
  category: OutfitCategory,
  base: CharacterBase,
): MhOutfit[] {
  return manifest.outfits.filter(
    (outfit) =>
      outfit.category === category &&
      compatible(outfit.compat, base) &&
      Boolean(outfit.files[base]),
  );
}

export function bodyFor(manifest: MhManifest, base: CharacterBase): MhBody | undefined {
  return manifest.bodies.find((body) => body.gender === base) ?? manifest.bodies[0];
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Slider values for a named body preset; sliders the preset omits sit at their default. */
export function presetSliders(
  manifest: MhManifest,
  base: CharacterBase,
  preset: BodyPreset,
): Partial<Record<BodySlider, number>> {
  const body = bodyFor(manifest, base);
  const vector = body?.presets[preset] ?? {};
  const sliders: Partial<Record<BodySlider, number>> = {};
  for (const id of BODY_SLIDERS) {
    const def = body?.sliders.find((slider) => slider.id === id);
    if (!def) continue;
    const value = vector[id] ?? def.default;
    sliders[id] = Number(clamp(value, Math.max(-1, def.min), Math.min(1, def.max)).toFixed(3));
  }
  return sliders;
}

function reconcileGroom(
  style: string | null,
  manifest: MhManifest,
  slot: FacialGroomSlot,
  base: CharacterBase,
): string | null {
  if (style === null) return null;
  const options = groomsFor(manifest, slot, base);
  return options.some((groom) => groom.id === style) ? style : (options[0]?.id ?? null);
}

function reconcileOutfit(
  item: OutfitItem | null,
  manifest: MhManifest,
  category: OutfitCategory,
  base: CharacterBase,
): OutfitItem | null {
  if (item === null) return null;
  const options = outfitsFor(manifest, category, base);
  const outfit = options.find((option) => option.id === item.id) ?? options[0];
  if (!outfit) return null;
  const same = outfit.id === item.id;
  const tint =
    same && item.tint && outfit.tintPresets.some((preset) => preset.id === item.tint)
      ? item.tint
      : null;
  const colorParams = new Set(
    outfit.params.filter((param) => param.type === 'color').map((param) => param.name),
  );
  const colors = same
    ? Object.fromEntries(Object.entries(item.colors).filter(([name]) => colorParams.has(name)))
    : {};
  return { id: outfit.id, tint, colors };
}

/** Accessory ids the catalogue knows, one per slot, at most eight. */
export function reconcileAccessories(ids: readonly string[]): string[] {
  const taken = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const def = findAccessory(id);
    if (!def || taken.has(def.slot) || out.length >= MAX_ACCESSORIES) continue;
    taken.add(def.slot);
    out.push(id);
  }
  return out;
}

/** Returns a copy of `config` that only references what `manifest` offers. */
export function reconcileConfig(config: CharacterConfig, manifest: MhManifest): CharacterConfig {
  const next = structuredClone(config);
  const { base } = next;

  const faces = facesFor(manifest, base);
  const face = faces.find((candidate) => candidate.id === next.face.preset) ?? faces[0];
  if (face) next.face.preset = face.id;
  const faceIds = new Set(faces.map((candidate) => candidate.id));
  next.face.blend = Object.fromEntries(
    Object.entries(next.face.blend)
      .filter(([id, weight]) => faceIds.has(id) && id !== next.face.preset && weight > 0)
      .slice(0, MAX_FACE_BLENDS)
      .map(([id, weight]) => [id, clamp(weight, 0, 1)]),
  );

  const skinIds = new Set(manifest.skins.map((skin) => skin.id));
  if (!skinIds.has(next.skin.set)) {
    next.skin.set =
      face && skinIds.has(face.defaultSkin)
        ? face.defaultSkin
        : (skinsByTone(manifest)[0]?.id ?? next.skin.set);
  }
  const skin = manifest.skins.find((candidate) => candidate.id === next.skin.set);
  if (next.skin.makeup && !skin?.makeupAlbedo) next.skin.makeup = false;
  next.skin.tone = clamp(next.skin.tone, -1, 1);

  if (next.eyes.iris !== null && !manifest.irises.some((iris) => iris.id === next.eyes.iris)) {
    next.eyes.iris = null;
  }

  next.hair.style = reconcileGroom(next.hair.style, manifest, 'hair', base);
  next.eyebrows.style = reconcileGroom(next.eyebrows.style, manifest, 'eyebrows', base);
  next.beard.style = reconcileGroom(next.beard.style, manifest, 'beard', base);
  next.mustache.style = reconcileGroom(next.mustache.style, manifest, 'mustache', base);

  const body = bodyFor(manifest, base);
  if (body) {
    const sliders: Partial<Record<BodySlider, number>> = {};
    for (const id of BODY_SLIDERS) {
      const def = body.sliders.find((slider) => slider.id === id);
      const value = next.body.sliders[id];
      if (!def || value === undefined) continue;
      sliders[id] = clamp(value, Math.max(-1, def.min), Math.min(1, def.max));
    }
    next.body.sliders = sliders;
  }

  next.outfit = {
    top: reconcileOutfit(next.outfit.top, manifest, 'top', base),
    bottom: reconcileOutfit(next.outfit.bottom, manifest, 'bottom', base),
    shoes: reconcileOutfit(next.outfit.shoes, manifest, 'shoes', base),
    full: reconcileOutfit(next.outfit.full, manifest, 'full', base),
  };
  // A one-piece outfit replaces top and bottom.
  if (next.outfit.full) {
    next.outfit.top = null;
    next.outfit.bottom = null;
  }

  next.accessories = reconcileAccessories(next.accessories);

  const placements = new Set<string>();
  next.tattoos = next.tattoos
    .filter((tattoo) => {
      if (!isTattooDesign(tattoo.design) || !isTattooPlacement(tattoo.placement)) return false;
      if (placements.has(tattoo.placement)) return false;
      placements.add(tattoo.placement);
      return true;
    })
    .slice(0, MAX_TATTOOS);

  return next;
}

/** Every accessory id in catalogue order (for randomize and the creator grid). */
export const ACCESSORY_IDS = ACCESSORIES.map((def) => def.id);

/**
 * A new character for this base: the defaults reconciled with the manifest,
 * wearing natural eyebrows (a bare brow ridge reads as uncanny, not as a choice).
 */
export function startingConfig(base: CharacterBase, manifest: MhManifest): CharacterConfig {
  const config = reconcileConfig(createDefaultConfig(base), manifest);
  if (config.eyebrows.style === null) {
    const brows = groomsFor(manifest, 'eyebrows', base);
    const natural = brows.find((groom) => /natural/i.test(groom.id)) ?? brows[0];
    config.eyebrows.style = natural?.id ?? null;
  }
  return config;
}
