// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TtsFailureKind } from './errors';

// A scripted stand-in for the Speech SDK. Enums come from the real package; the
// synthesizer never touches the network.
const sdk = vi.hoisted(() => ({
  configs: [] as Array<Record<string, unknown>>,
  synthesizers: [] as Array<{ audioConfig: unknown; close: ReturnType<typeof vi.fn> }>,
  script: undefined as undefined | ((synth: FakeSynth) => void),
}));

interface FakeSynth {
  visemeReceived?: (sender: unknown, event: unknown) => void;
  wordBoundary?: (sender: unknown, event: unknown) => void;
  callback: (result: unknown) => void;
  errorCallback: (message: string) => void;
}

vi.mock('microsoft-cognitiveservices-speech-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('microsoft-cognitiveservices-speech-sdk')>();
  class FakeSpeechConfig {
    static fromSubscription(key: string, region: string) {
      const config = new FakeSpeechConfig();
      Object.assign(config, { key, region });
      sdk.configs.push(config as unknown as Record<string, unknown>);
      return config;
    }
  }
  class FakeSynthesizer {
    visemeReceived?: FakeSynth['visemeReceived'];
    wordBoundary?: FakeSynth['wordBoundary'];
    close = vi.fn();
    constructor(_config: unknown, audioConfig: unknown) {
      sdk.synthesizers.push({ audioConfig, close: this.close });
    }
    speakTextAsync(
      _text: string,
      callback: (r: unknown) => void,
      errorCallback: (m: string) => void,
    ) {
      sdk.script?.({
        visemeReceived: this.visemeReceived,
        wordBoundary: this.wordBoundary,
        callback,
        errorCallback,
      });
    }
  }
  return {
    ...actual,
    SpeechConfig: FakeSpeechConfig,
    SpeechSynthesizer: FakeSynthesizer,
    CancellationDetails: {
      fromResult: (result: { fakeErrorCode: number }) => ({ ErrorCode: result.fakeErrorCode }),
    },
  };
});

const { synthesizeOnce, synthesizeSpeech, SPEECH_MIME } = await import('./azure');
const { TtsError } = await import('./errors');
const {
  CancellationErrorCode,
  ResultReason,
  SpeechSynthesisBoundaryType,
  SpeechSynthesisOutputFormat,
} = await vi.importActual<typeof import('microsoft-cognitiveservices-speech-sdk')>(
  'microsoft-cognitiveservices-speech-sdk',
);

const PARAMS = {
  text: 'Merhaba dünya',
  voice: 'tr-TR-EmelNeural',
  language: 'tr-TR',
  key: 'azure-test-key',
  region: 'westeurope',
};

const TICKS = 10_000_000;

const completed = (bytes = 4) => ({
  reason: ResultReason.SynthesizingAudioCompleted,
  audioData: new Uint8Array(Array.from({ length: bytes }, (_, i) => i + 1)).buffer,
});

const canceled = (code: number) => ({
  reason: ResultReason.Canceled,
  fakeErrorCode: code,
  errorDetails: 'RAW-ERROR-DETAILS-SECRET',
});

const word = (
  text: string,
  startSeconds: number,
  durationSeconds: number,
  type = SpeechSynthesisBoundaryType.Word,
) => ({
  text,
  audioOffset: startSeconds * TICKS,
  duration: durationSeconds * TICKS,
  boundaryType: type,
});

beforeEach(() => {
  sdk.configs.length = 0;
  sdk.synthesizers.length = 0;
  sdk.script = undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('synthesizeOnce', () => {
  it('returns the audio with viseme and word events converted from ticks to seconds', async () => {
    sdk.script = (synth) => {
      synth.visemeReceived?.({}, { audioOffset: 2 * TICKS, visemeId: 6 });
      synth.visemeReceived?.({}, { audioOffset: 0.5 * TICKS, visemeId: 21 });
      synth.wordBoundary?.({}, word('dünya', 0.9, 0.4));
      synth.wordBoundary?.({}, word('Merhaba', 0.1, 0.7));
      synth.callback(completed(4));
    };

    const speech = await synthesizeOnce(PARAMS);

    expect(speech.mime).toBe('audio/mpeg');
    expect(SPEECH_MIME).toBe('audio/mpeg');
    expect([...speech.audio]).toEqual([1, 2, 3, 4]);
    // Sorted by time and expressed in seconds.
    expect(speech.visemes).toEqual([
      { time: 0.5, id: 21 },
      { time: 2, id: 6 },
    ]);
    expect(speech.words).toEqual([
      { time: 0.1, duration: 0.7, text: 'Merhaba' },
      { time: 0.9, duration: 0.4, text: 'dünya' },
    ]);
  });

  it('keeps word boundaries only, not punctuation or sentence boundaries', async () => {
    sdk.script = (synth) => {
      synth.wordBoundary?.({}, word('Merhaba', 0, 0.5));
      synth.wordBoundary?.({}, word(',', 0.5, 0.1, SpeechSynthesisBoundaryType.Punctuation));
      synth.wordBoundary?.({}, word('Merhaba, dünya.', 0, 1, SpeechSynthesisBoundaryType.Sentence));
      synth.callback(completed());
    };
    const speech = await synthesizeOnce(PARAMS);
    expect(speech.words.map((w) => w.text)).toEqual(['Merhaba']);
  });

  it('configures voice, language and MP3 output, and keeps the audio in memory', async () => {
    sdk.script = (synth) => synth.callback(completed());
    await synthesizeOnce(PARAMS);

    expect(sdk.configs[0]).toMatchObject({
      key: 'azure-test-key',
      region: 'westeurope',
      speechSynthesisVoiceName: 'tr-TR-EmelNeural',
      speechSynthesisLanguage: 'tr-TR',
      speechSynthesisOutputFormat: SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3,
    });
    // `null` (not undefined) tells the SDK not to open a speaker.
    expect(sdk.synthesizers[0]?.audioConfig).toBeNull();
  });

  it('returns no visemes for a voice that does not emit them', async () => {
    sdk.script = (synth) => synth.callback(completed());
    expect((await synthesizeOnce(PARAMS)).visemes).toEqual([]);
  });

  it('closes the synthesizer after a successful synthesis', async () => {
    sdk.script = (synth) => synth.callback(completed());
    await synthesizeOnce(PARAMS);
    expect(sdk.synthesizers[0]?.close).toHaveBeenCalledTimes(1);
  });

  it.each<[string, number, TtsFailureKind]>([
    ['authentication failure', CancellationErrorCode.AuthenticationFailure, 'auth'],
    ['forbidden', CancellationErrorCode.Forbidden, 'auth'],
    ['too many requests', CancellationErrorCode.TooManyRequests, 'rate_limit'],
    ['connection failure', CancellationErrorCode.ConnectionFailure, 'network'],
    ['service timeout', CancellationErrorCode.ServiceTimeout, 'timeout'],
    ['bad request parameters', CancellationErrorCode.BadRequestParameters, 'bad_request'],
    ['service error', CancellationErrorCode.ServiceError, 'service'],
    ['runtime error', CancellationErrorCode.RuntimeError, 'unknown'],
  ])('maps a canceled result (%s) to a %s-free error kind', async (_name, code, kind) => {
    sdk.script = (synth) => synth.callback(canceled(code));

    const error = await synthesizeOnce(PARAMS).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TtsError);
    expect(error).toMatchObject({ kind });
    expect(String((error as Error).message)).not.toContain('SECRET');
    expect(sdk.synthesizers[0]?.close).toHaveBeenCalledTimes(1);
  });

  it('fails with an unknown kind when the SDK calls the error callback', async () => {
    sdk.script = (synth) => synth.errorCallback('RAW-ERROR-DETAILS-SECRET');
    const error = await synthesizeOnce(PARAMS).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'TtsError', kind: 'unknown' });
    expect((error as Error).message).not.toContain('SECRET');
    expect(sdk.synthesizers[0]?.close).toHaveBeenCalledTimes(1);
  });

  it('fails when the service returns no audio', async () => {
    sdk.script = (synth) => synth.callback(completed(0));
    await expect(synthesizeOnce(PARAMS)).rejects.toMatchObject({ kind: 'service' });
  });

  it('times out and closes the synthesizer when the service never answers', async () => {
    sdk.script = () => undefined;
    const error = await synthesizeOnce({ ...PARAMS, timeoutMs: 20 }).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'timeout' });
    expect(sdk.synthesizers[0]?.close).toHaveBeenCalledTimes(1);
  });

  it('aborts and closes the synthesizer when the caller goes away', async () => {
    const controller = new AbortController();
    sdk.script = () => controller.abort();
    const error = await synthesizeOnce({ ...PARAMS, signal: controller.signal }).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ kind: 'aborted' });
    expect(sdk.synthesizers[0]?.close).toHaveBeenCalledTimes(1);
  });

  it('does not create a synthesizer for an already-aborted request', async () => {
    await expect(synthesizeOnce({ ...PARAMS, signal: AbortSignal.abort() })).rejects.toMatchObject({
      kind: 'aborted',
    });
    expect(sdk.synthesizers).toHaveLength(0);
  });

  it('ignores a late result after it has already failed (settles once)', async () => {
    let late: (() => void) | undefined;
    sdk.script = (synth) => {
      synth.errorCallback('x');
      late = () => synth.callback(completed());
    };
    await expect(synthesizeOnce(PARAMS)).rejects.toMatchObject({ kind: 'unknown' });
    expect(() => late?.()).not.toThrow();
    expect(sdk.synthesizers[0]?.close).toHaveBeenCalledTimes(1);
  });
});

describe('synthesizeSpeech (retries)', () => {
  const fast = { ...PARAMS, retryDelaysMs: [0, 0] };

  it('retries a rate-limited attempt and returns the later success', async () => {
    let calls = 0;
    sdk.script = (synth) => {
      calls += 1;
      if (calls < 3) synth.callback(canceled(CancellationErrorCode.TooManyRequests));
      else synth.callback(completed());
    };

    const speech = await synthesizeSpeech(fast);

    expect([...speech.audio]).toEqual([1, 2, 3, 4]);
    expect(sdk.synthesizers).toHaveLength(3);
    for (const synthesizer of sdk.synthesizers) expect(synthesizer.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a connection failure', CancellationErrorCode.ConnectionFailure, 'network'],
    ['a service error', CancellationErrorCode.ServiceError, 'service'],
    ['rate limiting', CancellationErrorCode.TooManyRequests, 'rate_limit'],
  ] as const)('gives up after two retries on %s', async (_name, code, kind) => {
    sdk.script = (synth) => synth.callback(canceled(code));

    await expect(synthesizeSpeech(fast)).rejects.toMatchObject({ kind });
    expect(sdk.synthesizers).toHaveLength(3); // 1 try + 2 retries
  });

  it.each([
    ['an authentication failure', CancellationErrorCode.AuthenticationFailure],
    ['bad request parameters', CancellationErrorCode.BadRequestParameters],
    ['a service timeout', CancellationErrorCode.ServiceTimeout],
  ] as const)('does not retry %s', async (_name, code) => {
    sdk.script = (synth) => synth.callback(canceled(code));

    await expect(synthesizeSpeech(fast)).rejects.toBeInstanceOf(TtsError);
    expect(sdk.synthesizers).toHaveLength(1);
  });

  it('does not retry our own timeout, which already cost the full wait', async () => {
    sdk.script = () => undefined;
    await expect(synthesizeSpeech({ ...fast, timeoutMs: 20 })).rejects.toMatchObject({
      kind: 'timeout',
    });
    expect(sdk.synthesizers).toHaveLength(1);
  });

  it('can be configured not to retry at all', async () => {
    sdk.script = (synth) => synth.callback(canceled(CancellationErrorCode.TooManyRequests));
    await expect(synthesizeSpeech({ ...PARAMS, retryDelaysMs: [] })).rejects.toMatchObject({
      kind: 'rate_limit',
    });
    expect(sdk.synthesizers).toHaveLength(1);
  });

  it('stops retrying when the caller goes away', async () => {
    const controller = new AbortController();
    sdk.script = (synth) => {
      synth.callback(canceled(CancellationErrorCode.TooManyRequests));
      controller.abort();
    };

    await expect(
      synthesizeSpeech({ ...PARAMS, retryDelaysMs: [60_000, 60_000], signal: controller.signal }),
    ).rejects.toBeInstanceOf(TtsError);
    expect(sdk.synthesizers).toHaveLength(1);
  });
});
