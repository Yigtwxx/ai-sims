/**
 * Loudness envelope and speech-region detection for TTS audio. Pure functions
 * over PCM samples so they run in tests, workers or the main thread.
 */

export interface Envelope {
  /** RMS per frame, normalized so the loudest frame is 1. */
  values: Float32Array;
  /** Frames per second. */
  rate: number;
}

export interface SpeechRegion {
  start: number;
  end: number;
}

/** RMS loudness at `rate` frames per second, normalized to 0..1. */
export function computeEnvelope(samples: Float32Array, sampleRate: number, rate = 100): Envelope {
  const frameSize = Math.max(1, Math.round(sampleRate / rate));
  const frames = Math.ceil(samples.length / frameSize);
  const values = new Float32Array(frames);
  let peak = 0;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const start = f * frameSize;
    const end = Math.min(start + frameSize, samples.length);
    for (let i = start; i < end; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / Math.max(1, end - start));
    values[f] = rms;
    if (rms > peak) peak = rms;
  }
  if (peak > 0) for (let f = 0; f < frames; f++) values[f] /= peak;
  return { values, rate };
}

/** Envelope value at time `t` (seconds), linearly interpolated. */
export function sampleEnvelope(envelope: Envelope, t: number): number {
  const x = t * envelope.rate;
  const i = Math.floor(x);
  if (i < 0 || i >= envelope.values.length) return 0;
  const a = envelope.values[i];
  const b = envelope.values[Math.min(i + 1, envelope.values.length - 1)];
  return a + (b - a) * (x - i);
}

export interface RegionOptions {
  /** Normalized loudness below which a frame counts as silent. */
  threshold: number;
  /** Silences shorter than this (seconds) are bridged, e.g. stop consonants. */
  minSilence: number;
  /** Regions shorter than this (seconds) are dropped as clicks/breaths. */
  minSpeech: number;
}

export const DEFAULT_REGION_OPTIONS: RegionOptions = {
  threshold: 0.06,
  minSilence: 0.18,
  minSpeech: 0.08,
};

/** Split audio into speech regions separated by pauses. */
export function detectSpeechRegions(
  envelope: Envelope,
  options: Partial<RegionOptions> = {},
): SpeechRegion[] {
  const { threshold, minSilence, minSpeech } = { ...DEFAULT_REGION_OPTIONS, ...options };
  const raw: SpeechRegion[] = [];
  let start = -1;
  for (let f = 0; f <= envelope.values.length; f++) {
    const loud = f < envelope.values.length && envelope.values[f] >= threshold;
    if (loud && start < 0) start = f;
    if (!loud && start >= 0) {
      raw.push({ start: start / envelope.rate, end: f / envelope.rate });
      start = -1;
    }
  }

  const merged: SpeechRegion[] = [];
  for (const region of raw) {
    const last = merged.at(-1);
    if (last && region.start - last.end < minSilence) last.end = region.end;
    else merged.push({ ...region });
  }
  return merged.filter((r) => r.end - r.start >= minSpeech);
}
