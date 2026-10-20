import type { SpeechPlayer } from '@/features/lipsync/speechPlayer';
import { speechScript, type SpeechClip, type SpeechRequest } from './ttsClient';

/** The part of `SpeechPlayer` the queue drives. */
export type SpeechSink = Pick<SpeechPlayer, 'load' | 'play' | 'stop'>;

export interface SpeechQueueOptions {
  /** Fetches the audio and timings for one sentence. */
  fetchClip: (request: SpeechRequest, signal: AbortSignal) => Promise<SpeechClip>;
  /** Called for a sentence that could not be spoken. */
  onError: (error: unknown) => void;
  /**
   * Marks errors that will hit every later sentence too (voice not configured,
   * signed out). After one, the rest of the batch is skipped quietly instead of
   * reporting the same problem again for each sentence. Other errors only skip
   * their own sentence. `reset()` clears it.
   */
  isFatal?: (error: unknown) => boolean;
  /** True while anything is fetching or playing, false once the queue has drained. */
  onSpeakingChange?: (speaking: boolean) => void;
}

interface Generation {
  controller: AbortController;
  /** Sentences enqueued in this generation that have not finished yet. */
  pending: number;
  /** A fatal error happened; the remaining sentences are skipped. */
  disabled: boolean;
}

/**
 * Speaks sentences one after another. The network request for a sentence starts
 * as soon as it is enqueued, so while sentence N plays, N+1 is already being
 * synthesized; playback itself is strictly sequential. `stop()` cuts the audio
 * and cancels everything that is queued or still downloading.
 */
export class SpeechQueue {
  private generation = newGeneration();
  private tail: Promise<void> = Promise.resolve();
  private endPlayback: (() => void) | undefined;

  constructor(
    private readonly sink: SpeechSink,
    private readonly options: SpeechQueueOptions,
  ) {}

  enqueue(request: SpeechRequest): void {
    const generation = this.generation;
    if (generation.disabled) return;
    if (generation.pending === 0) this.options.onSpeakingChange?.(true);
    generation.pending += 1;

    const clip = this.options.fetchClip(request, generation.controller.signal);
    clip.catch(() => undefined); // failures are reported in order by speak(); avoid an unhandled rejection
    this.tail = this.speakAfter(this.tail, clip, generation);
  }

  /** Resolves when everything enqueued so far has been spoken (or failed, or been stopped). */
  idle(): Promise<void> {
    return this.tail;
  }

  /** Call between replies: a fatal error in the previous one no longer blocks new sentences. */
  reset(): void {
    if (this.generation.pending === 0) this.generation = newGeneration();
  }

  stop(): void {
    const old = this.generation;
    old.controller.abort();
    this.generation = newGeneration();
    this.tail = Promise.resolve();
    this.endPlayback?.();
    this.sink.stop();
    if (old.pending > 0) this.options.onSpeakingChange?.(false);
  }

  private async speakAfter(
    previous: Promise<void>,
    clip: Promise<SpeechClip>,
    generation: Generation,
  ): Promise<void> {
    await previous;
    const { signal } = generation.controller;
    let release: (() => void) | undefined;
    try {
      if (generation.disabled) return;
      const data = await clip;
      if (signal.aborted) return;
      await this.sink.load(data.audio, speechScript(data));
      if (signal.aborted) return;
      await new Promise<void>((resolve, reject) => {
        release = resolve;
        this.endPlayback = resolve;
        this.sink.play(resolve).catch(reject);
      });
    } catch (error) {
      if (signal.aborted || generation.disabled) return;
      if (this.options.isFatal?.(error)) generation.disabled = true;
      this.options.onError(error);
    } finally {
      if (this.endPlayback === release) this.endPlayback = undefined;
      generation.pending -= 1;
      if (generation.pending === 0 && !signal.aborted) this.options.onSpeakingChange?.(false);
    }
  }
}

function newGeneration(): Generation {
  return { controller: new AbortController(), pending: 0, disabled: false };
}
