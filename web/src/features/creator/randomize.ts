/**
 * "Rastgele": a plausible new look that stays inside the manifest. The base
 * gender and the name are kept; everything else is drawn from what the
 * manifest offers for that base, so the result never needs reconciling.
 */
import type { MhManifest } from '@/lib/assets/manifest';
import type { CharacterConfig, OutfitItem } from '@/lib/character/schema';

import {
  ACCESSORY_IDS,
  facesFor,
  groomsFor,
  outfitsFor,
  presetsFor,
  presetSliders,
  reconcileAccessories,
  type OutfitSlot,
} from './reconcile';
import { HAIR_DYES, HAIR_PATTERN_COLORS } from './palettes';
import { TATTOO_DESIGNS, TATTOO_PLACEMENTS } from './tattoos';

export type Random = () => number;

const pick = <T>(items: readonly T[], random: Random): T | undefined =>
  items.length === 0 ? undefined : items[Math.floor(random() * items.length) % items.length];

const chance = (probability: number, random: Random) => random() < probability;

function randomOutfit(
  manifest: MhManifest,
  slot: OutfitSlot,
  base: CharacterConfig['base'],
  random: Random,
): OutfitItem | null {
  const outfit = pick(outfitsFor(manifest, slot, base), random);
  if (!outfit) return null;
  const tint = pick(outfit.tintPresets, random);
  return { id: outfit.id, tint: tint?.id ?? null, colors: {} };
}

export function randomConfig(
  current: CharacterConfig,
  manifest: MhManifest,
  random: Random = Math.random,
): CharacterConfig {
  const base = current.base;
  const next = structuredClone(current);

  const faces = facesFor(manifest, base);
  const face = pick(faces, random);
  if (face) {
    next.face.preset = face.id;
    next.face.blend = {};
    const other = pick(
      faces.filter((candidate) => candidate.id !== face.id),
      random,
    );
    if (other && chance(0.6, random)) {
      next.face.blend[other.id] = Number((0.15 + random() * 0.35).toFixed(2));
    }
  }

  const preset = pick(presetsFor(manifest, base), random) ?? 'average';
  next.body = { preset, sliders: presetSliders(manifest, base, preset) };
  const height = next.body.sliders.height;
  if (height !== undefined) {
    next.body.sliders.height = Number(Math.max(-1, Math.min(1, (random() - 0.5) * 1.2)).toFixed(2));
  }

  const skin = pick(manifest.skins, random);
  if (skin) {
    next.skin = {
      set: skin.id,
      tone: Number(((random() - 0.5) * 0.4).toFixed(2)),
      makeup: Boolean(skin.makeupAlbedo) && chance(0.5, random),
    };
  }

  next.eyes = { iris: pick(manifest.irises, random)?.id ?? null, color: null };

  const hair = groomsFor(manifest, 'hair', base);
  next.hair = {
    style: chance(0.06, random) ? null : (pick(hair, random)?.id ?? null),
    color: {
      melanin: Number((0.15 + random() * 0.85).toFixed(2)),
      redness: Number((random() * 0.55).toFixed(2)),
      dye: chance(0.15, random) ? (pick(HAIR_DYES, random)?.value ?? null) : null,
    },
    pattern: chance(0.2, random)
      ? {
          type: pick(['ombre', 'roots', 'highlights', 'underlayer'] as const, random) ?? 'ombre',
          color: pick(HAIR_PATTERN_COLORS, random)?.value ?? current.hair.pattern.color,
          amount: Number((0.3 + random() * 0.5).toFixed(2)),
        }
      : { ...current.hair.pattern, type: 'none' },
  };

  next.eyebrows.style = pick(groomsFor(manifest, 'eyebrows', base), random)?.id ?? null;
  next.beard.style = chance(0.55, random)
    ? (pick(groomsFor(manifest, 'beard', base), random)?.id ?? null)
    : null;
  next.mustache.style =
    next.beard.style === null && chance(0.3, random)
      ? (pick(groomsFor(manifest, 'mustache', base), random)?.id ?? null)
      : null;

  const full = chance(0.15, random) ? randomOutfit(manifest, 'full', base, random) : null;
  next.outfit = {
    full,
    top: full ? null : randomOutfit(manifest, 'top', base, random),
    bottom: full ? null : randomOutfit(manifest, 'bottom', base, random),
    shoes: randomOutfit(manifest, 'shoes', base, random),
  };

  const accessoryCount = Math.floor(random() * 3);
  const accessories: string[] = [];
  for (let i = 0; i < accessoryCount; i += 1) {
    const id = pick(ACCESSORY_IDS, random);
    if (id) accessories.push(id);
  }
  next.accessories = reconcileAccessories(accessories);

  next.tattoos = chance(0.3, random)
    ? [
        {
          design: pick(TATTOO_DESIGNS, random) ?? 'star',
          placement: pick(TATTOO_PLACEMENTS, random) ?? 'innerWrist',
        },
      ]
    : [];

  return next;
}
