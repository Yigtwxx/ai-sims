import type { SpeechSink } from '@/features/chat/speechQueue';
import type { SpeechClip } from '@/features/chat/ttsClient';
import type { WordBoundary } from '@/features/lipsync/wordAlign';
import type { SpeechPlayer } from '@/features/lipsync/speechPlayer';

/** The sentence being heard right now, for subtitles under the character. */
export interface SubtitleLine {
  /** Increments per sentence so the UI can animate line changes. */
  id: number;
  text: string;
  /** TTS word timings (seconds from the start of the clip); empty when the voice has none. */
  words: WordBoundary[];
  duration: number;
  /** `performance.now()` when playback started. */
  startedAt: number;
}

/**
 * Sits between the SpeechQueue and the shared SpeechPlayer: it forwards every
 * call unchanged (the avatar keeps listening to the player) and reports which
 * sentence is playing so subtitles can follow it word by word. Clips are
 * looked up by their audio buffer, registered when they are fetched.
 */
export class SubtitleSink implements SpeechSink {
  private readonly clips = new WeakMap<ArrayBuffer, SpeechClip>();
  private loaded: SpeechClip | undefined;
  private counter = 0;

  constructor(
    private readonly player: SpeechPlayer,
    private readonly onLine: (line: SubtitleLine | null) => void,
  ) {}

  /** Call with every fetched clip, before the queue loads it. */
  register(clip: SpeechClip): SpeechClip {
    this.clips.set(clip.audio, clip);
    return clip;
  }

  async load(...args: Parameters<SpeechPlayer['load']>): Promise<void> {
    this.loaded = this.clips.get(args[0]);
    await this.player.load(...args);
  }

  async play(onEnded?: () => void): Promise<void> {
    const clip = this.loaded;
    await this.player.play(() => {
      this.onLine(null);
      onEnded?.();
    });
    this.counter += 1;
    this.onLine(
      clip
        ? {
            id: this.counter,
            text: clip.text,
            words: clip.words,
            duration: this.player.duration,
            startedAt: performance.now(),
          }
        : null,
    );
  }

  stop(): void {
    this.player.stop();
    this.onLine(null);
  }
}

/**
 * Index of the word being spoken `elapsed` seconds into a line. Uses TTS word
 * timings when present, else spreads the words over the clip by length.
 */
export function activeWordIndex(line: SubtitleLine, words: string[], elapsed: number): number {
  if (words.length === 0) return -1;
  if (line.words.length === words.length) {
    let index = -1;
    for (let i = 0; i < line.words.length; i += 1) if (line.words[i].time <= elapsed) index = i;
    return index;
  }
  const weights = words.map((word) => Math.max(1, word.length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const progress = Math.min(1, Math.max(0, elapsed / Math.max(0.001, line.duration))) * total;
  let cursor = 0;
  for (let i = 0; i < weights.length; i += 1) {
    cursor += weights[i];
    if (progress < cursor) return i;
  }
  return words.length - 1;
}
