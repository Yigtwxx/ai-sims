import type { SpeechRegion } from './envelope';
import { buildTimeline, type TimedViseme } from './timeline';
import { textToVisemes } from './turkish';

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
