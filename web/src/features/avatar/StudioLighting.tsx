'use client';

import { Environment } from '@react-three/drei';

const HDRI_URL = '/assets/hdri/studio_small_09_2k.hdr';

/**
 * Portrait-studio lighting: HDRI for soft image-based fill and reflections,
 * a warm key with soft shadows, and a cool rim to separate the silhouette
 * from the white cyclorama.
 */
export function StudioLighting({ intensity = 1 }: { intensity?: number }) {
  return (
    <>
      <Environment files={HDRI_URL} environmentIntensity={0.85 * intensity} />

      {/* Key: high front-left, slightly warm. */}
      <directionalLight
        position={[-1.8, 4.2, 3.6]}
        intensity={2.6 * intensity}
        color="#fff4ea"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0002}
        shadow-normalBias={0.02}
        shadow-radius={6}
        shadow-camera-left={-1.5}
        shadow-camera-right={1.5}
        shadow-camera-top={2.4}
        shadow-camera-bottom={-0.4}
        shadow-camera-near={0.5}
        shadow-camera-far={12}
      />

      {/* Rim: behind right, cool, no shadow. */}
      <directionalLight position={[2.6, 2.8, -3.0]} intensity={1.6 * intensity} color="#e8f0ff" />

      {/* Fill: low front-right to lift the shadow side of the face. */}
      <directionalLight position={[2.4, 1.2, 2.6]} intensity={0.45 * intensity} color="#ffffff" />
    </>
  );
}
