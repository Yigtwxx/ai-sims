/**
 * Canonical viseme set: the 15 Oculus/Meta visemes. Speech sources (our
 * Turkish rules, Azure TTS viseme IDs) produce these; renderers map them to
 * whatever mouth controls a model has (VRM vowels, MPFB viseme morphs).
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

/** Mouth controls of a VRM model: the five vowel expressions plus lip closure. */
export type VrmMouthControl = 'aa' | 'ih' | 'ou' | 'ee' | 'oh' | 'close';

export type VrmMouthWeights = Record<VrmMouthControl, number>;

/**
 * How each viseme is approximated with VRM controls. Anime faces only have
 * vowel shapes, so consonants borrow partial vowels; bilabials (PP) get a full
 * lip closure because a mouth that never closes on m/b/p reads as fake.
 */
export const VRM_VISEME_MAP: Record<Viseme, Partial<VrmMouthWeights>> = {
  sil: {},
  PP: { close: 1 },
  FF: { ih: 0.2, close: 0.55 },
  TH: { ih: 0.3, aa: 0.1 },
  DD: { ih: 0.3, aa: 0.15 },
  kk: { aa: 0.3, ih: 0.1 },
  CH: { ou: 0.4, ih: 0.25 },
  SS: { ih: 0.45 },
  nn: { ih: 0.25, aa: 0.1 },
  RR: { aa: 0.25, ou: 0.15 },
  aa: { aa: 1 },
  E: { ee: 0.9, aa: 0.15 },
  I: { ih: 0.9 },
  O: { oh: 1 },
  U: { ou: 1 },
};

export function emptyVrmMouth(): VrmMouthWeights {
  return { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0, close: 0 };
}

/** Collapse viseme weights into VRM mouth controls (each clamped to 0..1). */
export function toVrmMouth(weights: VisemeWeights): VrmMouthWeights {
  const out = emptyVrmMouth();
  for (const [viseme, weight] of Object.entries(weights) as [Viseme, number][]) {
    if (!weight) continue;
    for (const [control, amount] of Object.entries(VRM_VISEME_MAP[viseme]) as [
      VrmMouthControl,
      number,
    ][]) {
      out[control] = Math.min(1, out[control] + amount * weight);
    }
  }
  return out;
}

/** MPFB / Oculus morph target name for a viseme (e.g. "viseme_aa"). */
export function mpfbMorphName(viseme: Viseme): string {
  return `viseme_${viseme}`;
}
