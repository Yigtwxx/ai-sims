/**
 * Per-point data for the landing particles. Static shapes (dust, sphere,
 * silhouette) are positions; the moving ones (wave, ring, lips) are computed
 * in the vertex shader from the per-point parameters, so a frame costs the CPU
 * nothing but a few uniforms.
 */

/** Floats per point in `params` (see PARAM_LAYOUT). */
export const PARAM_STRIDE = 12;

/**
 * `params` layout, in order: strand (0..8, wave line), cluster (0..14, viseme
 * ring group), wx (-1..1, position along the wave), u (-1..1, across the
 * mouth), v (0..1, through the lip), upper (0|1, upper lip), delay (0..0.35,
 * morph stagger), accent (0|1, cobalt dot), seed (0..1), off xyz (ring jitter).
 */
export const PARAM_LAYOUT = [
  'strand',
  'cluster',
  'wx',
  'u',
  'v',
  'upper',
  'delay',
  'accent',
  'seed',
  'offX',
  'offY',
  'offZ',
] as const;

export const WAVE_STRANDS = 9;
export const RING_CLUSTERS = 15;
/** Share of points drawn in the accent colour. */
const ACCENT_SHARE = 0.07;
/** Radius of each viseme's blob on the ring, in sphere radii. */
const RING_BLOB = 0.12;
/** Half extents of the dust box, in sphere radii (wide enough to fill a 16:9 screen). */
const DUST_HALF = [4.2, 2.6, 1.6] as const;

export interface ParticleData {
  count: number;
  dust: Float32Array;
  sphere: Float32Array;
  silhouette: Float32Array;
  params: Float32Array;
}

/** Park-Miller minimal standard generator: deterministic across runs and browsers. */
export function seededRandom(seed: number): () => number {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

/**
 * Build `count` points. `silhouette` is xyz triples (any length); when it is
 * missing the last shape falls back to the sphere, and a short one is reused
 * cyclically with a little jitter so every point has a place on the body.
 */
export function buildParticles(count: number, silhouette?: Float32Array): ParticleData {
  const rnd = seededRandom(7);
  const dust = new Float32Array(count * 3);
  const sphere = new Float32Array(count * 3);
  const body = new Float32Array(count * 3);
  const params = new Float32Array(count * PARAM_STRIDE);
  const silCount = silhouette ? Math.floor(silhouette.length / 3) : 0;

  for (let i = 0; i < count; i++) {
    // Sphere: Fibonacci lattice, even spacing without poles bunching up.
    const y = count > 1 ? 1 - (i / (count - 1)) * 2 : 0;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = i * 2.399963;
    sphere[i * 3] = Math.cos(theta) * ring;
    sphere[i * 3 + 1] = y;
    sphere[i * 3 + 2] = Math.sin(theta) * ring;

    dust[i * 3] = (rnd() * 2 - 1) * DUST_HALF[0];
    dust[i * 3 + 1] = (rnd() * 2 - 1) * DUST_HALF[1];
    dust[i * 3 + 2] = (rnd() * 2 - 1) * DUST_HALF[2];

    if (silCount > 0 && silhouette) {
      const j = i % silCount;
      const jitter = i >= silCount ? 0.004 : 0;
      body[i * 3] = silhouette[j * 3] + (rnd() - 0.5) * jitter;
      body[i * 3 + 1] = silhouette[j * 3 + 1] + (rnd() - 0.5) * jitter;
      body[i * 3 + 2] = silhouette[j * 3 + 2] + (rnd() - 0.5) * jitter;
    } else {
      body[i * 3] = sphere[i * 3];
      body[i * 3 + 1] = sphere[i * 3 + 1];
      body[i * 3 + 2] = sphere[i * 3 + 2];
    }

    const p = i * PARAM_STRIDE;
    params[p] = i % WAVE_STRANDS;
    params[p + 1] = i % RING_CLUSTERS;
    params[p + 2] = count > 1 ? (i / (count - 1)) * 2 - 1 + (rnd() - 0.5) * 0.01 : 0;
    params[p + 3] = rnd() * 2 - 1;
    params[p + 4] = Math.sqrt(rnd());
    params[p + 5] = i % 2 === 0 ? 1 : 0;
    params[p + 6] = rnd() * 0.35;
    params[p + 7] = rnd() < ACCENT_SHARE ? 1 : 0;
    params[p + 8] = rnd();
    // Ring jitter: a soft round blob around each viseme's place, denser inside.
    const blobAngle = rnd() * Math.PI * 2;
    const blobRadius = RING_BLOB * Math.sqrt(rnd()) * (0.55 + 0.45 * rnd());
    params[p + 9] = Math.cos(blobAngle) * blobRadius;
    params[p + 10] = Math.sin(blobAngle) * blobRadius;
    params[p + 11] = (rnd() - 0.5) * RING_BLOB;
  }

  return { count, dust, sphere, silhouette: body, params };
}
