/**
 * Small tattoo designs and where they can sit. The user asked for subtle,
 * minimal tattoos only (no large body pieces). Labels live in the messages
 * (`Creator.tattoos.designs.<id>` / `Creator.tattoos.placements.<id>`).
 */
export const TATTOO_DESIGNS = [
  'wave',
  'star',
  'moon',
  'leaf',
  'bird',
  'heart',
  'feather',
  'compass',
] as const;

export const TATTOO_PLACEMENTS = [
  'innerWrist',
  'forearm',
  'collarbone',
  'behindEar',
  'ankle',
  'shoulderBlade',
  'nape',
] as const;

export type TattooDesign = (typeof TATTOO_DESIGNS)[number];
export type TattooPlacement = (typeof TATTOO_PLACEMENTS)[number];

/** Most tattoos a character can wear (CharacterConfig allows 4). */
export const MAX_TATTOOS = 4;

export const isTattooDesign = (id: string): id is TattooDesign =>
  (TATTOO_DESIGNS as readonly string[]).includes(id);

export const isTattooPlacement = (id: string): id is TattooPlacement =>
  (TATTOO_PLACEMENTS as readonly string[]).includes(id);
