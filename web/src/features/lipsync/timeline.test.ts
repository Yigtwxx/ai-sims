import { describe, expect, it } from 'vitest';

import {
  buildTimeline,
  CLOSURE_GAIN,
  sampleTimeline,
  scaleWeights,
  timelineFromEvents,
} from './timeline';
import { textToVisemes } from './turkish';

describe('buildTimeline', () => {
  it('fills exactly the spoken part of the audio', () => {
    const timeline = buildTimeline(textToVisemes('merhaba'), 2, { leadIn: 0.2, tail: 0.3 });
    expect(timeline[0].start).toBeCloseTo(0.2);
    expect(timeline.at(-1)!.end).toBeCloseTo(1.7);
  });

  it('keeps segments contiguous', () => {
    const timeline = buildTimeline(textToVisemes('nasılsın'), 1.2);
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i].start).toBeCloseTo(timeline[i - 1].end);
    }
  });

  it('returns an empty timeline when there is nothing to say', () => {
    expect(buildTimeline([], 2)).toEqual([]);
    expect(buildTimeline(textToVisemes('a'), 0)).toEqual([]);
  });
});

describe('timelineFromEvents', () => {
  it('ends each viseme where the next begins and the last at audio end', () => {
    const timeline = timelineFromEvents(
      [
        { viseme: 'PP', time: 0.1 },
        { viseme: 'aa', time: 0.25 },
      ],
      0.6,
    );
    expect(timeline).toEqual([
      { viseme: 'PP', start: 0.1, end: 0.25 },
      { viseme: 'aa', start: 0.25, end: 0.6 },
    ]);
  });
});

describe('sampleTimeline', () => {
  const timeline = [
    { viseme: 'aa' as const, start: 0, end: 0.3 },
    { viseme: 'PP' as const, start: 0.3, end: 0.4 },
    { viseme: 'O' as const, start: 0.4, end: 0.8 },
  ];

  it('hits the pure target shape in the middle of a long segment', () => {
    expect(sampleTimeline(timeline, 0.6)).toEqual({ O: 1 });
  });

  it('cross-fades at boundaries with weights summing to 1', () => {
    const w = sampleTimeline(timeline, 0.41);
    expect(w.O).toBeGreaterThan(0.5);
    expect(w.PP).toBeGreaterThan(0);
    expect((w.O ?? 0) + (w.PP ?? 0)).toBeCloseTo(1);
  });

  it('starts closing the lips before a bilabial begins', () => {
    const before = sampleTimeline(timeline, 0.27);
    expect(before.PP ?? 0).toBeGreaterThan(0);
  });

  it('is silent outside the timeline', () => {
    expect(sampleTimeline(timeline, -0.1)).toEqual({});
    expect(sampleTimeline(timeline, 1)).toEqual({});
  });
});

describe('scaleWeights', () => {
  it('scales open shapes but drives lip closures to full strength', () => {
    expect(scaleWeights({ aa: 1, PP: 0.8 }, 0.5)).toEqual({ aa: 0.5, PP: 1 });
    expect(scaleWeights({ PP: 0.25 }, 0.5).PP).toBeCloseTo(0.25 * CLOSURE_GAIN);
  });
});
