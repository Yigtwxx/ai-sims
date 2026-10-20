import type { Viseme } from './visemes';

/**
 * Turkish text -> viseme sequence. Turkish spelling is almost phonemic, so a
 * letter-level rule table gives good lip shapes without a phonemizer.
 */

export interface VisemeSegment {
  viseme: Viseme;
  /** Relative duration; scaled to real time by the timeline. */
  weight: number;
}

const VOWEL_WEIGHT = 1;
const CONSONANT_WEIGHT = 0.6;
// Lip closure must stay on screen long enough to be seen.
const BILABIAL_WEIGHT = 0.75;
const WORD_GAP_WEIGHT = 0.15;
const COMMA_PAUSE_WEIGHT = 1.4;
const SENTENCE_PAUSE_WEIGHT = 2.6;
// Soft g (ğ) is silent and lengthens the previous vowel.
const SOFT_G_EXTENSION = 0.8;

const LETTER_VISEMES: Record<string, [Viseme, number]> = {
  a: ['aa', VOWEL_WEIGHT],
  e: ['E', VOWEL_WEIGHT],
  ı: ['I', VOWEL_WEIGHT],
  i: ['I', VOWEL_WEIGHT],
  o: ['O', VOWEL_WEIGHT],
  ö: ['O', VOWEL_WEIGHT],
  u: ['U', VOWEL_WEIGHT],
  ü: ['U', VOWEL_WEIGHT],
  â: ['aa', VOWEL_WEIGHT],
  î: ['I', VOWEL_WEIGHT],
  û: ['U', VOWEL_WEIGHT],
  m: ['PP', BILABIAL_WEIGHT],
  b: ['PP', BILABIAL_WEIGHT],
  p: ['PP', BILABIAL_WEIGHT],
  f: ['FF', CONSONANT_WEIGHT],
  v: ['FF', CONSONANT_WEIGHT],
  t: ['DD', CONSONANT_WEIGHT],
  d: ['DD', CONSONANT_WEIGHT],
  n: ['nn', CONSONANT_WEIGHT],
  l: ['nn', CONSONANT_WEIGHT],
  r: ['RR', CONSONANT_WEIGHT],
  s: ['SS', CONSONANT_WEIGHT],
  z: ['SS', CONSONANT_WEIGHT],
  ş: ['CH', CONSONANT_WEIGHT],
  ç: ['CH', CONSONANT_WEIGHT],
  c: ['CH', CONSONANT_WEIGHT],
  j: ['CH', CONSONANT_WEIGHT],
  k: ['kk', CONSONANT_WEIGHT],
  g: ['kk', CONSONANT_WEIGHT],
  h: ['kk', CONSONANT_WEIGHT * 0.8],
  y: ['I', CONSONANT_WEIGHT * 0.7],
  // Loanword letters.
  q: ['kk', CONSONANT_WEIGHT],
  w: ['U', CONSONANT_WEIGHT],
  x: ['kk', CONSONANT_WEIGHT],
};

const SENTENCE_END = /[.!?…]/;
const CLAUSE_BREAK = /[,;:—–-]/;

/** Lowercase with Turkish rules (I -> ı, İ -> i). */
export function normalizeTurkish(text: string): string {
  return text.toLocaleLowerCase('tr-TR').normalize('NFC');
}

export function textToVisemes(text: string): VisemeSegment[] {
  const segments: VisemeSegment[] = [];
  const push = (viseme: Viseme, weight: number) => {
    const last = segments.at(-1);
    // Merge repeated silences and doubled letters ("dikkat") into one longer hold.
    if (last && last.viseme === viseme) last.weight += weight * 0.6;
    else segments.push({ viseme, weight });
  };

  for (const char of normalizeTurkish(text)) {
    if (char === 'ğ') {
      const last = segments.at(-1);
      if (last && last.viseme !== 'sil') last.weight += SOFT_G_EXTENSION;
      continue;
    }
    const mapped = LETTER_VISEMES[char];
    if (mapped) push(mapped[0], mapped[1]);
    else if (SENTENCE_END.test(char)) push('sil', SENTENCE_PAUSE_WEIGHT);
    else if (CLAUSE_BREAK.test(char)) push('sil', COMMA_PAUSE_WEIGHT);
    else if (/\s/.test(char)) push('sil', WORD_GAP_WEIGHT);
    // Digits and symbols are expected to be spelled out before TTS.
  }

  while (segments[0]?.viseme === 'sil') segments.shift();
  while (segments.at(-1)?.viseme === 'sil') segments.pop();
  return segments;
}
