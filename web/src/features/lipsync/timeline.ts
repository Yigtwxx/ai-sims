import type { VisemeSegment } from './turkish';
import type { Viseme, VisemeWeights } from './visemes';

/**
 * Absolute-time viseme timeline with coarticulation: neighbouring shapes
 * cross-fade instead of snapping, and lip closures start slightly early, the
 * way real speech anticipates the next sound.
 */

export interface TimedViseme {
  viseme: Viseme;
  start: number;
  end: number;
}

export interface TimelineOptions {
  /** Silence before speech starts in the audio (seconds). */
  leadIn: number;
  /** Silence after speech ends in the audio (seconds). */
  tail: number;
  /** Max cross-fade on each side of a boundary (seconds). */
  blend: number;
  /** Bilabials (m/b/p) start closing this much earlier (seconds). */
  anticipation: number;
}

export const DEFAULT_TIMELINE_OPTIONS: TimelineOptions = {
  leadIn: 0,
  tail: 0,
  blend: 0.06,
  anticipation: 0.035,
};

/** Stretch relative segment weights over the spoken part of the audio. */
export function buildTimeline(
  segments: VisemeSegment[],
  audioDuration: number,
  options: Partial<TimelineOptions> = {},
): TimedViseme[] {
  const { leadIn, tail } = { ...DEFAULT_TIMELINE_OPTIONS, ...options };
  const spoken = Math.max(0, audioDuration - leadIn - tail);
  const total = segments.reduce((sum, s) => sum + s.weight, 0);
  if (!total || !spoken) return [];

  const scale = spoken / total;
  let cursor = leadIn;
  return segments.map(({ viseme, weight }) => {
    const start = cursor;
    cursor += weight * scale;
    return { viseme, start, end: cursor };
  });
}

/** Build a timeline from explicit timings (e.g. Azure TTS viseme events). */
export function timelineFromEvents(
  events: { viseme: Viseme; time: number }[],
  audioDuration: number,
): TimedViseme[] {
  return events.map((event, i) => ({
    viseme: event.viseme,
    start: event.time,
    end: events[i + 1]?.time ?? audioDuration,
  }));
}

function smoothstep(x: number): number {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
}

/** Binary search for the segment containing `t` (or -1). */
function findIndex(timeline: TimedViseme[], t: number): number {
  let lo = 0;
  let hi = timeline.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t < timeline[mid].start) hi = mid - 1;
    else if (t >= timeline[mid].end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/**
 * Viseme weights at time `t`. Each boundary cross-fades over up to `blend`
 * seconds (never more than 45% of either neighbour, so short sounds still
 * reach their target shape).
 */
export function sampleTimeline(
  timeline: TimedViseme[],
  t: number,
  options: Partial<TimelineOptions> = {},
): VisemeWeights {
  const { blend, anticipation } = { ...DEFAULT_TIMELINE_OPTIONS, ...options };
  const index = findIndex(timeline, t);
  if (index < 0) return {};

  const current = timeline[index];
  const weights: VisemeWeights = {};
  const add = (viseme: Viseme, amount: number) => {
    if (viseme === 'sil' || amount <= 0) return;
    weights[viseme] = (weights[viseme] ?? 0) + amount;
  };

  const duration = current.end - current.start;
  const prev = timeline[index - 1];
  const next = timeline[index + 1];

  let fromPrev = 0;
  if (prev) {
    const window = Math.min(blend, duration * 0.45, (prev.end - prev.start) * 0.45);
    if (window > 0) fromPrev = 1 - smoothstep((t - current.start) / window);
  }

  let toNext = 0;
  if (next) {
    const lead = next.viseme === 'PP' ? anticipation : 0;
    const window = Math.min(blend + lead, duration * 0.45, (next.end - next.start) * 0.45 + lead);
    if (window > 0) toNext = smoothstep((t - (current.end - window)) / window);
  }

  // Half of each transition belongs to the neighbour, half to the current shape.
  const prevShare = fromPrev * 0.5;
  const nextShare = toNext * 0.5;
  add(current.viseme, 1 - prevShare - nextShare);
  if (prev) add(prev.viseme, prevShare);
  if (next) add(next.viseme, nextShare);
  return weights;
}

/**
 * How strongly a closure's weight drives the lips. An m/b/p lasts 50-80 ms and
 * the cross-fades leave it at full weight only at its centre; boosted, the lips
 * meet for most of it (replays of recorded speech: closure 0.97 instead of 0.7).
 */
export const CLOSURE_GAIN = 1.8;

/** Scale all weights (e.g. by audio loudness); silence collapses the mouth. */
export function scaleWeights(weights: VisemeWeights, factor: number): VisemeWeights {
  const out: VisemeWeights = {};
  for (const [viseme, w] of Object.entries(weights) as [Viseme, number][]) {
    // Closures ignore loudness: quiet speech still closes the lips.
    out[viseme] = viseme === 'PP' ? Math.min(1, w * CLOSURE_GAIN) : w * factor;
  }
  return out;
}
