/**
 * The landing story as pure functions of scroll progress. Shapes, in order:
 * scattered dust, a sphere, a sound wave, the ring of 15 visemes, speaking
 * lips and, last, a human silhouette that stays (it never scatters again).
 */
export const SHAPES = ['dust', 'sphere', 'wave', 'ring', 'lips', 'silhouette'] as const;
export type Shape = (typeof SHAPES)[number];

/** Index of the last shape; the stage value runs from 0 to this. */
export const LAST_STAGE = SHAPES.length - 1;

/** Chapters of copy. The first one covers both the dust and the sphere. */
export const CHAPTERS = ['idea', 'voice', 'viseme', 'lips', 'start'] as const;
export type Chapter = (typeof CHAPTERS)[number];

/**
 * Share of each segment the shape holds still before morphing, and the share
 * spent morphing. What is left after `HOLD + MORPH` holds the next shape.
 */
const HOLD = 0.25;
const MORPH = 0.5;
/** Extra segment at the end so the silhouette is complete before the page ends. */
const TAIL = 0.5;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smoothstep = (value: number) => value * value * (3 - 2 * value);

/**
 * Scroll progress (0..1) to a continuous stage (0..LAST_STAGE): integer values
 * are whole shapes, fractions are morphs between neighbours.
 */
export function stageAt(progress: number): number {
  const raw = clamp01(progress) * (LAST_STAGE + TAIL);
  const segment = Math.floor(raw);
  if (segment >= LAST_STAGE) return LAST_STAGE;
  const within = raw - segment;
  return segment + smoothstep(clamp01((within - HOLD) / MORPH));
}

/**
 * Progress in the middle of a whole stage's hold (for jump links). A stage
 * holds from late in the segment before it to early in its own, so the middle
 * is the segment boundary; the last stage holds to the end of the page.
 */
export function progressForStage(stage: number): number {
  const target = Math.min(LAST_STAGE, Math.max(0, Math.round(stage)));
  if (target === LAST_STAGE) return 1;
  return target / (LAST_STAGE + TAIL);
}

/** The stage a chapter's copy is centred on. The first chapter spans dust and sphere. */
export function chapterStage(chapter: number): number {
  return chapter === 0 ? 1 : chapter + 1;
}

/** How fast copy fades as the stage leaves its centre (1 / 2.2 stages to zero). */
const FADE = 2.2;
/** Copy slides this far (px) per stage of distance from its centre. */
const SLIDE = 48;

export interface ChapterLook {
  opacity: number;
  /** Vertical offset in px: positive below its rest position. */
  offset: number;
}

/** Opacity and offset of a chapter's copy at a stage value. */
export function chapterLook(chapter: number, stage: number): ChapterLook {
  const centre = chapterStage(chapter);
  let distance = stage - centre;
  // The first chapter stays put over the dust as well as the sphere.
  if (chapter === 0 && distance < 0) distance = 0;
  // The last one stays once reached.
  if (chapter === CHAPTERS.length - 1 && distance > 0) distance = 0;
  return {
    opacity: Math.max(0, 1 - Math.abs(distance) * FADE),
    offset: 0 - distance * SLIDE,
  };
}

/** The chapter whose copy is most visible at a stage value. */
export function activeChapter(stage: number): number {
  let best = 0;
  let bestOpacity = -1;
  for (let i = 0; i < CHAPTERS.length; i++) {
    const { opacity } = chapterLook(i, stage);
    if (opacity > bestOpacity) {
      best = i;
      bestOpacity = opacity;
    }
  }
  return best;
}

/**
 * Frame-rate independent approach of `current` to `target` (critically damped
 * feel without overshoot). `rate` is per second; ~10 settles in ~0.4 s.
 */
export function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}
