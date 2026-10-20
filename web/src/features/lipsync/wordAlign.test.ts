import { describe, expect, it } from 'vitest';

import { sampleTimeline } from './timeline';
import { textToVisemes } from './turkish';
import { timelineFromWords } from './wordAlign';

const word = (text: string, time: number, duration: number) => ({ text, time, duration });

describe('timelineFromWords', () => {
  it('stretches a word over exactly [time, time + duration]', () => {
    const timeline = timelineFromWords([word('merhaba', 0.2, 0.6)]);
    expect(timeline[0]!.start).toBeCloseTo(0.2);
    expect(timeline.at(-1)!.end).toBeCloseTo(0.8);
  });

  it('expands the word with the Turkish letter rules, contiguously', () => {
    const timeline = timelineFromWords([word('merhaba', 0, 0.7)]);
    expect(timeline.map((segment) => segment.viseme)).toEqual(
      textToVisemes('merhaba').map((segment) => segment.viseme),
    );
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i]!.start).toBeCloseTo(timeline[i - 1]!.end);
    }
  });

  it('gives longer sounds more time within the word', () => {
    // "a" (vowel, weight 1) vs "p" (bilabial, weight 0.75) in "ap".
    const [vowel, bilabial] = timelineFromWords([word('ap', 0, 0.35)]);
    expect(vowel!.end - vowel!.start).toBeGreaterThan(bilabial!.end - bilabial!.start);
  });

  it('keeps each word inside its own interval', () => {
    const timeline = timelineFromWords([word('bir', 0.1, 0.3), word('iki', 0.6, 0.4)]);
    const second = timeline.filter((segment) => segment.start >= 0.6);
    expect(second[0]!.start).toBeCloseTo(0.6);
    expect(second.at(-1)!.end).toBeCloseTo(1.0);
  });

  it('keeps a real pause between words silent', () => {
    const timeline = timelineFromWords([word('ba', 0, 0.4), word('ma', 1.0, 0.4)]);

    // The pause is covered by a silent segment, never by a neighbour's mouth shape.
    const inPause = timeline.filter((segment) => segment.start >= 0.4 && segment.end <= 1.0);
    expect(inPause).toEqual([{ viseme: 'sil', start: 0.4, end: 1.0 }]);
    expect(sampleTimeline(timeline, 0.7)).toEqual({});
  });

  it('starts a word after a pause from a closed mouth, not from the previous word', () => {
    // "a" ends open (aa); the next word starts with a bilabial after a pause.
    const timeline = timelineFromWords([word('a', 0, 0.3), word('ba', 1.0, 0.3)]);
    const atOnset = sampleTimeline(timeline, 1.001);
    expect(atOnset.PP).toBeGreaterThan(0);
    expect(atOnset.aa).toBeUndefined();
  });

  it('bridges tiny gaps so the mouth does not flutter between words', () => {
    const timeline = timelineFromWords([word('ba', 0, 0.4), word('ma', 0.43, 0.4)]);
    expect(timeline.some((segment) => segment.viseme === 'sil')).toBe(false);
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i]!.start).toBeCloseTo(timeline[i - 1]!.end);
    }
  });

  it('trims overlapping words instead of stacking them', () => {
    const timeline = timelineFromWords([word('bir', 0, 0.5), word('iki', 0.4, 0.5)]);
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i]!.start).toBeGreaterThanOrEqual(timeline[i - 1]!.end - 1e-9);
    }
    expect(timeline.at(-1)!.end).toBeCloseTo(0.9);
  });

  it('sorts unordered input by time', () => {
    const timeline = timelineFromWords([word('iki', 0.6, 0.4), word('bir', 0, 0.4)]);
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i]!.start).toBeGreaterThanOrEqual(timeline[i - 1]!.start);
    }
    expect(timeline[0]!.start).toBeCloseTo(0);
  });

  it('ignores boundaries with nothing to say or unusable timing', () => {
    expect(
      timelineFromWords([
        word(',', 0, 0.2),
        word('123', 0.2, 0.3),
        word('bir', 0.5, 0),
        word('bir', 0.5, -1),
        word('bir', Number.NaN, 0.3),
        word('bir', 0.5, Number.POSITIVE_INFINITY),
      ]),
    ).toEqual([]);
  });

  it('returns an empty timeline when there are no words', () => {
    expect(timelineFromWords([])).toEqual([]);
  });

  it('does not mutate its input', () => {
    const words = [word('iki', 0.6, 0.4), word('bir', 0, 0.4)];
    timelineFromWords(words);
    expect(words.map((w) => w.text)).toEqual(['iki', 'bir']);
  });
});
