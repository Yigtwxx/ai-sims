import { describe, expect, it } from 'vitest';

import {
  analyseSpeech,
  buildTimeline,
  envelope,
  indexAt,
  letterViseme,
  splitSentences,
  syllableCount,
  waveformPeaks,
  wordVisemes,
} from './timeline';

const SAMPLE = 'Merhaba! Ben senin dijital asistanınım. Bugün sana nasıl yardımcı olabilirim?';

describe('syllableCount', () => {
  it('counts one syllable per Turkish vowel', () => {
    expect(syllableCount('Merhaba!')).toBe(3);
    expect(syllableCount('asistanınım.')).toBe(5);
    expect(syllableCount('Bugün')).toBe(2);
  });

  it('never returns zero', () => {
    expect(syllableCount('Hmm')).toBe(1);
  });
});

describe('letterViseme', () => {
  it('maps Turkish letters to Oculus visemes', () => {
    expect(letterViseme('m')).toBe('PP');
    expect(letterViseme('ş')).toBe('CH');
    expect(letterViseme('ı')).toBe('I');
    expect(letterViseme('Ö')).toBe('O');
    expect(letterViseme('?')).toBe('sil');
  });
});

describe('splitSentences', () => {
  it('keeps punctuation with each sentence', () => {
    expect(splitSentences(SAMPLE)).toEqual([
      'Merhaba!',
      'Ben senin dijital asistanınım.',
      'Bugün sana nasıl yardımcı olabilirim?',
    ]);
  });
});

describe('wordVisemes', () => {
  it('covers the word span and merges repeated visemes', () => {
    const visemes = wordVisemes('Bebek', 1, 2);
    expect(visemes[0]).toMatchObject({ id: 'PP', start: 1 });
    expect(visemes.at(-1)?.end).toBeCloseTo(2);
    for (let i = 1; i < visemes.length; i += 1) {
      expect(visemes[i].id).not.toBe(visemes[i - 1].id);
    }
  });
});

describe('buildTimeline', () => {
  it('snaps sentence breaks to the longest pauses', () => {
    const words = buildTimeline(SAMPLE, { start: 0.2, end: 6 }, [
      { start: 0.95, end: 1.4 },
      { start: 3.0, end: 3.08 },
      { start: 3.3, end: 3.75 },
    ]);
    expect(words).toHaveLength(10);
    expect(words[0].start).toBeCloseTo(0.2);
    expect(words[0].end).toBeLessThanOrEqual(0.95);
    expect(words[1].start).toBeCloseTo(1.4);
    expect(words[4].end).toBeLessThanOrEqual(3.3 + 1e-9);
    expect(words[5].start).toBeCloseTo(3.75);
    expect(words.at(-1)?.end).toBeCloseTo(6);
  });

  it('falls back to syllable shares without enough pauses', () => {
    const words = buildTimeline(SAMPLE, { start: 0, end: 5 });
    expect(words[0].start).toBe(0);
    expect(words.at(-1)?.end).toBeCloseTo(5);
    for (let i = 1; i < words.length; i += 1) {
      expect(words[i].start).toBeGreaterThanOrEqual(words[i - 1].end - 1e-9);
    }
  });

  it('returns nothing for an empty transcript', () => {
    expect(buildTimeline('  ', { start: 0, end: 1 })).toEqual([]);
  });
});

describe('analyseSpeech', () => {
  it('finds speech bounds and inner pauses from an envelope', () => {
    // 0.2 s silence, 0.5 s voice, 0.3 s pause, 0.4 s voice, 0.2 s silence (20 ms frames).
    const frames = [
      ...Array(10).fill(0),
      ...Array(25).fill(0.3),
      ...Array(15).fill(0.001),
      ...Array(20).fill(0.25),
      ...Array(10).fill(0),
    ];
    const { speech, pauses, duration } = analyseSpeech(frames);
    expect(duration).toBeCloseTo(1.6);
    expect(speech.start).toBeCloseTo(0.2);
    expect(speech.end).toBeCloseTo(1.4);
    expect(pauses).toHaveLength(1);
    expect(pauses[0].start).toBeCloseTo(0.7);
    expect(pauses[0].end).toBeCloseTo(1.0);
  });
});

describe('envelope and waveformPeaks', () => {
  it('measures RMS per frame and normalises bars', () => {
    const samples = new Float32Array(400).map((_, i) => (i < 200 ? 0.5 : 0));
    const frames = envelope(samples, 1000, 0.1);
    expect(frames).toHaveLength(4);
    expect(frames[0]).toBeCloseTo(0.5);
    expect(frames[3]).toBe(0);
    const bars = waveformPeaks(frames, 2);
    expect(bars).toEqual([1, 0]);
  });
});

describe('indexAt', () => {
  it('finds the item that has started at a time', () => {
    const items = [
      { start: 0, end: 1 },
      { start: 1, end: 2 },
      { start: 2.5, end: 3 },
    ];
    expect(indexAt(items, -0.1)).toBe(-1);
    expect(indexAt(items, 0.5)).toBe(0);
    expect(indexAt(items, 2.2)).toBe(1);
    expect(indexAt(items, 9)).toBe(2);
  });
});
