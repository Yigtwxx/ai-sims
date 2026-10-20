/**
 * Landing demo timing: aligns a transcript to a speech recording without TTS
 * timing data. Sentence boundaries are snapped to the longest silences found
 * in the audio envelope; inside a sentence, time is shared out by syllable
 * count (in Turkish, one syllable per vowel), and inside a word by letter, so
 * each letter maps to an Oculus viseme. This is a visual approximation for the
 * landing page only; the product's lip-sync uses TTS viseme and word events.
 */

export const VISEMES = [
  'sil',
  'PP',
  'FF',
  'TH',
  'DD',
  'kk',
  'CH',
  'SS',
  'nn',
  'RR',
  'aa',
  'E',
  'I',
  'O',
  'U',
] as const;
export type VisemeId = (typeof VISEMES)[number];

export interface TimedViseme {
  id: VisemeId;
  start: number;
  end: number;
}

export interface TimedWord {
  /** The word as written, punctuation included. */
  text: string;
  start: number;
  end: number;
  visemes: TimedViseme[];
}

export interface SpeechSpan {
  start: number;
  end: number;
}

const VOWELS = new Set('aeıioöuüâîû');

const LETTER_VISEMES: Record<string, VisemeId> = {
  a: 'aa',
  â: 'aa',
  e: 'E',
  ı: 'I',
  i: 'I',
  î: 'I',
  y: 'I',
  o: 'O',
  ö: 'O',
  u: 'U',
  ü: 'U',
  û: 'U',
  b: 'PP',
  p: 'PP',
  m: 'PP',
  f: 'FF',
  v: 'FF',
  t: 'DD',
  d: 'DD',
  k: 'kk',
  g: 'kk',
  ğ: 'kk',
  h: 'kk',
  c: 'CH',
  ç: 'CH',
  ş: 'CH',
  j: 'CH',
  s: 'SS',
  z: 'SS',
  n: 'nn',
  l: 'nn',
  r: 'RR',
};

const lower = (text: string) => text.toLocaleLowerCase('tr-TR');
const letters = (word: string) => [...lower(word)].filter((ch) => /\p{L}/u.test(ch));

/** Viseme for one letter (Turkish orthography is close to phonemic). */
export function letterViseme(letter: string): VisemeId {
  return LETTER_VISEMES[lower(letter)] ?? 'sil';
}

/** Syllables in a Turkish word: one per vowel, at least one. */
export function syllableCount(word: string): number {
  return Math.max(1, letters(word).filter((ch) => VOWELS.has(ch)).length);
}

/** Splits a transcript into sentences, keeping their punctuation. */
export function splitSentences(transcript: string): string[] {
  return (transcript.trim().match(/[^.!?]+[.!?]*/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/** Letter-level visemes for a word spread over [start, end], identical neighbours merged. */
export function wordVisemes(word: string, start: number, end: number): TimedViseme[] {
  const chars = letters(word);
  if (chars.length === 0) return [];
  const weights = chars.map((ch) => (VOWELS.has(ch) ? 1.4 : 0.8));
  const total = weights.reduce((sum, w) => sum + w, 0);
  const result: TimedViseme[] = [];
  let cursor = start;
  chars.forEach((ch, index) => {
    const span = ((end - start) * weights[index]) / total;
    const id = letterViseme(ch);
    const last = result[result.length - 1];
    if (last && last.id === id) last.end = cursor + span;
    else result.push({ id, start: cursor, end: cursor + span });
    cursor += span;
  });
  return result;
}

/** Shares a sentence's span across its words by syllable count, with a short tail for punctuation. */
function timeSentence(sentence: string, span: SpeechSpan): TimedWord[] {
  const words = sentence.split(/\s+/).filter(Boolean);
  const weights = words.map((word, index) => {
    const tail = index < words.length - 1 && /[,;:]$/.test(word) ? 0.5 : 0;
    return syllableCount(word) + tail;
  });
  const total = weights.reduce((sum, w) => sum + w, 0);
  const result: TimedWord[] = [];
  let cursor = span.start;
  words.forEach((word, index) => {
    const share = ((span.end - span.start) * weights[index]) / total;
    const tail = weights[index] - syllableCount(word);
    const wordEnd = cursor + share * (1 - tail / weights[index]);
    result.push({
      text: word,
      start: cursor,
      end: wordEnd,
      visemes: wordVisemes(word, cursor, wordEnd),
    });
    cursor += share;
  });
  return result;
}

/**
 * Times every word of the transcript. `pauses` are silent gaps inside the
 * speech span; the longest `sentences - 1` of them become sentence breaks.
 * Without enough pauses, sentences share the span by syllables.
 */
export function buildTimeline(
  transcript: string,
  speech: SpeechSpan,
  pauses: readonly SpeechSpan[] = [],
): TimedWord[] {
  const sentences = splitSentences(transcript);
  if (sentences.length === 0 || speech.end <= speech.start) return [];

  const breaks = [...pauses]
    .filter((pause) => pause.start > speech.start && pause.end < speech.end)
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, sentences.length - 1)
    .sort((a, b) => a.start - b.start);

  let spans: SpeechSpan[];
  if (breaks.length === sentences.length - 1) {
    spans = sentences.map((_, index) => ({
      start: index === 0 ? speech.start : breaks[index - 1].end,
      end: index === sentences.length - 1 ? speech.end : breaks[index].start,
    }));
  } else {
    const weights = sentences.map((sentence) =>
      sentence.split(/\s+/).reduce((sum, word) => sum + syllableCount(word), 0),
    );
    const total = weights.reduce((sum, w) => sum + w, 0);
    let cursor = speech.start;
    spans = weights.map((weight) => {
      const span = { start: cursor, end: cursor + ((speech.end - speech.start) * weight) / total };
      cursor = span.end;
      return span;
    });
  }

  return sentences.flatMap((sentence, index) => timeSentence(sentence, spans[index]));
}

/** RMS loudness per frame of `frameSeconds`. */
export function envelope(samples: Float32Array, sampleRate: number, frameSeconds = 0.02): number[] {
  const size = Math.max(1, Math.round(sampleRate * frameSeconds));
  const frames: number[] = [];
  for (let offset = 0; offset < samples.length; offset += size) {
    let sum = 0;
    const end = Math.min(samples.length, offset + size);
    for (let i = offset; i < end; i += 1) sum += samples[i] * samples[i];
    frames.push(Math.sqrt(sum / (end - offset)));
  }
  return frames;
}

export interface SpeechAnalysis {
  speech: SpeechSpan;
  pauses: SpeechSpan[];
  duration: number;
}

/** Finds where speech starts and ends, and the silent gaps in between. */
export function analyseSpeech(
  frames: readonly number[],
  frameSeconds = 0.02,
  minPauseSeconds = 0.16,
): SpeechAnalysis {
  const duration = frames.length * frameSeconds;
  const peak = frames.reduce((max, value) => Math.max(max, value), 0);
  const threshold = Math.max(0.008, peak * 0.1);
  const voiced = frames.map((value) => value > threshold);
  const first = voiced.indexOf(true);
  const last = voiced.lastIndexOf(true);
  if (first < 0) return { speech: { start: 0, end: duration }, pauses: [], duration };

  const pauses: SpeechSpan[] = [];
  let gapStart = -1;
  for (let i = first; i <= last; i += 1) {
    if (!voiced[i] && gapStart < 0) gapStart = i;
    if (voiced[i] && gapStart >= 0) {
      if ((i - gapStart) * frameSeconds >= minPauseSeconds) {
        pauses.push({ start: gapStart * frameSeconds, end: i * frameSeconds });
      }
      gapStart = -1;
    }
  }
  return {
    speech: { start: first * frameSeconds, end: (last + 1) * frameSeconds },
    pauses,
    duration,
  };
}

/** Normalised loudness per bar (0 to 1) for drawing a waveform. */
export function waveformPeaks(frames: readonly number[], bars: number): number[] {
  if (frames.length === 0 || bars <= 0) return [];
  const peaks: number[] = [];
  for (let bar = 0; bar < bars; bar += 1) {
    const from = Math.floor((bar / bars) * frames.length);
    const to = Math.max(from + 1, Math.floor(((bar + 1) / bars) * frames.length));
    let max = 0;
    for (let i = from; i < to && i < frames.length; i += 1) max = Math.max(max, frames[i]);
    peaks.push(max);
  }
  const top = Math.max(...peaks, 1e-6);
  return peaks.map((value) => (value / top) ** 0.8);
}

/** Index of the item whose [start, end) contains `time`, or the last one started. -1 before the first. */
export function indexAt(items: readonly { start: number; end: number }[], time: number): number {
  let low = 0;
  let high = items.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (items[mid].start <= time) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}
