import { alignTextToAudio, estimateAudioLag, shiftTimeline, snapClosuresToAudio } from './align';
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
/**
 * How far the mouth runs ahead of the heard audio (seconds). Budget: the mouth
 * driver's smoothing reaches a closure ~15 ms late and a frame reaches the
 * screen ~25 ms after it is sampled; on top of that lips should lead the sound
 * by ~35 ms, as they do in real speech. Replays of recorded TTS speech put the
 * seen closures 30-40 ms ahead of the heard ones with this value. It is measured
 * from the decoded audio, so every timing source is shifted onto that first.
 */
export const VISUAL_LEAD = 0.07;

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
    // TTS timings are reported against the synthesized audio and may sit ahead of
    // the decoded MP3; the audio says where the speech really is.
    const estimated =
      'events' in script
        ? timelineFromEvents(script.events, buffer.duration)
        : 'words' in script
          ? timelineFromWords(script.words)
          : alignTextToAudio(script.text, detectSpeechRegions(this.envelope), buffer.duration);
    const shifted = shiftTimeline(estimated, estimateAudioLag(estimated, this.envelope));
    // Viseme events time each closure; word and text timings place letters evenly,
    // so their closures move onto the audio's own.
    this.timeline = 'events' in script ? shifted : snapClosuresToAudio(shifted, this.envelope);
  }

  /**
   * Call synchronously inside the user's gesture (the click or Enter that asks
   * for a reply). Safari keeps a context that is created or resumed outside a
   * gesture suspended, so speech arriving seconds later never played and
   * `play()` waited on `resume()` forever. A one-frame silent buffer started
   * here also unlocks iOS.
   */
  unlock(): void {
    const context = this.getContext();
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
    const silence = context.createBufferSource();
    silence.buffer = context.createBuffer(1, 1, context.sampleRate);
    silence.connect(context.destination);
    silence.start();
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

  constructor(private readonly visualLead = VISUAL_LEAD) {}

  /** Loudness 0..1 of what is heard right now (0 when silent); drives head emphasis. */
  loudness(): number {
    if (!this.source || !this.envelope) return 0;
    const t = this.heardTime();
    if (t < 0 || t > this.duration) return 0;
    return Math.min(1, sampleEnvelope(this.envelope, t) * 1.8);
  }

  /** Viseme weights for the current frame (empty when silent), `visualLead` ahead of the audio. */
  sample(): VisemeWeights {
    if (!this.source || !this.envelope) return {};
    const heard = this.heardTime();
    if (heard < 0) return {};
    const t = heard + this.visualLead;
    if (t > this.duration) return {};
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
