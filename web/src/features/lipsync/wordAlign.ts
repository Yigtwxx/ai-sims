import { buildTimeline, type TimedViseme } from './timeline';
import { textToVisemes } from './turkish';

/**
 * Word-level alignment: TTS engines report when each word starts and how long
 * it lasts. Each word is expanded into letter-level visemes with the Turkish
 * rules and stretched over exactly its own interval, which keeps the mouth
 * locked to the audio even where the voice speeds up or slows down. Used when
 * the voice has word boundaries but no viseme events.
 */

/** Word boundary as returned by `POST /api/tts`; all values in seconds. */
export interface WordBoundary {
  time: number;
  duration: number;
  text: string;
}

/** Pauses up to this long between two words are closed up; longer ones stay silent. */
const BRIDGE_GAP = 0.05;
/** Words shorter than this cannot show a mouth shape and are skipped. */
const MIN_WORD_DURATION = 0.01;

function isUsable(word: WordBoundary): boolean {
  return (
    typeof word.text === 'string' &&
    Number.isFinite(word.time) &&
    word.time >= 0 &&
    Number.isFinite(word.duration) &&
    word.duration >= MIN_WORD_DURATION
  );
}

/**
 * Builds an absolute-time viseme timeline from word boundaries.
 *
 * - Every word is stretched over [time, time + duration].
 * - A real pause between words becomes an explicit silent segment. Without it
 *   the timeline's cross-fade would blend the last shape of the previous word
 *   into the first frames of the next one, right after the mouth had closed.
 * - Tiny gaps (TTS word intervals rarely tile perfectly) are bridged so the
 *   mouth does not flutter between words.
 * - Overlapping words are trimmed, and boundaries with nothing to say
 *   (punctuation, digits) are ignored. Input order does not matter.
 */
export function timelineFromWords(words: readonly WordBoundary[]): TimedViseme[] {
  const timeline: TimedViseme[] = [];

  for (const word of words.filter(isUsable).sort((a, b) => a.time - b.time)) {
    const previous = timeline.at(-1);
    const start = Math.max(word.time, previous?.end ?? 0);
    const end = word.time + word.duration;
    if (end - start < MIN_WORD_DURATION) continue;

    const segments = textToVisemes(word.text);
    if (segments.length === 0) continue;

    if (previous) {
      const gap = start - previous.end;
      if (gap > BRIDGE_GAP) timeline.push({ viseme: 'sil', start: previous.end, end: start });
      else if (gap > 0) previous.end = start;
    }
    timeline.push(...buildTimeline(segments, end, { leadIn: start }));
  }
  return timeline;
}
