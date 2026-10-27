import { describe, expect, it } from 'vitest';

import {
  activeChapter,
  approach,
  CHAPTERS,
  chapterLook,
  LAST_STAGE,
  progressForStage,
  stageAt,
} from './story';

describe('stageAt', () => {
  it('starts as scattered dust and ends on the silhouette', () => {
    expect(stageAt(0)).toBe(0);
    expect(stageAt(1)).toBe(LAST_STAGE);
  });

  it('holds the dust for the first bit of scrolling', () => {
    expect(stageAt(0.03)).toBe(0);
  });

  it('never decreases as the page scrolls', () => {
    let previous = -1;
    for (let i = 0; i <= 1000; i++) {
      const stage = stageAt(i / 1000);
      expect(stage).toBeGreaterThanOrEqual(previous);
      previous = stage;
    }
  });

  it('clamps progress outside 0..1', () => {
    expect(stageAt(-0.5)).toBe(0);
    expect(stageAt(2)).toBe(LAST_STAGE);
  });

  it('reaches the silhouette before the end and keeps it', () => {
    expect(stageAt(0.95)).toBe(LAST_STAGE);
  });
});

describe('progressForStage', () => {
  it('lands every jump on a whole, holding shape', () => {
    for (let stage = 0; stage <= LAST_STAGE; stage++) {
      expect(stageAt(progressForStage(stage))).toBeCloseTo(stage, 6);
    }
  });
});

describe('chapterLook', () => {
  it('shows the first chapter over both the dust and the sphere', () => {
    expect(chapterLook(0, 0).opacity).toBe(1);
    expect(chapterLook(0, 1).opacity).toBe(1);
    expect(chapterLook(0, 2).opacity).toBe(0);
  });

  it('keeps the last chapter once the silhouette is reached', () => {
    expect(chapterLook(CHAPTERS.length - 1, LAST_STAGE)).toEqual({ opacity: 1, offset: 0 });
  });

  it('shows one chapter at a time on whole stages', () => {
    for (let stage = 1; stage <= LAST_STAGE; stage++) {
      const visible = CHAPTERS.filter((_, i) => chapterLook(i, stage).opacity > 0);
      expect(visible).toHaveLength(1);
    }
  });
});

describe('activeChapter', () => {
  it('follows the stages', () => {
    expect(activeChapter(0)).toBe(0);
    expect(activeChapter(1)).toBe(0);
    expect(activeChapter(2)).toBe(1);
    expect(activeChapter(LAST_STAGE)).toBe(CHAPTERS.length - 1);
  });
});

describe('approach', () => {
  it('is frame-rate independent', () => {
    let fast = 0;
    for (let i = 0; i < 120; i++) fast = approach(fast, 1, 10, 1 / 120);
    let slow = 0;
    for (let i = 0; i < 30; i++) slow = approach(slow, 1, 10, 1 / 30);
    expect(fast).toBeCloseTo(slow, 6);
  });
});
