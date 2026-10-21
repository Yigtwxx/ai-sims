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
import { memo } from 'react';

export type RenderLook = 'realistic' | 'anime';

/**
 * Finishing stack: contact AO (lighter for anime), Neutral tone mapping, a
 * whisper of bloom and a subtle vignette. Neutral keeps albedo colours as they
 * are below its highlight roll-off, as the MetaHuman Creator studio does (no
 * tone curve); AgX desaturated and lifted darker skin until faces read as
 * another ethnicity. N8AO breaks with MSAA under three r186, so SMAA does the AA.
 */
export const PostEffects = memo(function PostEffects({
  look = 'realistic',
  ao = 'high',
}: {
  look?: RenderLook;
  /** N8AO preset, or null to skip ambient occlusion (battery tier). */
  ao?: 'high' | 'medium' | null;
}) {
  const anime = look === 'anime';
  return (
    <EffectComposer multisampling={0}>
      {ao && (
        <N8AO
          aoRadius={anime ? 0.2 : 0.3}
          distanceFalloff={0.5}
          intensity={anime ? 0.9 : 1.6}
          quality={ao}
        />
      )}
      <Bloom intensity={0.12} luminanceThreshold={0.92} luminanceSmoothing={0.2} mipmapBlur />
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      <Vignette offset={0.32} darkness={0.3} />
      <SMAA />
    </EffectComposer>
  );
});
