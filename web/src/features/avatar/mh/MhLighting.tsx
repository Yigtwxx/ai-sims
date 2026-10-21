'use client';

import { Environment } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import { Object3D, SpotLight } from 'three';

import { useQuality } from '../quality';
import { LIGHTING_RIGS, type SpotRig } from './lighting';

const HDRI_URL = '/assets/hdri/studio_small_09_2k.hdr';

/**
 * The MetaHuman Creator light rig in world space. The turntable turns the
 * character, not the lights, so the lighting stays fixed to the viewer like a
 * real studio. Only the key casts shadows: one soft shadow map keeps it fast.
 */
export function MhLighting({ rig = 'studio' }: { rig?: keyof typeof LIGHTING_RIGS }) {
  const preset = LIGHTING_RIGS[rig];
  return (
    <>
      <Environment files={HDRI_URL} environmentIntensity={preset.environment} />
      <ambientLight intensity={preset.ambient} />
      {preset.spots.map((spot) => (
        <RigSpot key={spot.name} spot={spot} />
      ))}
    </>
  );
}

function createSpot(spot: SpotRig, shadowMapSize: number): SpotLight {
  const light = new SpotLight(
    0xffffff,
    spot.intensity,
    spot.distance,
    spot.angle,
    spot.penumbra,
    2,
  );
  light.name = `rig-${spot.name}`;
  light.position.set(...spot.position);
  light.target = new Object3D();
  light.target.position.set(...spot.target);
  light.castShadow = spot.castShadow;
  if (spot.castShadow) {
    light.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    light.shadow.bias = -0.0002;
    light.shadow.normalBias = 0.02;
    light.shadow.radius = spot.shadowRadius;
    light.shadow.camera.near = 0.5;
    light.shadow.camera.far = 8;
  }
  return light;
}

function RigSpot({ spot }: { spot: SpotRig }) {
  const { shadowMapSize } = useQuality();
  const light = useMemo(() => createSpot(spot, shadowMapSize), [spot, shadowMapSize]);
  useEffect(() => () => light.dispose(), [light]);
  return (
    <>
      <primitive object={light} />
      <primitive object={light.target} />
    </>
  );
}
