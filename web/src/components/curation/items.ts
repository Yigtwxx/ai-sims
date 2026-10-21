/**
 * Turns the manifest into the flat item lists the curation screen shows, and
 * groups near-duplicates (same label stem, e.g. "Long Straight 02" and
 * "Long Straight 03") so they can be culled together. Pure functions.
 */
import { reconcileConfig, skinGender } from '@/features/creator/reconcile';
import {
  labelFor,
  type AutoPick,
  type MhManifest,
  type OutfitCategory,
} from '@/lib/assets/manifest';
import { createDefaultConfig } from '@/lib/character/defaults';
import type { CharacterBase, CharacterConfig } from '@/lib/character/schema';

export const CURATION_TABS = [
  'faces',
  'skins',
  'hair',
  'eyebrows',
  'beards',
  'mustaches',
  'outfits',
  'animations',
] as const;
export type CurationTab = (typeof CURATION_TABS)[number];

export interface CurationItem {
  id: string;
  label: string;
  thumbnail?: string;
  swatch?: string;
  /** Short facts shown under the label (gender, compat, tags). */
  meta: string[];
  /** Outfit category, for the outfit sub-filter. */
  category?: OutfitCategory;
  /** Colourways an outfit carries as tint presets. */
  tints?: number;
  /** Skin tone, 0 (lightest) .. 100 (darkest). */
  tone?: number;
  /** Drawn when there is no thumbnail or swatch. */
  glyph: ItemGlyph;
}

export type ItemGlyph = 'face' | 'groom' | 'outfit' | 'bodyMotion' | 'faceMotion';

const GROOM_TAB_SLOT = {
  hair: 'hair',
  eyebrows: 'eyebrows',
  beards: 'beard',
  mustaches: 'mustache',
} as const;

export function itemsFor(manifest: MhManifest, tab: CurationTab, locale: string): CurationItem[] {
  switch (tab) {
    case 'faces':
      return manifest.faces.map((face) => ({
        id: face.id,
        label: labelFor(face.label, locale),
        thumbnail: face.thumbnail,
        meta: [face.gender],
        glyph: 'face',
      }));
    case 'skins':
      return [...manifest.skins]
        .sort((a, b) => a.tone - b.tone)
        .map((skin) => ({
          id: skin.id,
          label: labelFor(skin.label, locale),
          swatch: skin.swatch,
          meta: [skinGender(manifest, skin)],
          tone: Math.round(skin.tone * 100),
          glyph: 'face',
        }));
    case 'hair':
    case 'eyebrows':
    case 'beards':
    case 'mustaches':
      return manifest.grooms
        .filter((groom) => groom.slot === GROOM_TAB_SLOT[tab])
        .map((groom) => ({
          id: groom.id,
          label: labelFor(groom.label, locale),
          thumbnail: groom.thumbnail,
          meta: [groom.compat],
          glyph: 'groom',
        }));
    case 'outfits':
      return manifest.outfits.map((outfit) => ({
        id: outfit.id,
        label: labelFor(outfit.label, locale),
        thumbnail: outfit.thumbnail,
        meta: [outfit.compat],
        glyph: 'outfit',
        category: outfit.category,
        tints: outfit.tintPresets.length,
      }));
    case 'animations':
      return manifest.animations.map((animation) => ({
        id: animation.id,
        label: animationLabel(animation.id),
        meta: [animation.kind, ...animation.tags.slice(0, 2)],
        glyph: animation.kind === 'face' ? 'faceMotion' : 'bodyMotion',
      }));
  }
}

/**
 * Animations carry no label: their id without the `anim.` prefix, the Fab pack
 * folder and the body/face suffix (the card's meta shows the kind), spaced out.
 */
export function animationLabel(id: string): string {
  const name = id
    .replace(/^anim\./, '')
    .replace(/^fab\.[^.]+\./, '')
    .replace(/\.(body|face)$/, '')
    .replace(/[._-]+/g, ' ')
    .trim();
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * The visibility filter of the sheet. `auto` shows every pick of the
 * similarity pre-pass, the restored ones included, so a restore can be undone
 * in place.
 */
export type VisibilityFilter = 'all' | 'visible' | 'hidden' | 'auto';

export function matchesVisibility(
  id: string,
  filter: VisibilityFilter,
  hidden: ReadonlySet<string>,
  auto: Readonly<Record<string, AutoPick>>,
): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'visible':
      return !hidden.has(id);
    case 'hidden':
      return hidden.has(id);
    case 'auto':
      return Object.hasOwn(auto, id);
  }
}

export interface AutoSummary {
  /** Pre-pass picks per tab (items in the manifest only). */
  perTab: Record<CurationTab, number>;
  /** Picks per tab that are still hidden in the draft. */
  hiddenPerTab: Record<CurationTab, number>;
  total: number;
  /** Picks that are still hidden in the draft. */
  hidden: number;
}

/** Counts the pre-pass picks the manifest still has, per tab and in all. */
export function summarizeAuto(
  byTab: Readonly<Record<CurationTab, readonly CurationItem[]>>,
  auto: Readonly<Record<string, AutoPick>>,
  hidden: ReadonlySet<string>,
): AutoSummary {
  const zero = () =>
    Object.fromEntries(CURATION_TABS.map((tab) => [tab, 0])) as Record<CurationTab, number>;
  const perTab = zero();
  const hiddenPerTab = zero();
  let total = 0;
  let stillHidden = 0;
  for (const tab of CURATION_TABS) {
    for (const item of byTab[tab]) {
      if (!Object.hasOwn(auto, item.id)) continue;
      perTab[tab] += 1;
      total += 1;
      if (!hidden.has(item.id)) continue;
      hiddenPerTab[tab] += 1;
      stillHidden += 1;
    }
  }
  return { perTab, hiddenPerTab, total, hidden: stillHidden };
}

/**
 * The label of the item a pre-pass pick was hidden in favour of: from the
 * manifest in the active locale, or the pipeline's English `keepLabel` when the
 * kept item is not in the manifest.
 */
export function keptLabel(manifest: MhManifest, pick: AutoPick, locale: string): string {
  const labelled: readonly { id: string; label: Parameters<typeof labelFor>[0] }[][] = [
    manifest.faces,
    manifest.skins,
    manifest.grooms,
    manifest.outfits,
    manifest.irises,
    manifest.lighting,
  ];
  for (const list of labelled) {
    const entry = list.find((candidate) => candidate.id === pick.keep);
    if (entry) return labelFor(entry.label, locale);
  }
  if (manifest.animations.some((animation) => animation.id === pick.keep)) {
    return animationLabel(pick.keep);
  }
  return pick.keepLabel;
}

/**
 * The part of a label that variants share: lower case, without trailing
 * numbers, variant words or colour suffixes in brackets.
 */
export function labelStem(label: string): string {
  return label
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\b(variant|var|version|v)\s*\d*\b/g, ' ')
    .replace(/\b\d+[a-z]?\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface CurationGroup {
  stem: string;
  items: CurationItem[];
}

/**
 * The family a label belongs to: its stem cut to the first two words, so
 * "Medium Bob Curly" and "Medium Bob Slick 02" land together.
 */
export function familyKey(label: string): string {
  return labelStem(label).split(' ').slice(0, 2).join(' ');
}

/** Groups items by label family; singletons stay as one-item groups, in first-seen order. */
export function groupNearDuplicates(items: readonly CurationItem[]): CurationGroup[] {
  const groups = new Map<string, CurationItem[]>();
  for (const item of items) {
    const stem = familyKey(item.label) || item.id.toLowerCase();
    const list = groups.get(stem);
    if (list) list.push(item);
    else groups.set(stem, [item]);
  }
  return [...groups].map(([stem, members]) => ({ stem, items: members }));
}

const baseFor = (compat: 'female' | 'male' | 'unisex'): CharacterBase =>
  compat === 'male' ? 'male' : 'female';

/**
 * A character wearing just this item, for the preview stage. Animations have no
 * config representation, so they return null (no preview).
 */
export function previewConfig(
  manifest: MhManifest,
  tab: CurationTab,
  id: string,
): CharacterConfig | null {
  let config: CharacterConfig;
  switch (tab) {
    case 'faces': {
      const face = manifest.faces.find((entry) => entry.id === id);
      if (!face) return null;
      config = createDefaultConfig(face.gender);
      config.face.preset = face.id;
      config.skin.set = face.defaultSkin;
      break;
    }
    case 'skins': {
      const skin = manifest.skins.find((entry) => entry.id === id);
      if (!skin) return null;
      // On its own body: the creator only offers a skin to its gender.
      config = createDefaultConfig(skinGender(manifest, skin));
      config.skin.set = id;
      break;
    }
    case 'hair':
    case 'eyebrows':
    case 'beards':
    case 'mustaches': {
      const groom = manifest.grooms.find((entry) => entry.id === id);
      if (!groom) return null;
      config = createDefaultConfig(baseFor(groom.compat));
      const slot = GROOM_TAB_SLOT[tab];
      if (slot === 'hair') config.hair.style = id;
      else if (slot === 'eyebrows') config.eyebrows.style = id;
      else if (slot === 'beard') config.beard.style = id;
      else config.mustache.style = id;
      break;
    }
    case 'outfits': {
      const outfit = manifest.outfits.find((entry) => entry.id === id);
      if (!outfit) return null;
      config = createDefaultConfig(baseFor(outfit.compat));
      config.outfit[outfit.category] = {
        id,
        tint: outfit.tintPresets[0]?.id ?? null,
        colors: {},
      };
      break;
    }
    case 'animations':
      return null;
  }
  return reconcileConfig(config, manifest);
}

/** Case- and accent-insensitive match on label, id and meta. */
export function matchesQuery(item: CurationItem, query: string): boolean {
  const normalize = (value: string) =>
    value
      .toLocaleLowerCase('tr-TR')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      // Dotless ı has no decomposition; fold it like the other Turkish letters.
      .replace(/ı/g, 'i');
  const needle = normalize(query.trim());
  if (!needle) return true;
  return [item.label, item.id, ...item.meta].some((value) => normalize(value).includes(needle));
}
