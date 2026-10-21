import { createContext, useContext } from 'react';

/**
 * Render quality tiers. `high` is the look the stage is tuned for (desktop GPU);
 * `balanced` trades pixel density and AO samples for frame rate; `battery`
 * (laptops off the charger, weak GPUs) drops AO, wears the lighter hair cards
 * and caps the stage at 30 fps. `auto` starts high and steps down when the
 * frame rate cannot keep up.
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

/** The next lower tier (battery stays battery). */
export function stepDown(quality: RenderQuality): RenderQuality {
  return ORDER[Math.min(ORDER.indexOf(quality) + 1, ORDER.length - 1)]!;
}

/** Settings of the tier the stage currently renders at, for scene components. */
export const QualityContext = createContext<QualitySettings>(QUALITY.high);

export function useQuality(): QualitySettings {
  return useContext(QualityContext);
}
