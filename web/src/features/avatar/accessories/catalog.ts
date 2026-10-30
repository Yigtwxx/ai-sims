/**
 * Jewellery and piercings for the MetaHuman characters. Pure data: the pieces
 * are built procedurally (./pieces.ts) and fitted to the character's skin
 * (../mh/jewellery.ts). Labels live in the i18n messages, keyed by id.
 * Piercings stay few and discreet (handoff: tattoos and piercings in moderation).
 */

export const ACCESSORY_SLOTS = [
  'ears',
  'neck',
  'wrist',
  'finger',
  'nose',
  'brow',
  'lip',
  'helix',
  'navel',
] as const;

export type AccessorySlot = (typeof ACCESSORY_SLOTS)[number];

/** What the piece is mostly made of: metal, a cut stone, pearls or velvet. */
export type AccessoryFinish = 'metal' | 'gem' | 'pearl' | 'velvet';

export interface AccessoryDef {
  id: string;
  slot: AccessorySlot;
  finish: AccessoryFinish;
  /** '#rrggbb': the metal, stone, pearl or ribbon colour (also the panel swatch). */
  defaultColor: string;
}

export const GOLD = '#f2c46d';
export const SILVER = '#dfe3e8';
const ROSE_GOLD = '#eeaf98';
const BLACK_METAL = '#2c2c31';
const CRYSTAL = '#f3f6fc';
const SAPPHIRE = '#3466d8';
const ONYX = '#1d1d23';
const PEARL = '#f1ebe1';
const VELVET_BLACK = '#17151a';

function item(id: string, slot: AccessorySlot, finish: AccessoryFinish, defaultColor: string) {
  return { id, slot, finish, defaultColor } satisfies AccessoryDef;
}

export const ACCESSORIES: readonly AccessoryDef[] = [
  item('ear-stud-pearl', 'ears', 'pearl', PEARL),
  item('ear-stud-gem', 'ears', 'gem', SAPPHIRE),
  item('ear-hoop-small', 'ears', 'metal', GOLD),
  item('ear-hoop-large', 'ears', 'metal', GOLD),
  item('ear-drop-crystal', 'ears', 'gem', CRYSTAL),
  item('ear-dangle-star', 'ears', 'metal', GOLD),

  item('neck-chain-fine', 'neck', 'metal', GOLD),
  item('neck-pendant-heart', 'neck', 'metal', ROSE_GOLD),
  item('neck-pendant-moon', 'neck', 'metal', SILVER),
  item('neck-pearls', 'neck', 'pearl', PEARL),
  item('neck-choker-velvet', 'neck', 'velvet', VELVET_BLACK),
  item('neck-choker-chain', 'neck', 'metal', SILVER),

  item('wrist-bangle', 'wrist', 'metal', GOLD),
  item('wrist-chain', 'wrist', 'metal', ROSE_GOLD),
  item('wrist-watch', 'wrist', 'metal', SILVER),
  item('wrist-beads', 'wrist', 'gem', ONYX),

  item('ring-band', 'finger', 'metal', GOLD),
  item('ring-solitaire', 'finger', 'gem', CRYSTAL),
  item('ring-signet', 'finger', 'metal', BLACK_METAL),

  // Body jewellery defaults to polished steel; studs carry a small crystal.
  item('nose-stud', 'nose', 'gem', CRYSTAL),
  item('nose-ring', 'nose', 'metal', SILVER),
  item('nose-septum', 'nose', 'metal', SILVER),
  item('brow-bar', 'brow', 'metal', SILVER),
  item('lip-labret', 'lip', 'gem', CRYSTAL),
  item('helix-ring', 'helix', 'metal', GOLD),
  item('helix-studs', 'helix', 'metal', GOLD),
  item('tragus-stud', 'helix', 'gem', CRYSTAL),
  item('navel-ring', 'navel', 'gem', CRYSTAL),
];

const BY_ID = new Map(ACCESSORIES.map((def) => [def.id, def]));

export function accessoriesFor(slot: AccessorySlot): readonly AccessoryDef[] {
  return ACCESSORIES.filter((def) => def.slot === slot);
}

export function findAccessory(id: string): AccessoryDef | undefined {
  return BY_ID.get(id);
}
