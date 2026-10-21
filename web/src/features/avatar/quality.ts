import { createContext, useContext } from 'react';

/**
 * Render quality tiers. `high` is the look the stage is tuned for (desktop GPU);
 * `balanced` trades pixel density and AO samples for frame rate; `battery`
 * (laptops off the charger, weak GPUs) drops AO, wears the lighter hair cards
 * and caps the stage at 30 fps. `auto` starts high, steps down to balanced
 * when the frame rate cannot keep up and back up once it recovers.
 */
export type RenderQuality = 'high' | 'balanced' | 'battery';
export type QualityPreference = RenderQuality | 'auto';

export interface QualitySettings {
  /** Device pixel ratio range handed to the canvas. */
  dpr: [number, number];
  /** N8AO preset, or null for no ambient occlusion. */
  ao: 'high' | 'medium' | null;
  /** Key light shadow map resolution. */
  shadowMapSize: number;
  /** Groom card level of detail: 0 the full cards, 1 the lighter set. */
  hairLod: 0 | 1;
  /** Frame cap, or null to render at the display rate. */
  maxFps: number | null;
}

export const QUALITY: Record<RenderQuality, QualitySettings> = {
  high: { dpr: [1, 2], ao: 'high', shadowMapSize: 2048, hairLod: 0, maxFps: null },
  balanced: { dpr: [1, 1.5], ao: 'medium', shadowMapSize: 1024, hairLod: 0, maxFps: null },
  battery: { dpr: [1, 1], ao: null, shadowMapSize: 1024, hairLod: 1, maxFps: 30 },
};

const ORDER: RenderQuality[] = ['high', 'balanced', 'battery'];

/** Lowest tier `auto` reaches; battery is only ever chosen explicitly. */
const AUTO_FLOOR = ORDER.indexOf('balanced');

/**
 * The tier `auto` moves to when the frame rate drops or recovers. It stops at
 * balanced: battery caps the stage at 30 fps, where the monitor can never see
 * a recovery, so one slow moment (a long slider drag, a large upload) kept the
 * stage there, choppy and without AO, for the rest of the visit.
 */
export function autoStep(quality: RenderQuality, direction: 'down' | 'up'): RenderQuality {
  const index = ORDER.indexOf(quality);
  return ORDER[direction === 'down' ? Math.min(index + 1, AUTO_FLOOR) : Math.max(index - 1, 0)]!;
}

/** Settings of the tier the stage currently renders at, for scene components. */
export const QualityContext = createContext<QualitySettings>(QUALITY.high);

export function useQuality(): QualitySettings {
  return useContext(QualityContext);
}
