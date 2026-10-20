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

/**
 * Film-like finish: contact AO for grounding and creases, a whisper of bloom
 * on speculars, AgX tone mapping (soft highlight roll-off, natural skin), and
 * a subtle vignette. Multisampling replaces SMAA/FXAA.
 */
export function PostEffects() {
  return (
    <EffectComposer multisampling={0}>
      <N8AO aoRadius={0.3} distanceFalloff={0.5} intensity={1.6} quality="high" />
      <Bloom intensity={0.12} luminanceThreshold={0.92} luminanceSmoothing={0.2} mipmapBlur />
      <ToneMapping mode={ToneMappingMode.AGX} />
      <Vignette offset={0.32} darkness={0.3} />
      <SMAA />
    </EffectComposer>
  );
}
