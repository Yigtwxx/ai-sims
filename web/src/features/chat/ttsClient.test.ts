// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { ApiFailure, type ApiFailureKind } from './chatClient';
import { base64ToArrayBuffer, fetchSpeechClip, speechScript, type SpeechClip } from './ttsClient';

const REQUEST = { text: 'Merhaba dünya.', voice: 'female', locale: 'tr' } as const;

const clip = (overrides: Partial<SpeechClip> = {}): SpeechClip => ({
  audio: new ArrayBuffer(4),
  visemes: [],
  words: [],
  text: 'Merhaba',
  ...overrides,
});

describe('speechScript', () => {
  const visemes = [{ viseme: 'PP' as const, time: 0.1 }];
  const words = [{ text: 'Merhaba', time: 0, duration: 0.5 }];

  it('prefers viseme events, then word boundaries, then the text', () => {
    expect(speechScript(clip({ visemes, words }))).toEqual({ events: visemes });
    expect(speechScript(clip({ words }))).toEqual({ words });
    expect(speechScript(clip())).toEqual({ text: 'Merhaba' });
  });
});

describe('base64ToArrayBuffer', () => {
  it('decodes bytes exactly', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    const base64 = Buffer.from(bytes).toString('base64');
    expect([...new Uint8Array(base64ToArrayBuffer(base64))]).toEqual([...bytes]);
  });
});

describe('fetchSpeechClip', () => {
  it('posts the sentence and returns audio, Oculus visemes and words', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      Response.json({
        audio: Buffer.from([9, 8, 7]).toString('base64'),
        mime: 'audio/mpeg',
        visemes: [
          { time: 0.3, id: 1 },
          { time: 0.1, id: 21 },
        ],
        words: [{ time: 0.1, duration: 0.4, text: 'Merhaba' }],
      }),
    );
    const controller = new AbortController();

    const result = await fetchSpeechClip(REQUEST, controller.signal, fetchFn);

    expect([...new Uint8Array(result.audio)]).toEqual([9, 8, 7]);
    // Azure ids become Oculus visemes, ordered by time.
    expect(result.visemes).toEqual([
      { viseme: 'PP', time: 0.1 },
      { viseme: 'aa', time: 0.3 },
    ]);
    expect(result.words).toEqual([{ time: 0.1, duration: 0.4, text: 'Merhaba' }]);
    expect(result.text).toBe('Merhaba dünya.');

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('/api/tts');
    expect(init?.method).toBe('POST');
    expect(init?.signal).toBe(controller.signal);
    expect(JSON.parse(init?.body as string)).toEqual(REQUEST);
  });

  it('handles a voice without viseme events', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      Response.json({ audio: '', mime: 'audio/mpeg', visemes: [], words: [] }),
    );
    const result = await fetchSpeechClip(REQUEST, undefined, fetchFn);
    expect(result.visemes).toEqual([]);
    expect(speechScript(result)).toEqual({ text: 'Merhaba dünya.' });
  });

  it.each<[string, number, unknown, ApiFailureKind]>([
    ['401', 401, { error: 'unauthenticated' }, 'unauthenticated'],
    ['503 tts_not_configured', 503, { error: 'tts_not_configured' }, 'not_configured'],
    ['502', 502, { error: 'tts_unavailable' }, 'unavailable'],
    ['400', 400, { error: 'invalid_request' }, 'invalid'],
  ])('maps %s to %s', async (_name, status, body, kind) => {
    const fetchFn = vi.fn<typeof fetch>(async () => Response.json(body, { status }));
    const error = await fetchSpeechClip(REQUEST, undefined, fetchFn).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiFailure);
    expect((error as ApiFailure).kind).toBe(kind);
  });

  it('reports a network failure', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed');
    });
    const error = await fetchSpeechClip(REQUEST, undefined, fetchFn).catch((e: unknown) => e);
    expect((error as ApiFailure).kind).toBe('network');
  });
});
