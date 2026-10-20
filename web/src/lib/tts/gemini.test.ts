// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { wrapPcmAsWav } from './gemini';

describe('wrapPcmAsWav', () => {
  it('writes a 44-byte RIFF header for mono 16-bit PCM at 24 kHz', () => {
    const pcm = new Uint8Array([1, 2, 3, 4]);
    const wav = wrapPcmAsWav(pcm);
    const view = new DataView(wav.buffer);
    const ascii = (offset: number) => String.fromCharCode(...wav.subarray(offset, offset + 4));
    expect(wav.byteLength).toBe(48);
    expect(ascii(0)).toBe('RIFF');
    expect(ascii(8)).toBe('WAVE');
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(4);
    expect([...wav.subarray(44)]).toEqual([1, 2, 3, 4]);
  });
});
