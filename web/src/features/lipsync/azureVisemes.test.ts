import { describe, expect, it } from 'vitest';

import { AZURE_TO_OCULUS, azureVisemeToOculus, toVisemeEvents } from './azureVisemes';
import { timelineFromEvents } from './timeline';
import { VISEMES } from './visemes';

// The agreed table: Microsoft viseme id -> Oculus viseme.
const EXPECTED = [
  [0, 'sil'],
  [1, 'aa'],
  [2, 'aa'],
  [3, 'O'],
  [4, 'E'],
  [5, 'RR'],
  [6, 'I'],
  [7, 'U'],
  [8, 'O'],
  [9, 'aa'],
  [10, 'O'],
  [11, 'aa'],
  [12, 'kk'],
  [13, 'RR'],
  [14, 'nn'],
  [15, 'SS'],
  [16, 'CH'],
  [17, 'TH'],
  [18, 'FF'],
  [19, 'DD'],
  [20, 'kk'],
  [21, 'PP'],
] as const;

describe('azureVisemeToOculus', () => {
  it.each(EXPECTED)('maps Microsoft viseme %i to %s', (id, viseme) => {
    expect(azureVisemeToOculus(id)).toBe(viseme);
  });

  it('covers exactly the 22 Microsoft ids', () => {
    expect(AZURE_TO_OCULUS).toHaveLength(22);
  });

  it('only produces valid Oculus visemes', () => {
    for (const viseme of AZURE_TO_OCULUS) expect(VISEMES).toContain(viseme);
  });

  it('closes the lips for the bilabials (p, b, m) and not for anything else', () => {
    expect(azureVisemeToOculus(21)).toBe('PP');
    expect(AZURE_TO_OCULUS.filter((viseme) => viseme === 'PP')).toHaveLength(1);
  });

  it.each([-1, 22, 100, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'treats the unknown id %s as silence',
    (id) => {
      expect(azureVisemeToOculus(id)).toBe('sil');
    },
  );
});

describe('toVisemeEvents', () => {
  it('maps ids and keeps the times', () => {
    expect(
      toVisemeEvents([
        { time: 0.1, id: 21 },
        { time: 0.25, id: 1 },
      ]),
    ).toEqual([
      { viseme: 'PP', time: 0.1 },
      { viseme: 'aa', time: 0.25 },
    ]);
  });

  it('sorts by time and drops events with an invalid time', () => {
    expect(
      toVisemeEvents([
        { time: 0.5, id: 6 },
        { time: Number.NaN, id: 1 },
        { time: -0.2, id: 1 },
        { time: 0.1, id: 7 },
      ]),
    ).toEqual([
      { viseme: 'U', time: 0.1 },
      { viseme: 'I', time: 0.5 },
    ]);
  });

  it('does not mutate its input', () => {
    const input = [
      { time: 0.5, id: 6 },
      { time: 0.1, id: 7 },
    ];
    toVisemeEvents(input);
    expect(input.map((event) => event.time)).toEqual([0.5, 0.1]);
  });

  it('returns an empty list for a voice without viseme events', () => {
    expect(toVisemeEvents([])).toEqual([]);
  });

  it('feeds the player timeline: each viseme lasts until the next event', () => {
    const timeline = timelineFromEvents(
      toVisemeEvents([
        { time: 0, id: 0 },
        { time: 0.2, id: 21 },
        { time: 0.35, id: 2 },
      ]),
      1,
    );
    expect(timeline).toEqual([
      { viseme: 'sil', start: 0, end: 0.2 },
      { viseme: 'PP', start: 0.2, end: 0.35 },
      { viseme: 'aa', start: 0.35, end: 1 },
    ]);
  });
});
