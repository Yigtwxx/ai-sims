import type { TattooFocus } from '@/features/avatar/cameraFocus';

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

/** The creator's framing of each placement while it is picked. */
export const TATTOO_FOCUS: Record<TattooPlacement, TattooFocus> = {
  innerWrist: 'tattooWrist',
  forearm: 'tattooForearm',
  collarbone: 'tattooCollarbone',
  behindEar: 'tattooEar',
  ankle: 'tattooAnkle',
  shoulderBlade: 'tattooBack',
  nape: 'tattooNape',
};

/** The placement a tattoo framing shows. */
export function placementOfFocus(focus: TattooFocus): TattooPlacement {
  return TATTOO_PLACEMENTS.find((placement) => TATTOO_FOCUS[placement] === focus)!;
}

/**
 * The designs as fine-line drawings: SVG path data in a 100 x 100 box, stroked
 * (never filled), y down with the top of the drawing up on the body. The
 * creator draws them as icons and the stage paints the same lines as ink.
 */
export const TATTOO_ART: Record<TattooDesign, readonly string[]> = {
  wave: [
    'M16 68 C24 67 30 58 34 49 C40 37 50 31 60 32 C72 33 79 42 77 52 C75 60 66 63 61 58 C57 54 59 47 65 47',
    'M26 63 C32 52 40 44 52 41',
    'M10 76 C18 72 26 79 35 75 C44 71 51 79 60 75 C69 71 76 79 85 75 C88 73.5 90 72.5 92 72',
  ],
  star: [
    'M50 17 L58.2 38.7 L81.4 39.8 L63.3 54.3 L69.4 76.7 L50 64 L30.6 76.7 L36.7 54.3 L18.6 39.8 L41.8 38.7 Z',
    'M83 12 L83 24 M77 18 L89 18',
  ],
  moon: [
    'M62 20.4 A32 32 0 1 0 62 79.6 A30 30 0 0 1 62 20.4 Z',
    'M77 41 L77 55 M70 48 L84 48',
    'M70 64 L70 70 M67 67 L73 67',
  ],
  leaf: [
    'M50 80 C30 66 28 36 50 14 C72 36 70 66 50 80 Z',
    'M50 80 C49 85 47 89 44 92',
    'M50 80 C51 60 51 38 50 22',
    'M50.6 66 C46 63 42 60 39 56 M50.6 66 C55 63 59 60 62 56',
    'M51 53 C47 50 43 46 40 41 M51 53 C55 50 59 46 61 41',
    'M50.8 40 C48 37 45 34 43 30 M50.8 40 C53 37 56 34 58 30',
  ],
  bird: [
    'M12 44 C18 37 26 35 33 41 C38 33 47 29 56 31',
    'M46 61 C50 56 55 55 59 59 C62 54 68 52 74 53',
    'M70 76 C72.5 73 75.5 72.5 78 75 C80 72 83 71 87 71.5',
  ],
  heart: [
    'M50 80 C40 72 15 57 15 38 C15 27 23 19 33 19 C41 19 47 24 50 31 C53 24 59 19 67 19 C77 19 85 27 85 38 C85 57 60 72 50 80 Z',
  ],
  feather: [
    'M26 90 C40 68 58 38 74 12',
    'M39.4 68.2 C48 66.5 55 63 59 58.5 C64 53 67.5 46 68.5 40 C70 32 72.5 22 74 12 C68 16.5 60 21.5 54 26.5 C48 31.5 41.5 38.5 38.5 45.5 C36 52 36.5 61 39.4 68.2 Z',
    'M52.4 47.1 L61.5 46.3 M50 51 L46.8 43 M60.6 33.8 L57.4 25.8 M63.4 29.2 L68.8 28.7',
  ],
  compass: [
    'M78 50 A28 28 0 1 1 22 50 A28 28 0 1 1 78 50 Z',
    'M50 10 L54.5 45.5 L88 50 L54.5 54.5 L50 90 L45.5 54.5 L12 50 L45.5 45.5 Z',
    'M69.8 30.2 L72.6 27.4 M30.2 30.2 L27.4 27.4 M69.8 69.8 L72.6 72.6 M30.2 69.8 L27.4 72.6',
  ],
};

/** Line width of the drawings in their 100-unit box (about 0.6 mm on a 3 cm tattoo). */
export const TATTOO_LINE = 2;

/** Most tattoos a character can wear (CharacterConfig allows 4). */
export const MAX_TATTOOS = 4;

export const isTattooDesign = (id: string): id is TattooDesign =>
  (TATTOO_DESIGNS as readonly string[]).includes(id);

export const isTattooPlacement = (id: string): id is TattooPlacement =>
  (TATTOO_PLACEMENTS as readonly string[]).includes(id);
