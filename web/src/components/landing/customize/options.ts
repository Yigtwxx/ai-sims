/**
 * Demonstration data for the landing's customization board. Names and colours
 * mirror what the MetaHuman creator offers (see PRODUCT.md); the board is a
 * preview, not the creator itself. Swatch colours are content, not UI tokens.
 */

export const CATEGORIES = ['face', 'skin', 'eyes', 'hair', 'wardrobe', 'jewelry'] as const;
export type Category = (typeof CATEGORIES)[number];

/** Two MetaHuman preset faces used to illustrate blending. Proper names, not translated. */
export const FACE_PRESETS = ['Ada', 'Zuri'] as const;

/**
 * The skin sets the creator offers, fair to deep: name and cheek albedo from the
 * manifest (2026-10-21, after curation). The landing renders without the asset
 * archive, so they are copied here; the swatches show them as lit on stage.
 */
export const SKIN_SETS = [
  { name: 'Jelena', albedo: '#c48877' },
  { name: 'Vivian', albedo: '#c0826f' },
  { name: 'Aera', albedo: '#c58266' },
  { name: 'Celeste', albedo: '#b37766' },
  { name: 'Victor', albedo: '#b37660' },
  { name: 'Kelvin', albedo: '#b57257' },
  { name: 'Aoi', albedo: '#b67156' },
  { name: 'Grace', albedo: '#a66a5b' },
  { name: 'Walter', albedo: '#9c604f' },
  { name: 'Etta', albedo: '#8d5844' },
  { name: 'Tuya', albedo: '#8d5642' },
  { name: 'Trey', albedo: '#85513c' },
  { name: 'Sunita', albedo: '#834e40' },
  { name: 'Asha', albedo: '#6c3a22' },
  { name: 'Mateo', albedo: '#6e3f2a' },
  { name: 'Omari', albedo: '#653827' },
  { name: 'Dominic', albedo: '#673b2d' },
  { name: 'Ada', albedo: '#663b2d' },
  { name: 'Cameron', albedo: '#613525' },
  { name: 'Isaiah', albedo: '#542b1d' },
] as const;

export const IRIS_COLORS = [
  { key: 'darkBrown', hex: '#3b2617' },
  { key: 'brown', hex: '#5b3a22' },
  { key: 'hazel', hex: '#7b6a3b' },
  { key: 'amber', hex: '#a3712d' },
  { key: 'green', hex: '#5e7b4b' },
  { key: 'grey', hex: '#7d8a8f' },
  { key: 'blue', hex: '#5f85a9' },
  { key: 'deepBlue', hex: '#2f4f79' },
] as const;

export const HAIR_COLORS = [
  { key: 'black', hex: '#18130f' },
  { key: 'darkBrown', hex: '#34241a' },
  { key: 'chestnut', hex: '#5b3723' },
  { key: 'auburn', hex: '#7b3927' },
  { key: 'copper', hex: '#a5532d' },
  { key: 'darkBlonde', hex: '#8d6b44' },
  { key: 'blonde', hex: '#caa670' },
  { key: 'platinum', hex: '#e2d7be' },
] as const;

export const HAIR_PATTERNS = ['ombre', 'roots', 'highlights', 'underlayer'] as const;

export const HAIR_STYLES = [
  'dutchBraid',
  'messyBun',
  'highPonytail',
  'slickPonytail',
  'bantuKnots',
  'cornrows',
] as const;

export const WARDROBE_ITEMS = [
  'hoodie',
  'tshirt',
  'sweater',
  'rolledShirt',
  'jeans',
  'cargo',
  'chelsea',
  'sneakers',
  'loafers',
] as const;

export const JEWELRY_ITEMS = [
  'studs',
  'hoops',
  'nose',
  'brow',
  'lip',
  'helix',
  'fineTattoo',
] as const;

/** Fabric colours a garment can take in the creator (demonstration set). */
export const FABRIC_COLORS = [
  '#1d1f22',
  '#3a3f47',
  '#6b5a45',
  '#8a8f86',
  '#c9c2b4',
  '#5b2f2a',
] as const;

/**
 * Material light for the CSS previews (lit skin sphere, iris, hair swatch, a
 * gold bead). These describe physical materials under the stage light, not
 * interface colours.
 */
export const PREVIEW_LIGHT = {
  key: '#fff4e6',
  shadow: '#0b0b0a',
  subsurface: '#5a1f14',
  subsurfaceRim: 'rgb(120 36 22 / 0.28)',
  pupil: '#080707',
  fibre: 'rgb(255 255 255 / 0.07)',
  collarette: '#c88a3c',
  limbus: 'rgb(16 13 10)',
  strandShade: 'rgb(0 0 0 / 0.12)',
  bleach: '#e9d3a8',
  underlayerDye: '#8f3b2a',
  sheen: 'rgb(255 236 210 / 0.16)',
  gold: 'radial-gradient(circle at 36% 30%, #fff6dc 0 6%, #f2cf7c 14%, #b7862f 42%, #5e3f12 78%, #24180a 100%)',
} as const;
