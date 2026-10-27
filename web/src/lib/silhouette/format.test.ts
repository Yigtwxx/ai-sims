import { describe, expect, it } from 'vitest';

import { decodeSilhouette, encodeSilhouette, SILHOUETTE_MAGIC, silhouetteBytes } from './format';

const POINTS = new Float32Array([
  0, 0, 0, 1, -1, 0.5, -0.123456, 0.987654, -0.000015, 0.33, -0.66, 1,
]);

describe('encodeSilhouette', () => {
  it('writes the magic, the point count and six bytes per point', () => {
    const buffer = encodeSilhouette(POINTS);
    expect(buffer.byteLength).toBe(silhouetteBytes(4));
    expect(String.fromCharCode(...new Uint8Array(buffer, 0, 4))).toBe(SILHOUETTE_MAGIC);
    expect(new DataView(buffer).getUint32(4, true)).toBe(4);
  });

  it('stores coordinates as little-endian int16 of v * 32767', () => {
    const view = new DataView(encodeSilhouette(new Float32Array([1, -1, 0.5])));
    expect(view.getInt16(8, true)).toBe(32767);
    expect(view.getInt16(10, true)).toBe(-32767);
    expect(view.getInt16(12, true)).toBe(16384);
  });

  it('clamps out-of-range and non-finite coordinates', () => {
    const decoded = decodeSilhouette(
      encodeSilhouette(new Float32Array([2, -3, Number.NaN, Number.POSITIVE_INFINITY, 0, 0])),
    );
    expect(Array.from(decoded ?? [])).toEqual([1, -1, 0, 0, 0, 0]);
  });

  it('rejects a buffer that is not whole points', () => {
    expect(() => encodeSilhouette(new Float32Array(4))).toThrow(RangeError);
  });
});

describe('decodeSilhouette', () => {
  it('round-trips within half a quantisation step', () => {
    const decoded = decodeSilhouette(encodeSilhouette(POINTS));
    expect(decoded).toBeInstanceOf(Float32Array);
    expect(decoded).toHaveLength(POINTS.length);
    POINTS.forEach((value, i) => {
      expect(Math.abs(decoded![i]! - value)).toBeLessThanOrEqual(0.5 / 32767 + 1e-7);
    });
  });

  it('rejects a wrong magic', () => {
    const buffer = encodeSilhouette(POINTS);
    new Uint8Array(buffer)[3] = '2'.charCodeAt(0);
    expect(decodeSilhouette(buffer)).toBeUndefined();
  });

  it('rejects a truncated or padded buffer', () => {
    const buffer = encodeSilhouette(POINTS);
    expect(decodeSilhouette(buffer.slice(0, buffer.byteLength - 1))).toBeUndefined();
    expect(decodeSilhouette(buffer.slice(0, 6))).toBeUndefined();
    const padded = new Uint8Array(buffer.byteLength + 6);
    padded.set(new Uint8Array(buffer));
    expect(decodeSilhouette(padded.buffer)).toBeUndefined();
  });

  it('rejects a file without points', () => {
    expect(decodeSilhouette(encodeSilhouette(new Float32Array(0)))).toBeUndefined();
  });
});
