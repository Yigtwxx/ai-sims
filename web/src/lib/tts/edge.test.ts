// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { parseWordBoundaries } from './edge';

describe('parseWordBoundaries', () => {
  it('converts 100 ns ticks to seconds and keeps only word boundaries', () => {
    const chunk = JSON.stringify({
      Metadata: [
        {
          Type: 'WordBoundary',
          Data: { Offset: 1_000_000, Duration: 4_000_000, text: { Text: 'Merhaba' } },
        },
        {
          Type: 'SentenceBoundary',
          Data: { Offset: 0, Duration: 0, text: { Text: 'Merhaba dünya.' } },
        },
        {
          Type: 'WordBoundary',
          Data: { Offset: 6_000_000, Duration: 3_000_000, text: { Text: 'dünya' } },
        },
      ],
    });
    expect(parseWordBoundaries([chunk])).toEqual([
      { time: 0.1, duration: 0.4, text: 'Merhaba' },
      { time: 0.6, duration: 0.3, text: 'dünya' },
    ]);
  });

  it('ignores malformed chunks and empty words', () => {
    const empty = JSON.stringify({
      Metadata: [{ Type: 'WordBoundary', Data: { text: { Text: ' ' } } }],
    });
    expect(parseWordBoundaries(['not json', empty])).toEqual([]);
  });
});
