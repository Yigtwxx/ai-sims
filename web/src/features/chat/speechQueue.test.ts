// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { ApiFailure } from './chatClient';
import { SpeechQueue, type SpeechSink } from './speechQueue';
import type { SpeechClip, SpeechRequest } from './ttsClient';

/** A player that plays until the test says the clip has ended. */
function fakeSink() {
  let ended: (() => void) | undefined;
  const sink = {
    load: vi.fn<SpeechSink['load']>(async () => undefined),
    play: vi.fn<SpeechSink['play']>(async (onEnded) => {
      ended = onEnded;
    }),
    stop: vi.fn<SpeechSink['stop']>(() => {
      ended = undefined;
    }),
    finishClip() {
      const done = ended;
      ended = undefined;
      done?.();
    },
  };
  return sink;
}

const request = (text: string): SpeechRequest => ({ text, voice: 'female', locale: 'tr' });

const clip = (overrides: Partial<SpeechClip> = {}): SpeechClip => ({
  audio: new ArrayBuffer(2),
  visemes: [],
  words: [],
  text: 'x',
  ...overrides,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('SpeechQueue', () => {
  it('speaks sentences strictly one after another', async () => {
    const sink = fakeSink();
    const queue = new SpeechQueue(sink, {
      fetchClip: async (r) => clip({ text: r.text }),
      onError: vi.fn(),
    });

    queue.enqueue(request('Birinci.'));
    queue.enqueue(request('İkinci.'));

    await vi.waitFor(() => expect(sink.play).toHaveBeenCalledTimes(1));
    expect(sink.load).toHaveBeenCalledTimes(1); // the second clip waits for the first to end

    sink.finishClip();
    await vi.waitFor(() => expect(sink.play).toHaveBeenCalledTimes(2));
    sink.finishClip();
    await queue.idle();

    expect(sink.load.mock.calls.map(([, script]) => script)).toEqual([
      { text: 'Birinci.' },
      { text: 'İkinci.' },
    ]);
  });

  it('starts downloading the next sentence while the current one is playing', async () => {
    const sink = fakeSink();
    const fetchClip = vi.fn(async (r: SpeechRequest) => clip({ text: r.text }));
    const queue = new SpeechQueue(sink, { fetchClip, onError: vi.fn() });

    queue.enqueue(request('Birinci.'));
    queue.enqueue(request('İkinci.'));

    expect(fetchClip).toHaveBeenCalledTimes(2); // both requests are already in flight
    await vi.waitFor(() => expect(sink.play).toHaveBeenCalledTimes(1));
    expect(sink.play).toHaveBeenCalledTimes(1);
  });

  it('hands the best timing source to the player: viseme events, words, then text', async () => {
    const sink = fakeSink();
    const clips = [
      clip({
        visemes: [{ viseme: 'PP', time: 0.1 }],
        words: [{ text: 'a', time: 0, duration: 1 }],
      }),
      clip({ words: [{ text: 'a', time: 0, duration: 1 }] }),
      clip({ text: 'sadece metin' }),
    ];
    let next = 0;
    const queue = new SpeechQueue(sink, {
      fetchClip: async () => clips[next++]!,
      onError: vi.fn(),
    });

    for (const text of ['bir', 'iki', 'üç']) {
      queue.enqueue(request(text));
      await vi.waitFor(() => expect(sink.play).toHaveBeenCalledTimes(next));
      sink.finishClip();
    }
    await queue.idle();

    expect(sink.load.mock.calls.map(([, script]) => Object.keys(script))).toEqual([
      ['events'],
      ['words'],
      ['text'],
    ]);
  });

  it('reports speaking from the first enqueue until everything has been played', async () => {
    const sink = fakeSink();
    const onSpeakingChange = vi.fn();
    const queue = new SpeechQueue(sink, {
      fetchClip: async () => clip(),
      onError: vi.fn(),
      onSpeakingChange,
    });

    queue.enqueue(request('Birinci.'));
    queue.enqueue(request('İkinci.'));
    expect(onSpeakingChange.mock.calls).toEqual([[true]]);

    await vi.waitFor(() => expect(sink.play).toHaveBeenCalledTimes(1));
    sink.finishClip();
    await vi.waitFor(() => expect(sink.play).toHaveBeenCalledTimes(2));
    sink.finishClip();
    await queue.idle();

    expect(onSpeakingChange.mock.calls).toEqual([[true], [false]]);
  });

  it('reports a failed sentence and still speaks the next one', async () => {
    const sink = fakeSink();
    const onError = vi.fn();
    const failure = new ApiFailure('unavailable');
    const queue = new SpeechQueue(sink, {
      fetchClip: async (r) => {
        if (r.text === 'kötü') throw failure;
        return clip({ text: r.text });
      },
      onError,
    });

    queue.enqueue(request('kötü'));
    queue.enqueue(request('iyi'));
    await vi.waitFor(() => expect(sink.play).toHaveBeenCalledTimes(1));
    sink.finishClip();
    await queue.idle();

    expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(sink.load).toHaveBeenCalledTimes(1);
  });

  it('reports a decode or playback failure and moves on', async () => {
    const sink = fakeSink();
    const onError = vi.fn();
    sink.load.mockRejectedValueOnce(new Error('EncodingError'));
    const queue = new SpeechQueue(sink, { fetchClip: async () => clip(), onError });

    queue.enqueue(request('bozuk'));
    queue.enqueue(request('sağlam'));
    await vi.waitFor(() => expect(sink.play).toHaveBeenCalledTimes(1));
    sink.finishClip();
    await queue.idle();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(sink.load).toHaveBeenCalledTimes(2);
  });

  describe('fatal errors', () => {
    const notConfigured = new ApiFailure('not_configured');
    const isFatal = (error: unknown) =>
      error instanceof ApiFailure && error.kind === 'not_configured';

    it('report once and skip the rest of the batch quietly', async () => {
      const sink = fakeSink();
      const onError = vi.fn();
      const onSpeakingChange = vi.fn();
      const queue = new SpeechQueue(sink, {
        fetchClip: async () => {
          throw notConfigured;
        },
        isFatal,
        onError,
        onSpeakingChange,
      });

      queue.enqueue(request('bir'));
      queue.enqueue(request('iki'));
      queue.enqueue(request('üç'));
      await queue.idle();
      queue.enqueue(request('dört')); // after the failure: dropped without a request

      expect(onError).toHaveBeenCalledTimes(1);
      expect(sink.load).not.toHaveBeenCalled();
      expect(onSpeakingChange.mock.calls).toEqual([[true], [false]]);
    });

    it('stop blocking after reset(), for the next reply', async () => {
      const sink = fakeSink();
      let broken = true;
      const onError = vi.fn();
      const queue = new SpeechQueue(sink, {
        fetchClip: async () => {
          if (broken) throw notConfigured;
          return clip();
        },
        isFatal,
        onError,
      });

      queue.enqueue(request('bir'));
      await queue.idle();
      expect(onError).toHaveBeenCalledTimes(1);

      broken = false;
      queue.reset();
      queue.enqueue(request('iki'));
      await vi.waitFor(() => expect(sink.play).toHaveBeenCalledTimes(1));
      sink.finishClip();
      await queue.idle();
      expect(onError).toHaveBeenCalledTimes(1);
    });
  });

  describe('stop()', () => {
    it('cancels downloads, silences the player and reports that speaking ended', async () => {
      const sink = fakeSink();
      const download = deferred<SpeechClip>();
      let signal: AbortSignal | undefined;
      const onSpeakingChange = vi.fn();
      const onError = vi.fn();
      const queue = new SpeechQueue(sink, {
        fetchClip: (_r, s) => {
          signal = s;
          return download.promise;
        },
        onError,
        onSpeakingChange,
      });

      queue.enqueue(request('uzun'));
      queue.stop();

      expect(signal?.aborted).toBe(true);
      expect(sink.stop).toHaveBeenCalled();
      expect(onSpeakingChange.mock.calls).toEqual([[true], [false]]);

      // A download that finishes (or fails) after the stop must be ignored.
      download.resolve(clip());
      await queue.idle();
      expect(sink.load).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });

    it('releases the wait for the clip that is playing', async () => {
      const sink = fakeSink();
      const queue = new SpeechQueue(sink, { fetchClip: async () => clip(), onError: vi.fn() });

      queue.enqueue(request('çalıyor'));
      await vi.waitFor(() => expect(sink.play).toHaveBeenCalledTimes(1));
      queue.stop();

      await expect(queue.idle()).resolves.toBeUndefined();
    });

    it('does not report the aborted download as an error', async () => {
      const sink = fakeSink();
      const onError = vi.fn();
      const queue = new SpeechQueue(sink, {
        fetchClip: (_r, signal) =>
          new Promise<SpeechClip>((_resolve, reject) => {
            signal.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
        onError,
      });

      queue.enqueue(request('yarım'));
      queue.stop();
      await queue.idle();

      expect(onError).not.toHaveBeenCalled();
    });

    it('lets the queue be used again afterwards', async () => {
      const sink = fakeSink();
      const queue = new SpeechQueue(sink, { fetchClip: async () => clip(), onError: vi.fn() });

      queue.enqueue(request('eski'));
      queue.stop();
      queue.enqueue(request('yeni'));
      await vi.waitFor(() => expect(sink.play).toHaveBeenCalled());
      sink.finishClip();
      await queue.idle();

      expect(sink.load).toHaveBeenCalledTimes(1);
    });
  });
});
