import { CanvasTexture, NoColorSpace, type Texture } from 'three';

import {
  TATTOO_ART,
  TATTOO_DESIGNS,
  TATTOO_LINE,
  type TattooDesign,
} from '@/features/creator/tattoos';

/**
 * Every tattoo design as ink coverage (red channel) in one texture: a grid of
 * square cells, the designs in TATTOO_DESIGNS order from the top left. Drawn
 * once per page from the same lines the creator shows.
 */
export const ATLAS_COLUMNS = 4;
export const ATLAS_ROWS = 2;
/** Cell size in pixels: a 3 cm design gets about 0.06 mm per texel. */
const CELL = 512;

/** A design's cell in texture space (flipY: v grows upwards), offset and size. */
export interface AtlasCell {
  u: number;
  v: number;
  width: number;
  height: number;
}

export function atlasCell(design: TattooDesign): AtlasCell {
  const i = TATTOO_DESIGNS.indexOf(design);
  const column = i % ATLAS_COLUMNS;
  const row = Math.floor(i / ATLAS_COLUMNS);
  return {
    u: column / ATLAS_COLUMNS,
    v: 1 - (row + 1) / ATLAS_ROWS,
    width: 1 / ATLAS_COLUMNS,
    height: 1 / ATLAS_ROWS,
  };
}

/**
 * Ink spreads a little under the skin as a line heals: each line is drawn
 * with a faint halo around its core.
 */
const SPREAD_BLUR = CELL * 0.012;
const SPREAD_ALPHA = 0.45;

let atlas: Texture | null = null;

/** The shared atlas (browser only); null where there is no 2D canvas. */
export function tattooAtlas(): Texture | null {
  if (atlas) return atlas;
  if (typeof document === 'undefined' || typeof Path2D === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = CELL * ATLAS_COLUMNS;
  canvas.height = CELL * ATLAS_ROWS;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = '#fff';
  context.shadowColor = `rgba(255, 255, 255, ${SPREAD_ALPHA})`;
  context.shadowBlur = SPREAD_BLUR;
  const scale = CELL / 100;
  TATTOO_DESIGNS.forEach((design, i) => {
    const x = (i % ATLAS_COLUMNS) * CELL;
    const y = Math.floor(i / ATLAS_COLUMNS) * CELL;
    context.setTransform(scale, 0, 0, scale, x, y);
    context.lineWidth = TATTOO_LINE;
    for (const d of TATTOO_ART[design]) context.stroke(new Path2D(d));
  });
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = NoColorSpace;
  texture.anisotropy = 4;
  texture.name = 'tattoo_atlas';
  atlas = texture;
  return atlas;
}
