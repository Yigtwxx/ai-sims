/**
 * Classifies VRoid materials into creator part categories. VRoid Studio names
 * materials consistently (e.g. "N00_007_01_Tops_01_CLOTH (Instance)"), so the
 * category of every primitive can be read from its material name.
 */

export const PART_CATEGORIES = ['hair', 'top', 'bottom', 'shoes'] as const;

export type PartCategory = (typeof PART_CATEGORIES)[number];

export type MaterialRole = PartCategory | 'face' | 'body' | 'accessory' | 'other';

const RULES: ReadonlyArray<[RegExp, MaterialRole]> = [
  [/_HAIR(_\d+)?\b|HairBack/i, 'hair'],
  // One-piece garments (dresses) are worn in the top slot.
  [/_(Tops|Onepiece)_/i, 'top'],
  [/_Bottoms_/i, 'bottom'],
  [/_Shoes_/i, 'shoes'],
  [/_Accessory_/i, 'accessory'],
  [/_(FACE|EYE)\b|_Face_\d+_SKIN/i, 'face'],
  [/_Body_\d+_SKIN/i, 'body'],
];

export function classifyMaterial(name: string): MaterialRole {
  for (const [pattern, role] of RULES) if (pattern.test(name)) return role;
  return 'other';
}

/** One-piece garments also occupy the bottom slot. */
export function isOnepiece(name: string): boolean {
  return /_Onepiece_/i.test(name);
}

export function isPartCategory(role: MaterialRole): role is PartCategory {
  return (PART_CATEGORIES as readonly string[]).includes(role);
}
