'use client';

import {
  VRMHumanBoneList,
  VRMLoaderPlugin,
  type VRM,
  type VRMHumanBoneName,
} from '@pixiv/three-vrm';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import type { SpeechPlayer } from '../lipsync/speechPlayer';
import { applyBodyShape, clampHeight, DEFAULT_BODY_SHAPE, type BodyShape } from './vrm/bodyShape';
import {
  applyBaseVisibility,
  applyDonorVisibility,
  hasOnepiece,
  pruneSpringBones,
  resolveVisibility,
  syncDonor,
  type PartSelection,
} from './vrm/parts';
import { applySkinCoverage } from './vrm/applySkinCoverage';
import { applyTints, type Tints } from './vrm/tint';
import {
  animateBase,
  measureHeight,
  prepareVrm,
  setupBase,
  type BaseRuntime,
} from './vrm/vrmRuntime';

interface VrmAvatarProps {
  /** Base VRM: owns the face (expressions, lip-sync), body and skeleton. */
  baseUrl: string;
  /** Parts taken from donor VRMs, keyed by category. */
  parts?: PartSelection;
  bodyShape?: BodyShape;
  tints?: Tints;
  speech?: SpeechPlayer;
  /** Reports the standing height in metres once the base is loaded. */
  onMeasured?: (height: number) => void;
}

interface Runtime {
  base: BaseRuntime;
  donors: VRM[];
  needsSpringReset: boolean;
  /** Recompute hidden skin under garments after the next donor sync. */
  needsCoverage: boolean;
}

function registerVrm(loader: GLTFLoader): void {
  loader.register((parser) => new VRMLoaderPlugin(parser));
}

function vrmOf(gltf: { userData: Record<string, unknown> }, url: string): VRM {
  const vrm = gltf.userData.vrm as VRM | undefined;
  if (!vrm) throw new Error(`${url} is not a VRM file`);
  return vrm;
}

export function VrmAvatar({
  baseUrl,
  parts = {},
  bodyShape = DEFAULT_BODY_SHAPE,
  tints = {},
  speech,
  onMeasured,
}: VrmAvatarProps) {
  const donorUrls = useMemo(
    () => [...new Set(Object.values(parts).filter((u): u is string => !!u && u !== baseUrl))],
    [parts, baseUrl],
  );
  const gltfs = useLoader(GLTFLoader, [baseUrl, ...donorUrls], registerVrm);
  const camera = useThree((s) => s.camera);

  // Callbacks and speech live in refs so new props never re-run model setup.
  const onMeasuredRef = useRef(onMeasured);
  const speechRef = useRef(speech);
  useEffect(() => {
    onMeasuredRef.current = onMeasured;
    speechRef.current = speech;
  }, [onMeasured, speech]);

  const runtimeRef = useRef<Runtime | undefined>(undefined);
  useLayoutEffect(() => {
    const [baseGltf, ...donorGltfs] = gltfs;
    const baseVrm = vrmOf(baseGltf, baseUrl);
    const donorVrms = donorGltfs.map((g, i) => vrmOf(g, donorUrls[i]));

    const topDonor = parts.top ? donorVrms[donorUrls.indexOf(parts.top)] : undefined;
    const visibility = resolveVisibility(baseUrl, parts, topDonor ? hasOnepiece(topDonor) : false);

    const base = setupBase(baseVrm);
    applyBaseVisibility(baseVrm, visibility.base);
    donorVrms.forEach((vrm, i) => {
      prepareVrm(vrm);
      applyDonorVisibility(vrm, visibility.donors.get(donorUrls[i]) ?? new Set());
      pruneSpringBones(vrm);
    });

    runtimeRef.current = {
      base,
      donors: donorVrms,
      needsSpringReset: true,
      needsCoverage: true,
    };
    onMeasuredRef.current?.(measureHeight(baseVrm));
    return () => {
      runtimeRef.current = undefined;
    };
  }, [gltfs, baseUrl, donorUrls, parts]);

  // Body shape: same bone scales on base and parts so garments follow the body.
  const { build, height } = bodyShape;
  useLayoutEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const shape = { build, height: clampHeight(height) };
    for (const vrm of [runtime.base.vrm, ...runtime.donors]) {
      vrm.scene.scale.setScalar(shape.height);
      const humanoid = vrm.humanoid;
      if (!humanoid) continue;
      applyBodyShape(
        (name) => humanoid.getRawBoneNode(name as VRMHumanBoneName) ?? undefined,
        VRMHumanBoneList,
        shape,
      );
    }
    runtime.needsSpringReset = true;
    runtime.needsCoverage = true;
    onMeasuredRef.current?.(measureHeight(runtime.base.vrm));
  }, [gltfs, parts, build, height]);

  useLayoutEffect(() => {
    for (const gltf of gltfs) applyTints(gltf.scene, tints);
  }, [gltfs, tints]);

  useFrame(({ clock }, delta) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const dt = Math.min(delta, 0.1);
    animateBase(runtime.base, clock.elapsedTime, dt, camera, speechRef.current);

    const baseVrm = runtime.base.vrm;
    baseVrm.scene.updateMatrixWorld(true);
    for (const donor of runtime.donors) {
      syncDonor(baseVrm, donor, dt);
      // The first sync teleports donor joints; settle springs from there.
      if (runtime.needsSpringReset) donor.springBoneManager?.reset();
    }
    runtime.needsSpringReset = false;
    if (runtime.needsCoverage) {
      applySkinCoverage(baseVrm, runtime.donors);
      runtime.needsCoverage = false;
    }
  });

  return (
    <group>
      {gltfs.map((gltf, i) => (
        <primitive key={i === 0 ? baseUrl : donorUrls[i - 1]} object={gltf.scene} />
      ))}
    </group>
  );
}
