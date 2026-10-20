/**
 * Procedural eye texture for the realism close-up: sclera, limbal ring and a
 * fibrous iris with crypts and a collarette, painted in planar UV space (the
 * eyeball's UVs are a front projection, so the iris is a circle centred at
 * 0.5, 0.5). Returns a colour map and a matching bump (height) map.
 *
 * Pure apart from canvas creation; the colour maths lives in `eyeTexel` so it
 * can be unit tested.
 */

/** Iris radius in UV units (front-projected chord radius 0.52 on a unit sphere). */
export const IRIS_RADIUS_UV = 0.26;
/** Pupil radius painted into the texture, as a fraction of the iris radius. */
export const PUPIL_RATIO_IN_TEXTURE = 0.3;

type Rgb = [number, number, number];

function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Smooth value noise in [0, 1]. */
export function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [
  mix(a[0], b[0], t),
  mix(a[1], b[1], t),
  mix(a[2], b[2], t),
];
const smoothstep = (e0: number, e1: number, x: number) => smooth(clamp01((x - e0) / (e1 - e0)));

const SCLERA: Rgb = [226, 216, 205];
const SCLERA_EDGE: Rgb = [176, 132, 122];
const LIMBUS: Rgb = [38, 33, 28];
const PUPIL: Rgb = [7, 6, 6];
const COLLARETTE: Rgb = [134, 88, 46];
const IRIS_MID: Rgb = [104, 98, 62];
const IRIS_OUTER: Rgb = [70, 76, 64];

export interface Texel {
  color: Rgb;
  /** Relief in [0, 1] for the bump map. */
  height: number;
}

/** Colour and relief of the eye surface at a UV coordinate. */
export function eyeTexel(u: number, v: number): Texel {
  const cx = u - 0.5;
  const cy = v - 0.5;
  const r = Math.hypot(cx, cy);
  const theta = Math.atan2(cy, cx);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const limbusOuter = IRIS_RADIUS_UV * 1.07;

  if (r >= limbusOuter) {
    // Sclera: warm off-white that pinks toward the edges, with faint vessels.
    const edge = smoothstep(0.3, 0.5, r);
    let color = mixRgb(SCLERA, SCLERA_EDGE, edge * 0.75);
    const wander = valueNoise(cos * 9 + r * 14, sin * 9 + r * 14);
    const vessel = Math.abs(Math.sin(theta * 23 + wander * 6));
    const vesselMask = smoothstep(0.32, 0.46, r) * (1 - smoothstep(0, 0.035, vessel));
    color = mixRgb(color, [176, 74, 70], vesselMask * 0.55);
    const blend = smoothstep(limbusOuter, limbusOuter + 0.03, r);
    return { color: mixRgb(LIMBUS, color, 0.35 + 0.65 * blend), height: 0.5 };
  }

  const t = r / IRIS_RADIUS_UV;
  if (t < PUPIL_RATIO_IN_TEXTURE) {
    const edge = smoothstep(PUPIL_RATIO_IN_TEXTURE - 0.03, PUPIL_RATIO_IN_TEXTURE, t);
    return { color: mixRgb(PUPIL, COLLARETTE.map((c) => c * 0.35) as Rgb, edge), height: 0.2 };
  }

  // Iris: radial fibres (high angular frequency, slow radial drift), crypts,
  // a zig-zag collarette and a dark limbal ring.
  const warp = 0.012 * Math.sin(t * 9 + theta * 5);
  const wc = Math.cos(theta + warp);
  const ws = Math.sin(theta + warp);
  const fibres =
    0.55 * valueNoise(wc * 64 + t * 0.6, ws * 64 + t * 0.6) +
    0.45 * valueNoise(wc * 128 + t * 1.4, ws * 128 + t * 1.4);
  const crypt = smoothstep(0.62, 0.8, valueNoise(cos * 7 + t * 5, sin * 7 + t * 5));
  const collarettePos = 0.46 + 0.025 * Math.sin(theta * 26) + 0.015 * Math.sin(theta * 61);
  const collarette = 1 - smoothstep(0, 0.06, Math.abs(t - collarettePos));

  let color =
    t < collarettePos
      ? mixRgb(COLLARETTE.map((c) => c * 0.8) as Rgb, COLLARETTE, smoothstep(0.3, collarettePos, t))
      : mixRgb(IRIS_MID, IRIS_OUTER, smoothstep(collarettePos, 0.95, t));
  color = mixRgb(color, COLLARETTE, collarette * 0.3);
  const brightness = 0.5 + 0.95 * fibres * fibres + 0.15 * fibres;
  color = color.map((c) => c * brightness) as Rgb;
  color = color.map((c) => c * (1 - crypt * 0.3 * smoothstep(0.5, 0.7, t))) as Rgb;
  const limbal = smoothstep(0.86, 1.02, t);
  color = mixRgb(color, LIMBUS, limbal * 0.85);

  const height = clamp01(0.35 + 0.5 * fibres - 0.3 * crypt + 0.25 * collarette);
  return { color, height };
}

export interface EyeTextures {
  color: HTMLCanvasElement;
  bump: HTMLCanvasElement;
}

/** Paints the colour and bump maps into two square canvases. */
export function createEyeTextures(size = 1024): EyeTextures {
  const color = document.createElement('canvas');
  const bump = document.createElement('canvas');
  color.width = color.height = bump.width = bump.height = size;
  const colorCtx = color.getContext('2d');
  const bumpCtx = bump.getContext('2d');
  if (!colorCtx || !bumpCtx) return { color, bump };

  const colorData = colorCtx.createImageData(size, size);
  const bumpData = bumpCtx.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    // Canvas rows run top-down; UV v runs bottom-up.
    const v = 1 - (y + 0.5) / size;
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / size;
      const { color: rgb, height } = eyeTexel(u, v);
      const i = (y * size + x) * 4;
      colorData.data[i] = rgb[0];
      colorData.data[i + 1] = rgb[1];
      colorData.data[i + 2] = rgb[2];
      colorData.data[i + 3] = 255;
      const h = Math.round(height * 255);
      bumpData.data[i] = h;
      bumpData.data[i + 1] = h;
      bumpData.data[i + 2] = h;
      bumpData.data[i + 3] = 255;
    }
  }
  colorCtx.putImageData(colorData, 0, 0);
  bumpCtx.putImageData(bumpData, 0, 0);
  return { color, bump };
}
