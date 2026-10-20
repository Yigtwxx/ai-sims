import { NO_PART, OWN_PART, type CharacterConfig } from '@/lib/character/schema';

import type { BodyShape } from '../avatar/vrm/bodyShape';
import type { PartSelection } from '../avatar/vrm/parts';
import type { Tints } from '../avatar/vrm/tint';
import {
  basesFor,
  findEntry,
  partsFor,
  type Gender,
  type PartCategory,
  type VrmManifest,
} from './manifest';

/**
 * Translates the render-independent config into VrmAvatar props. Tints
 * multiply the authored colours, so the skin ramp starts at white (as
 * authored) and darkens towards deep tones.
 */

export const SKIN_TONES = [
  '#ffffff',
  '#f8dcc8',
  '#e7b896',
  '#c68e66',
  '#97603f',
  '#5f3a27',
] as const;

export function skinToneHex(tone: number): string {
  const index = Math.round(Math.min(1, Math.max(0, tone)) * (SKIN_TONES.length - 1));
  return SKIN_TONES[index];
}

export function skinToneValue(index: number): number {
  return index / (SKIN_TONES.length - 1);
}

export interface AvatarProps {
  baseUrl: string;
  parts: PartSelection;
  bodyShape: BodyShape;
  tints: Tints;
}

function partUrl(manifest: VrmManifest, id: string): string | null | undefined {
  if (id === OWN_PART) return undefined;
  if (id === NO_PART) return null;
  return findEntry(manifest, id)?.url;
}

export function toAvatarProps(
  config: CharacterConfig,
  manifest: VrmManifest,
): AvatarProps | undefined {
  const base = findEntry(manifest, config.face.preset) ?? basesFor(manifest, config.base)[0];
  if (!base) return undefined;
  return {
    baseUrl: base.url,
    parts: {
      hair: partUrl(manifest, config.hair.style),
      top: partUrl(manifest, config.outfit.top.id),
      bottom: partUrl(manifest, config.outfit.bottom.id),
      shoes: partUrl(manifest, config.outfit.shoes.id),
    },
    bodyShape: { build: config.body.build, height: config.body.height },
    tints: {
      skin: skinToneHex(config.skin.tone),
      eyes: config.eyes.color,
      hair: config.hair.color,
      top: config.outfit.top.color,
      bottom: config.outfit.bottom.color,
      shoes: config.outfit.shoes.color,
    },
  };
}

const CATEGORY_IDS: Record<PartCategory, (c: CharacterConfig) => string> = {
  hair: (c) => c.hair.style,
  top: (c) => c.outfit.top.id,
  bottom: (c) => c.outfit.bottom.id,
  shoes: (c) => c.outfit.shoes.id,
};

/**
 * Replace ids the manifest no longer offers (or that don't fit the gender)
 * with the first available option, so a stale saved character still loads.
 */
export function reconcileConfig(config: CharacterConfig, manifest: VrmManifest): CharacterConfig {
  const next = structuredClone(config);
  const gender: Gender = next.base;
  const bases = basesFor(manifest, gender);
  if (!bases.some((b) => b.id === next.face.preset) && bases[0]) next.face.preset = bases[0].id;

  for (const category of Object.keys(CATEGORY_IDS) as PartCategory[]) {
    const id = CATEGORY_IDS[category](next);
    if (id === OWN_PART || id === NO_PART) continue;
    if (partsFor(manifest, category, gender).some((p) => p.id === id)) continue;
    const fallback = partsFor(manifest, category, gender)[0]?.id ?? NO_PART;
    if (category === 'hair') next.hair.style = fallback === NO_PART ? OWN_PART : fallback;
    else next.outfit[category].id = fallback;
  }
  return next;
}
