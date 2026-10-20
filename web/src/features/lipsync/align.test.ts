import { describe, expect, it } from 'vitest';

import { alignTextToAudio, mergeRegionsTo, splitPhrases } from './align';
import { computeEnvelope, detectSpeechRegions, sampleEnvelope } from './envelope';

/** Synthetic clip: loud tone where `speech` is true, silence elsewhere. */
function makeClip(pattern: [seconds: number, speech: boolean][], sampleRate = 8000) {
  const total = pattern.reduce((s, [d]) => s + d, 0);
  const samples = new Float32Array(Math.round(total * sampleRate));
  let i = 0;
  for (const [seconds, speech] of pattern) {
    const n = Math.round(seconds * sampleRate);
    for (let k = 0; k < n; k++, i++) samples[i] = speech ? Math.sin(k * 0.3) * 0.5 : 0;
  }
  return { samples, sampleRate, total };
}

describe('envelope', () => {
  it('normalizes loudness to a 0..1 range', () => {
    const { samples, sampleRate } = makeClip([
      [0.2, false],
      [0.3, true],
    ]);
    const env = computeEnvelope(samples, sampleRate);
    expect(Math.max(...env.values)).toBeCloseTo(1);
    expect(sampleEnvelope(env, 0.1)).toBe(0);
    expect(sampleEnvelope(env, 0.35)).toBeGreaterThan(0.5);
  });

  it('detects speech regions separated by pauses', () => {
    const { samples, sampleRate } = makeClip([
      [0.1, false],
      [0.5, true],
      [0.4, false],
      [0.6, true],
      [0.2, false],
    ]);
    const regions = detectSpeechRegions(computeEnvelope(samples, sampleRate));
    expect(regions).toHaveLength(2);
    expect(regions[0].start).toBeCloseTo(0.1, 1);
    expect(regions[1].end).toBeCloseTo(1.6, 1);
  });

  it('bridges very short gaps such as stop consonants', () => {
    const { samples, sampleRate } = makeClip([
      [0.3, true],
      [0.05, false],
      [0.3, true],
    ]);
    expect(detectSpeechRegions(computeEnvelope(samples, sampleRate))).toHaveLength(1);
  });
});

describe('splitPhrases', () => {
  it('splits at audible punctuation', () => {
    expect(splitPhrases('Merhaba! Nasılsın, iyi misin?')).toEqual([
      'Merhaba!',
      'Nasılsın,',
      'iyi misin?',
    ]);
  });
});

describe('mergeRegionsTo', () => {
  it('merges the regions with the shortest gap first', () => {
    const merged = mergeRegionsTo(
      [
        { start: 0, end: 1 },
        { start: 1.1, end: 2 },
        { start: 3, end: 4 },
      ],
      2,
    );
    expect(merged).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 4 },
    ]);
  });
});

describe('alignTextToAudio', () => {
  it('fits each phrase into its own speech region', () => {
    const regions = [
      { start: 0.2, end: 1.0 },
      { start: 1.5, end: 2.6 },
    ];
    const timeline = alignTextToAudio('Merhaba! Nasılsın?', regions, 3);
    const secondPhraseStart = timeline.find((s) => s.start >= 1.4)!;
    expect(timeline[0].start).toBeCloseTo(0.2);
    expect(secondPhraseStart.start).toBeCloseTo(1.5);
    expect(timeline.at(-1)!.end).toBeCloseTo(2.6);
  });

  it('falls back to one block when the TTS ran phrases together', () => {
    const timeline = alignTextToAudio('Merhaba! Nasılsın?', [{ start: 0.1, end: 2 }], 2.5);
    expect(timeline[0].start).toBeCloseTo(0.1);
    expect(timeline.at(-1)!.end).toBeCloseTo(2);
  });
});
