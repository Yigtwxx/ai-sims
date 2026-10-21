// @vitest-environment node
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseWordBoundaries, synthesizeWithEdge } from './edge';

// A scripted stand-in for msedge-tts: each connection plays the next attempt's
// outcome; nothing touches the network.
const edge = vi.hoisted(() => ({
  attempts: [] as Array<'ok' | Error>,
  connections: 0,
}));

vi.mock('msedge-tts', () => ({
  OUTPUT_FORMAT: { AUDIO_24KHZ_48KBITRATE_MONO_MP3: 'mp3' },
  MsEdgeTTS: class {
    private readonly outcome = edge.attempts[edge.connections++] ?? 'ok';
    async setMetadata() {
      if (this.outcome instanceof Error) throw this.outcome;
    }
    toStream() {
      return {
        audioStream: Readable.from([Buffer.from([1, 2, 3])]),
        metadataStream: Readable.from([]),
      };
    }
    close() {}
  },
}));

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

describe('synthesizeWithEdge', () => {
  beforeEach(() => {
    edge.attempts = [];
    edge.connections = 0;
  });

  it('retries a dropped connection instead of giving up on word timings', async () => {
    edge.attempts = [new Error('Edge TTS WebSocket error: socket hang up'), 'ok'];
    const speech = await synthesizeWithEdge({
      text: 'Merhaba',
      voice: 'tr-TR-EmelNeural',
      retryDelaysMs: [0],
    });
    expect(edge.connections).toBe(2);
    expect([...speech.audio]).toEqual([1, 2, 3]);
  });

  it('does not retry a timeout, which already took the whole wait', async () => {
    edge.attempts = [new Error('Edge TTS connection timed out after 10000 milliseconds.')];
    await expect(
      synthesizeWithEdge({ text: 'Merhaba', voice: 'tr-TR-EmelNeural', retryDelaysMs: [0] }),
    ).rejects.toMatchObject({ kind: 'timeout' });
    expect(edge.connections).toBe(1);
  });
});
