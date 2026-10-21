import { ShaderChunk } from 'three';

/**
 * three's PCF filter (r18x) takes 5 shadow-map taps on a disk it rotates per
 * pixel with interleaved gradient noise. That is meant to be resolved over
 * time (TAA); our post stack has none, so penumbras on skin (the arm against
 * the torso, the neck under the jaw) show a regular grain. Spot and
 * directional shadows here use 16 taps on a fixed disk instead: smooth, at a
 * cost the studio rig's two or three shadowed lights can afford.
 */

const NOISY_TAPS =
  /float phi = interleavedGradientNoise\( gl_FragCoord\.xy \) \* PI2;\s*shadow = \([\s\S]*?\) \* 0\.2;/;

const SMOOTH_TAPS = /* glsl */ `
				shadow = 0.0;
				for ( int i = 0; i < 16; i ++ ) {
					shadow += texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( i, 16, 0.0 ) * radius, shadowCoord.z ) );
				}
				shadow /= 16.0;`;

let patched = false;

/** Rewrites the PCF chunk once per page, before any material compiles. */
export function applySmoothShadowFilter(): void {
  if (patched) return;
  patched = true;
  const chunk = ShaderChunk.shadowmap_pars_fragment;
  if (!NOISY_TAPS.test(chunk)) {
    console.warn('[stage] three.js shadow chunk changed; keeping its PCF filter');
    return;
  }
  ShaderChunk.shadowmap_pars_fragment = chunk.replace(NOISY_TAPS, SMOOTH_TAPS);
}
