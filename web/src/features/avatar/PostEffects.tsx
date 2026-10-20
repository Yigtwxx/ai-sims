'use client';

import {
  Bloom,
  EffectComposer,
  N8AO,
  SMAA,
  ToneMapping,
  Vignette,
} from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';

export type RenderLook = 'realistic' | 'anime';

/**
 * Finishing stack. Realistic: contact AO, AgX tone mapping (soft highlight
 * roll-off, natural skin). Anime: lighter AO and Neutral tone mapping so the
 * flat MToon colours stay saturated. Both: a whisper of bloom and a subtle
 * vignette. N8AO breaks with MSAA under three r186, so SMAA does the AA.
 */
export function PostEffects({ look = 'realistic' }: { look?: RenderLook }) {
  const anime = look === 'anime';
  return (
    <EffectComposer multisampling={0}>
      <N8AO
        aoRadius={anime ? 0.2 : 0.3}
        distanceFalloff={0.5}
        intensity={anime ? 0.9 : 1.6}
        quality="high"
      />
      <Bloom intensity={0.12} luminanceThreshold={0.92} luminanceSmoothing={0.2} mipmapBlur />
      <ToneMapping mode={anime ? ToneMappingMode.NEUTRAL : ToneMappingMode.AGX} />
      <Vignette offset={0.32} darkness={0.3} />
      <SMAA />
    </EffectComposer>
  );
}
