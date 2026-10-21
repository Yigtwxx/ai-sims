import { describe, expect, it } from 'vitest';

import {
  alignTextToAudio,
  estimateAudioLag,
  mergeRegionsTo,
  shiftTimeline,
  snapClosuresToAudio,
  splitPhrases,
} from './align';
import { computeEnvelope, detectSpeechRegions, sampleEnvelope, type Envelope } from './envelope';
import type { TimedViseme } from './timeline';

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

  it('places each frame at its middle, not its start', () => {
    const env: Envelope = { values: new Float32Array([0.2, 1, 0.5]), rate: 100 };
    expect(sampleEnvelope(env, 0.015)).toBeCloseTo(1, 6);
    expect(sampleEnvelope(env, 0.01)).toBeCloseTo(0.6, 6);
    expect(sampleEnvelope(env, 0.02)).toBeCloseTo(0.75, 6);
    // Before the first middle and after the last one: the edge frames hold.
    expect(sampleEnvelope(env, 0)).toBeCloseTo(0.2, 6);
    expect(sampleEnvelope(env, 0.029)).toBeCloseTo(0.5, 6);
    expect(sampleEnvelope(env, 0.03)).toBe(0);
    expect(sampleEnvelope(env, -0.001)).toBe(0);
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

/** Envelope at 100 frames/s from a loudness function of time (each frame read at its middle). */
function envelopeOf(duration: number, loudness: (t: number) => number): Envelope {
  const values = new Float32Array(Math.round(duration * 100));
  for (let f = 0; f < values.length; f++) values[f] = loudness((f + 0.5) / 100);
  return { values, rate: 100 };
}

const segment = (viseme: TimedViseme['viseme'], start: number, end: number): TimedViseme => ({
  viseme,
  start,
  end,
});

describe('estimateAudioLag', () => {
  // Vowels and closures alternating, with pauses: aa PP E sil O PP aa ...
  const timeline: TimedViseme[] = [];
  for (let k = 0; k < 6; k++) {
    const t = 0.1 + k * 0.5;
    timeline.push(
      segment('aa', t, t + 0.15),
      segment('PP', t + 0.15, t + 0.21),
      segment('E', t + 0.21, t + 0.35),
      segment('sil', t + 0.35, t + 0.5),
    );
  }
  const loudAt = (t: number) => {
    const s = timeline.find((x) => t >= x.start && t < x.end);
    return s && s.viseme !== 'sil' && s.viseme !== 'PP' ? 1 : 0.02;
  };

  it('finds how far the audio runs behind the timeline', () => {
    const late = envelopeOf(3.5, (t) => loudAt(t - 0.06));
    expect(estimateAudioLag(timeline, late)).toBeCloseTo(0.06, 2);
  });

  it('keeps an aligned timeline where it is', () => {
    expect(estimateAudioLag(timeline, envelopeOf(3.5, loudAt))).toBe(0);
    expect(
      estimateAudioLag(
        [],
        envelopeOf(1, () => 1),
      ),
    ).toBe(0);
  });

  it('does not read the silence past the end of the audio as a fit', () => {
    // Steady audio up to the end, and a closure held to the end: nothing to shift.
    const held = [segment('aa', 0, 0.5), segment('PP', 0.5, 2)];
    expect(
      estimateAudioLag(
        held,
        envelopeOf(2, () => 1),
      ),
    ).toBe(0);
  });

  it('shifts every segment by the lag', () => {
    expect(shiftTimeline([segment('aa', 0.1, 0.2)], 0.05)[0]).toMatchObject({
      start: expect.closeTo(0.15, 5),
      end: expect.closeTo(0.25, 5),
    });
  });
});

describe('snapClosuresToAudio', () => {
  const word = [segment('aa', 0, 0.2), segment('PP', 0.2, 0.26), segment('E', 0.26, 0.5)];

  it('moves a closure onto the dip in the audio and keeps its neighbours joined', () => {
    const dipAt030 = envelopeOf(0.6, (t) => (Math.abs(t - 0.3) < 0.015 ? 0.02 : 0.9));
    const [before, closure, after] = snapClosuresToAudio(word, dipAt030);
    expect((closure.start + closure.end) / 2).toBeCloseTo(0.3, 2);
    expect(closure.end - closure.start).toBeCloseTo(0.06, 5);
    expect(before.end).toBe(closure.start);
    expect(after.start).toBe(closure.end);
    expect(word[1].start).toBe(0.2);
  });

  it('leaves a closure without a clear dip, or next to a pause, alone', () => {
    const flat = envelopeOf(0.6, () => 0.8);
    expect(snapClosuresToAudio(word, flat)).toEqual(word);
    const afterPause = [segment('sil', 0, 0.2), word[1], word[2]];
    const dip = envelopeOf(0.6, (t) => (Math.abs(t - 0.3) < 0.015 ? 0.02 : 0.9));
    expect(snapClosuresToAudio(afterPause, dip)).toEqual(afterPause);
  });
});
