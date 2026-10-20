import { alignTextToAudio } from './align';
import { computeEnvelope, detectSpeechRegions, sampleEnvelope, type Envelope } from './envelope';
import { sampleTimeline, scaleWeights, timelineFromEvents, type TimedViseme } from './timeline';
import type { Viseme, VisemeWeights } from './visemes';
import { timelineFromWords, type WordBoundary } from './wordAlign';

/**
 * Plays a speech clip and reports the mouth shape for "what the listener hears
 * right now". Timing comes from exact TTS viseme events, else TTS word
 * boundaries, else our Turkish text rules aligned to the audio's pauses;
 * loudness modulates how wide the mouth opens.
 */
export class SpeechPlayer {
  private context: AudioContext | undefined;
  private source: AudioBufferSourceNode | undefined;
  private buffer: AudioBuffer | undefined;
  private envelope: Envelope | undefined;
  private timeline: TimedViseme[] = [];
  private startedAt = 0;
  private onEnded: (() => void) | undefined;

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  get isPlaying(): boolean {
    return this.source !== undefined;
  }

  private getContext(): AudioContext {
    this.context ??= new AudioContext();
    return this.context;
  }

  /**
   * Decode audio and prepare its viseme timeline. Pass `events` when the TTS
   * provides viseme timings, else `words` when it provides word boundaries;
   * otherwise `text` is aligned to the audio. If several are given, that is
   * also the order of priority.
   */
  async load(
    audio: ArrayBuffer,
    script:
      { text: string } | { events: { viseme: Viseme; time: number }[] } | { words: WordBoundary[] },
  ): Promise<void> {
    this.stop();
    const buffer = await this.getContext().decodeAudioData(audio);
    const samples = buffer.getChannelData(0);
    this.buffer = buffer;
    this.envelope = computeEnvelope(samples, buffer.sampleRate);
    if ('events' in script) this.timeline = timelineFromEvents(script.events, buffer.duration);
    else if ('words' in script) this.timeline = timelineFromWords(script.words);
    else {
      this.timeline = alignTextToAudio(
        script.text,
        detectSpeechRegions(this.envelope),
        buffer.duration,
      );
    }
  }

  async play(onEnded?: () => void): Promise<void> {
    if (!this.buffer) throw new Error('SpeechPlayer.play() called before load()');
    const context = this.getContext();
    // Browsers start AudioContexts suspended until a user gesture.
    if (context.state === 'suspended') await context.resume();
    this.stop();

    const source = context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(context.destination);
    source.onended = () => {
      if (this.source === source) this.source = undefined;
      this.onEnded?.();
    };
    this.onEnded = onEnded;
    this.source = source;
    this.startedAt = context.currentTime;
    source.start();
  }

  stop(): void {
    if (!this.source) return;
    const source = this.source;
    this.source = undefined;
    source.onended = null;
    source.stop();
  }

  /** Playback position as heard, compensating for output (speaker) latency. */
  private heardTime(): number {
    const context = this.context;
    if (!context) return -1;
    const stamp = context.getOutputTimestamp?.();
    const contextTime = stamp?.contextTime ?? context.currentTime - (context.outputLatency || 0);
    return contextTime - this.startedAt;
  }

  /** Viseme weights for the current frame (empty when silent). */
  sample(): VisemeWeights {
    if (!this.source || !this.envelope) return {};
    const t = this.heardTime();
    if (t < 0 || t > this.duration) return {};
    const loudness = sampleEnvelope(this.envelope, t);
    // Keep shapes readable in quiet passages; louder speech opens wider.
    const openness = 0.45 + 0.55 * Math.min(1, loudness * 1.8);
    return scaleWeights(sampleTimeline(this.timeline, t), openness);
  }

  async dispose(): Promise<void> {
    this.stop();
    await this.context?.close();
    this.context = undefined;
  }
}
