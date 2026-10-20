import 'server-only';
import {
  CancellationDetails,
  CancellationErrorCode,
  ResultReason,
  SpeechConfig,
  SpeechSynthesisBoundaryType,
  SpeechSynthesisOutputFormat,
  SpeechSynthesizer,
  type SpeechSynthesisResult,
} from 'microsoft-cognitiveservices-speech-sdk';
import { TtsError, type TtsFailureKind } from './errors';
import { withRetry } from './retry';
import type { TtsViseme, TtsWord } from './types';

/** Azure reports offsets and durations in ticks of 100 nanoseconds. */
const TICKS_PER_SECOND = 10_000_000;
const DEFAULT_TIMEOUT_MS = 20_000;
// Two retries with backoff, only for quick transient failures (Microsoft recommends
// retrying 429s: the service may still be scaling up). Timeouts are not retried: they
// already cost the full timeout.
const DEFAULT_RETRY_DELAYS_MS = [300, 900] as const;
const RETRYABLE_KINDS: ReadonlySet<TtsFailureKind> = new Set(['rate_limit', 'network', 'service']);

export const SPEECH_MIME = 'audio/mpeg';

export interface SynthesizeParams {
  text: string;
  /** Azure voice name, e.g. `tr-TR-EmelNeural`. */
  voice: string;
  /** BCP-47 language, e.g. `tr-TR`. */
  language: string;
  key: string;
  region: string;
  signal?: AbortSignal;
  /** Timeout of one attempt. */
  timeoutMs?: number;
  /** Pauses before each retry; defaults to 300 ms and 900 ms. Pass `[]` to disable retries. */
  retryDelaysMs?: readonly number[];
}

export interface SynthesizedSpeech {
  audio: Uint8Array;
  mime: typeof SPEECH_MIME;
  /** Viseme events in seconds. Empty for voices without viseme support. */
  visemes: TtsViseme[];
  /** Word boundaries in seconds. */
  words: TtsWord[];
}

function kindFromErrorCode(code: CancellationErrorCode): TtsFailureKind {
  switch (code) {
    case CancellationErrorCode.AuthenticationFailure:
    case CancellationErrorCode.Forbidden:
      return 'auth';
    case CancellationErrorCode.BadRequestParameters:
      return 'bad_request';
    case CancellationErrorCode.TooManyRequests:
      return 'rate_limit';
    case CancellationErrorCode.ConnectionFailure:
      return 'network';
    case CancellationErrorCode.ServiceTimeout:
      return 'timeout';
    case CancellationErrorCode.ServiceError:
      return 'service';
    default:
      return 'unknown';
  }
}

/**
 * Synthesizes `text`, retrying quick transient failures (429, connection and
 * service errors) with backoff. Auth errors, bad parameters, timeouts and
 * aborts fail immediately.
 */
export function synthesizeSpeech(params: SynthesizeParams): Promise<SynthesizedSpeech> {
  return withRetry(() => synthesizeOnce(params), {
    delaysMs: params.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS,
    shouldRetry: (error) => error instanceof TtsError && RETRYABLE_KINDS.has(error.kind),
    signal: params.signal,
  });
}

/**
 * One attempt: synthesizes `text` into an in-memory MP3 and collects the viseme
 * and word boundary events. Nothing is played: passing `null` as the audio
 * config keeps the SDK from opening a speaker.
 *
 * `speakTextAsync` XML-escapes the text itself, so user text cannot inject SSML.
 * The synthesizer is closed on every path (success, failure, timeout, abort).
 */
export function synthesizeOnce(params: SynthesizeParams): Promise<SynthesizedSpeech> {
  const { text, voice, language, key, region, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = params;

  return new Promise<SynthesizedSpeech>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new TtsError('aborted'));
      return;
    }

    const config = SpeechConfig.fromSubscription(key, region);
    config.speechSynthesisVoiceName = voice;
    config.speechSynthesisLanguage = language;
    config.speechSynthesisOutputFormat = SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3;
    const synthesizer = new SpeechSynthesizer(config, null);

    const visemes: TtsViseme[] = [];
    const words: TtsWord[] = [];
    let settled = false;

    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      try {
        synthesizer.close();
      } catch {
        // already closed
      }
      finish();
    };
    const fail = (kind: TtsFailureKind) => settle(() => reject(new TtsError(kind)));
    const onAbort = () => fail('aborted');

    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => fail('timeout'), timeoutMs);

    // Subscribing before speaking is what makes the service send these events.
    synthesizer.visemeReceived = (_sender, event) => {
      visemes.push({ time: event.audioOffset / TICKS_PER_SECOND, id: event.visemeId });
    };
    synthesizer.wordBoundary = (_sender, event) => {
      // Punctuation and sentence boundaries carry no lip movement of their own.
      if (event.boundaryType !== SpeechSynthesisBoundaryType.Word) return;
      words.push({
        time: event.audioOffset / TICKS_PER_SECOND,
        duration: event.duration / TICKS_PER_SECOND,
        text: event.text,
      });
    };

    synthesizer.speakTextAsync(
      text,
      (result: SpeechSynthesisResult) => {
        if (result.reason === ResultReason.Canceled) {
          const details = CancellationDetails.fromResult(result);
          fail(kindFromErrorCode(details.ErrorCode));
          return;
        }
        if (result.reason !== ResultReason.SynthesizingAudioCompleted) {
          fail('unknown');
          return;
        }
        if (result.audioData.byteLength === 0) {
          fail('service');
          return;
        }
        const audio = new Uint8Array(result.audioData);
        settle(() =>
          resolve({
            audio,
            mime: SPEECH_MIME,
            visemes: visemes.sort((a, b) => a.time - b.time),
            words: words.sort((a, b) => a.time - b.time),
          }),
        );
      },
      () => fail('unknown'),
    );
  });
}
