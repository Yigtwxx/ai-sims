/**
 * Jewellery and accessory catalogue for the anime creator. Pure data: the
 * meshes are built procedurally by the accessory rig (see rig.ts) and fitted
 * to whichever base character is selected. Labels live in the i18n messages,
 * keyed by id.
 */

export const ACCESSORY_SLOTS = [
  'ears',
  'neck',
  'face',
  'hair',
  'wrist',
  'nose',
  'brow',
  'lip',
  'helix',
  'navel',
] as const;

export type AccessorySlot = (typeof ACCESSORY_SLOTS)[number];

/** Which palette recolours an item: its metal, fabric, stone or lens tint. */
export type AccessoryColorRole = 'metal' | 'fabric' | 'gem' | 'lens';

export interface AccessoryDef {
  id: string;
  slot: AccessorySlot;
  colorRole: AccessoryColorRole;
  /** '#rrggbb' from the role's palette. */
  defaultColor: string;
}

/** Selected item and optional colour override ('#rrggbb'). */
export interface AccessorySelection {
  id: string;
  color?: string;
}

const GOLD = '#f2c46d';
const SILVER = '#dfe3e8';
const ROSE_GOLD = '#eeaf98';
const BLACK_METAL = '#2c2c31';

const CRYSTAL = '#f3f6fc';
const SAPPHIRE = '#3466d8';
const ONYX = '#1d1d23';

const VELVET_BLACK = '#17151a';
const CRIMSON = '#a8182f';
const BLUSH = '#e8a8b6';

const SMOKE = '#2b3138';

/** Swatches per colour role; the first entry is the role's default. */
export const ACCESSORY_PALETTES: Record<AccessoryColorRole, readonly string[]> = {
  metal: [GOLD, SILVER, ROSE_GOLD, BLACK_METAL],
  fabric: [VELVET_BLACK, CRIMSON, '#5a1832', '#1e2b4e', '#efe6d8', BLUSH, '#1c5a46', '#7a5ca8'],
  gem: [CRYSTAL, SAPPHIRE, '#cf1f40', '#14a06b', '#8a50d6', '#f0a6bb', '#f0c255', ONYX],
  lens: [SMOKE, '#6b4426', '#2f4b3c', '#24395c', '#ad5a78', '#c6952f'],
};

function item(
  id: string,
  slot: AccessorySlot,
  colorRole: AccessoryColorRole,
  defaultColor: string = ACCESSORY_PALETTES[colorRole][0],
): AccessoryDef {
  return { id, slot, colorRole, defaultColor };
}

export const ACCESSORIES: readonly AccessoryDef[] = [
  item('ear-stud-pearl', 'ears', 'gem'),
  item('ear-stud-gem', 'ears', 'gem', SAPPHIRE),
  item('ear-hoop-small', 'ears', 'metal'),
  item('ear-hoop-large', 'ears', 'metal'),
  item('ear-drop-crystal', 'ears', 'gem'),
  item('ear-dangle-star', 'ears', 'metal'),

  item('neck-chain-fine', 'neck', 'metal'),
  item('neck-pendant-heart', 'neck', 'metal'),
  item('neck-pendant-moon', 'neck', 'metal'),
  item('neck-pearls', 'neck', 'gem'),
  item('neck-choker-velvet', 'neck', 'fabric'),
  item('neck-choker-chain', 'neck', 'metal'),

  item('face-glasses-round', 'face', 'metal'),
  item('face-glasses-square', 'face', 'metal', BLACK_METAL),
  item('face-glasses-halfrim', 'face', 'metal', SILVER),
  item('face-sunglasses', 'face', 'lens'),

  item('hair-pins-cross', 'hair', 'metal'),
  item('hair-clip-star', 'hair', 'metal'),
  item('hair-bow-ribbon', 'hair', 'fabric', CRIMSON),
  item('hair-flower', 'hair', 'fabric', BLUSH),

  item('wrist-bangle', 'wrist', 'metal'),
  item('wrist-chain', 'wrist', 'metal'),
  item('wrist-watch', 'wrist', 'metal', SILVER),
  item('wrist-beads', 'wrist', 'gem', ONYX),

  // Body jewellery defaults to polished steel; studs carry a small crystal.
  item('nose-stud', 'nose', 'metal', SILVER),
  item('nose-ring', 'nose', 'metal', SILVER),
  item('nose-septum', 'nose', 'metal', SILVER),

  item('brow-bar', 'brow', 'metal', SILVER),
  item('brow-ring', 'brow', 'metal', SILVER),

  item('lip-labret', 'lip', 'metal', SILVER),
  item('lip-ring', 'lip', 'metal', SILVER),
  item('lip-monroe', 'lip', 'metal', SILVER),

  item('helix-ring', 'helix', 'metal'),
  item('helix-studs', 'helix', 'metal'),
  item('industrial-bar', 'helix', 'metal', SILVER),
  item('tragus-stud', 'helix', 'metal'),

  item('navel-ring', 'navel', 'metal', SILVER),
];

const BY_ID = new Map(ACCESSORIES.map((def) => [def.id, def]));

export function accessoriesFor(slot: AccessorySlot): readonly AccessoryDef[] {
  return ACCESSORIES.filter((def) => def.slot === slot);
}

export function findAccessory(id: string): AccessoryDef | undefined {
  return BY_ID.get(id);
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Colour an item renders with: a valid override, else the item's default. */
export function resolveAccessoryColor(def: AccessoryDef, color?: string): string {
  return color && HEX.test(color) ? color.toLowerCase() : def.defaultColor;
}

/**
 * Known items in selection order, at most one per slot (the first wins), with
 * their resolved colours. Unknown ids are dropped.
 */
export function resolveSelections(
  selections: readonly AccessorySelection[],
): { def: AccessoryDef; color: string }[] {
  const taken = new Set<AccessorySlot>();
  const out: { def: AccessoryDef; color: string }[] = [];
  for (const selection of selections) {
    const def = findAccessory(selection.id);
    if (!def || taken.has(def.slot)) continue;
    taken.add(def.slot);
    out.push({ def, color: resolveAccessoryColor(def, selection.color) });
  }
  return out;
}
