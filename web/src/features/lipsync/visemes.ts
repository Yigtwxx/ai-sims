/**
 * Canonical viseme set: the 15 Oculus/Meta visemes. Speech sources (our
 * Turkish rules, Azure TTS viseme IDs) produce these; renderers map them to
 * the model's viseme morph targets.
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

export type Viseme = (typeof VISEMES)[number];

export type VisemeWeights = Partial<Record<Viseme, number>>;

/** Morph target name of a viseme in the converted heads (e.g. "viseme_aa"). */
export function visemeMorphName(viseme: Viseme): string {
  return `viseme_${viseme}`;
}
