import { sampleEnvelope, type Envelope, type SpeechRegion } from './envelope';
import { buildTimeline, type TimedViseme } from './timeline';
import { textToVisemes } from './turkish';
import type { Viseme } from './visemes';

/**
 * Phrase-level alignment: TTS engines pause at punctuation, so each text
 * phrase is fitted into its own detected speech region. This keeps the mouth
 * in sync across long answers instead of drifting with a single global stretch.
 */

/** Split at punctuation that produces an audible pause. */
export function splitPhrases(text: string): string[] {
  return text
    .split(/(?<=[.!?…,;:])\s+/)
    .map((p) => p.trim())
    .filter((p) => textToVisemes(p).length > 0);
}

/** Merge the regions separated by the shortest gaps until `count` remain. */
export function mergeRegionsTo(regions: SpeechRegion[], count: number): SpeechRegion[] {
  const out = regions.map((r) => ({ ...r }));
  while (out.length > count && out.length > 1) {
    let best = 0;
    for (let i = 1; i < out.length - 1; i++) {
      if (out[i + 1].start - out[i].end < out[best + 1].start - out[best].end) best = i;
    }
    out.splice(best, 2, { start: out[best].start, end: out[best + 1].end });
  }
  return out;
}

export function alignTextToAudio(
  text: string,
  regions: SpeechRegion[],
  audioDuration: number,
): TimedViseme[] {
  const phrases = splitPhrases(text);
  if (phrases.length === 0) return [];

  // No usable regions: stretch the whole text over the whole clip.
  if (regions.length === 0) return buildTimeline(textToVisemes(text), audioDuration);

  // More pauses in audio than in text: bridge the shortest gaps.
  // Fewer pauses than phrases: the TTS ran phrases together, so align as one block.
  const fitted =
    regions.length >= phrases.length ? mergeRegionsTo(regions, phrases.length) : undefined;
  if (!fitted) {
    const span = { start: regions[0].start, end: regions.at(-1)!.end };
    return buildTimeline(textToVisemes(text), audioDuration, {
      leadIn: span.start,
      tail: audioDuration - span.end,
    });
  }

  return phrases.flatMap((phrase, i) => {
    const region = fitted[i];
    return buildTimeline(textToVisemes(phrase), region.end, { leadIn: region.start });
  });
}

/** Rough loudness of each mouth shape, for matching a timeline against the audio. */
const SHAPE_LOUDNESS: Record<Viseme, number> = {
  sil: 0,
  PP: 0.05,
  FF: 0.3,
  TH: 0.3,
  SS: 0.3,
  CH: 0.3,
  kk: 0.35,
  DD: 0.4,
  nn: 0.6,
  RR: 0.6,
  I: 0.9,
  U: 0.9,
  aa: 1,
  E: 1,
  O: 1,
};
const LAG_RANGE = { min: -0.05, max: 0.2 };
const LAG_STEP = 0.005;
const LAG_SAMPLE = 0.01;
/** The best lag must beat no shift by this much correlation to be applied. */
const LAG_MIN_GAIN = 0.05;

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

/**
 * How far the audio runs behind the timeline (seconds): the shift that best
 * lines the timeline's loud and quiet shapes up with the audio's loudness.
 * TTS word boundaries are reported against the synthesized audio, but the
 * decoded MP3 starts later (encoder and decoder delay, ~60 ms for Edge voices).
 * 0 when no shift clearly fits better.
 */
export function estimateAudioLag(timeline: TimedViseme[], envelope: Envelope): number {
  if (timeline.length === 0) return 0;
  // Compare only where every candidate lag still lands inside the audio: past its
  // ends the envelope reads silent, which a closure or pause there would match.
  const start = Math.max(timeline[0].start, -LAG_RANGE.min);
  const end = Math.min(
    timeline.at(-1)!.end,
    envelope.values.length / envelope.rate - LAG_RANGE.max,
  );
  const shapes: number[] = [];
  const times: number[] = [];
  let index = 0;
  for (let t = start; t < end; t += LAG_SAMPLE) {
    while (index < timeline.length - 1 && t >= timeline[index].end) index++;
    const segment = timeline[index];
    shapes.push(t >= segment.start && t < segment.end ? SHAPE_LOUDNESS[segment.viseme] : 0);
    times.push(t);
  }
  if (shapes.length < 10) return 0;
  const fit = (lag: number) =>
    pearson(
      shapes,
      times.map((t) => sampleEnvelope(envelope, t + lag)),
    );
  let best = 0;
  let bestFit = fit(0);
  const unshifted = bestFit;
  for (let lag = LAG_RANGE.min; lag <= LAG_RANGE.max + 1e-9; lag += LAG_STEP) {
    const value = fit(lag);
    if (value > bestFit) [best, bestFit] = [lag, value];
  }
  return bestFit - unshifted >= LAG_MIN_GAIN ? best : 0;
}

/** The timeline moved later by `lag` seconds. */
export function shiftTimeline(timeline: TimedViseme[], lag: number): TimedViseme[] {
  if (lag === 0) return timeline;
  return timeline.map((s) => ({ ...s, start: s.start + lag, end: s.end + lag }));
}

/** How far a lip closure may move to meet the closure heard in the audio (seconds). */
const SNAP_RANGE = 0.1;
/** A dip counts when it is at most this fraction of the loudest point around it. */
const DIP_RATIO = 0.5;
/** Loudness within this of a stretch's quietest point counts as its quiet core. */
const DIP_TOLERANCE = 0.05;
/** The shapes on either side keep at least this long (seconds). */
const MIN_NEIGHBOUR = 0.025;
const SNAP_STEP = 0.005;

/**
 * Moves each m/b/p inside running speech onto the audio's own closure: the
 * lips meet where the sound drops out, and a word's letters are spread evenly
 * over its duration, which misses that point by up to ~90 ms. The nearest
 * clear loudness dip within SNAP_RANGE wins; a closure next to a pause, or
 * with no clear dip around it (a soft m), stays where it was.
 */
export function snapClosuresToAudio(timeline: TimedViseme[], envelope: Envelope): TimedViseme[] {
  const out = timeline.map((segment) => ({ ...segment }));
  for (let i = 1; i < out.length - 1; i++) {
    const [prev, closure, next] = [out[i - 1], out[i], out[i + 1]];
    if (closure.viseme !== 'PP' || prev.viseme === 'sil' || next.viseme === 'sil') continue;
    if (prev.end !== closure.start || next.start !== closure.end) continue;
    const half = (closure.end - closure.start) / 2;
    const mid = closure.start + half;
    const lo = Math.max(mid - SNAP_RANGE, prev.start + MIN_NEIGHBOUR + half);
    const hi = Math.min(mid + SNAP_RANGE, next.end - MIN_NEIGHBOUR - half);
    if (hi <= lo) continue;

    const samples: { t: number; v: number }[] = [];
    for (let t = mid - SNAP_RANGE; t <= mid + SNAP_RANGE + 1e-9; t += SNAP_STEP) {
      samples.push({ t, v: sampleEnvelope(envelope, t) });
    }
    // Quiet stretches (a stop's silence lasts 50-80 ms); each one's target is the
    // middle of its quietest part, where the lips are fully shut.
    const threshold = Math.max(...samples.map((s) => s.v)) * DIP_RATIO;
    let best: number | undefined;
    for (let k = 0; k < samples.length; k++) {
      if (samples[k].v > threshold) continue;
      let last = k;
      while (last + 1 < samples.length && samples[last + 1].v <= threshold) last++;
      const run = samples.slice(k, last + 1);
      const floor = Math.min(...run.map((s) => s.v)) + DIP_TOLERANCE;
      const quiet = run.filter((s) => s.v <= floor);
      const target = (quiet[0].t + quiet.at(-1)!.t) / 2;
      const inRange = target >= lo && target <= hi;
      if (inRange && (best === undefined || Math.abs(target - mid) < Math.abs(best - mid))) {
        best = target;
      }
      k = last;
    }
    if (best === undefined) continue;
    const shift = best - mid;
    closure.start += shift;
    closure.end += shift;
    prev.end = closure.start;
    next.start = closure.end;
  }
  return out;
}
