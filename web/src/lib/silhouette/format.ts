/**
 * The landing silhouette point file (`public/assets/landing/silhouette.bin`),
 * written by the dev bench at /dev/silhouette and read by the landing page.
 *
 * Little-endian: the ASCII magic `SIL1`, a uint32 point count N, then N
 * points as three int16 each (x, y, z), every coordinate round(v * 32767)
 * for v in [-1, 1]. Coordinates: x to the viewer's right, y up (feet at -1,
 * top of the head at 1), +z toward the viewer; the figure faces +z.
 *
 * Pure: shared by the browser (bench, landing) and the dev route handler.
 */

export const SILHOUETTE_MAGIC = 'SIL1';
const HEADER_BYTES = 8;
const POINT_BYTES = 6;
const SCALE = 32767;

/** Size (bytes) of a file holding `count` points. */
export function silhouetteBytes(count: number): number {
  return HEADER_BYTES + count * POINT_BYTES;
}

/**
 * Packs points (x, y, z per point) into the file format. Coordinates outside
 * [-1, 1] are clamped and non-finite ones written as 0.
 */
export function encodeSilhouette(points: Float32Array): ArrayBuffer {
  if (points.length % 3 !== 0) {
    throw new RangeError(`Expected x, y, z per point, got ${points.length} values`);
  }
  const count = points.length / 3;
  const buffer = new ArrayBuffer(silhouetteBytes(count));
  const view = new DataView(buffer);
  for (let i = 0; i < SILHOUETTE_MAGIC.length; i += 1) {
    view.setUint8(i, SILHOUETTE_MAGIC.charCodeAt(i));
  }
  view.setUint32(4, count, true);
  for (let i = 0; i < points.length; i += 1) {
    const value = points[i]!;
    const clamped = Number.isFinite(value) ? Math.min(1, Math.max(-1, value)) : 0;
    view.setInt16(HEADER_BYTES + i * 2, Math.round(clamped * SCALE), true);
  }
  return buffer;
}

/**
 * The points of a silhouette file (x, y, z per point, in [-1, 1]), or
 * undefined when it is not one: wrong magic, a size that does not match its
 * point count, or no points at all.
 */
export function decodeSilhouette(buffer: ArrayBuffer): Float32Array | undefined {
  if (buffer.byteLength < HEADER_BYTES) return undefined;
  const view = new DataView(buffer);
  for (let i = 0; i < SILHOUETTE_MAGIC.length; i += 1) {
    if (view.getUint8(i) !== SILHOUETTE_MAGIC.charCodeAt(i)) return undefined;
  }
  const count = view.getUint32(4, true);
  if (count === 0 || buffer.byteLength !== silhouetteBytes(count)) return undefined;
  const points = new Float32Array(count * 3);
  for (let i = 0; i < points.length; i += 1) {
    points[i] = view.getInt16(HEADER_BYTES + i * 2, true) / SCALE;
  }
  return points;
}
