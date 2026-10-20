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
import type { Object3D } from 'three';

import { boneAxesOf, type AxisMap } from './vrm/boneAxes';
import {
  applyBodyShape,
  clampHeight,
  DEFAULT_BODY_SHAPE,
  type BodyShape,
  type BodyShapeOptions,
} from './vrm/bodyShape';
import { prepareFit, type BodyProfile, type PreparedFit } from './vrm/fitDonor';
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
  /** Called after the base and parts are set up or reshaped, for layers built on them. */
  onAssembled?: (assembly: Assembly) => void;
  /** Body profile of each part's source model, keyed by part URL (see fitDonor.ts). */
  sourceProfiles?: Record<string, BodyProfile>;
}

/** The live models of one assembled character. */
export interface Assembly {
  base: VRM;
  donors: readonly VRM[];
}

interface Runtime {
  base: BaseRuntime;
  baseAxes: (bone: Object3D) => AxisMap;
  donors: VRM[];
  /** How each donor's part is reshaped to fit this base (same order as donors). */
  fits: PreparedFit[];
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
  onAssembled,
  sourceProfiles,
}: VrmAvatarProps) {
  // Effects key on values, not object identity, so parent re-renders with an
  // equal selection never rebuild the models.
  const partsKey = JSON.stringify(parts);
  const tintsKey = JSON.stringify(tints);
  const donorUrls = useMemo(() => {
    const selection = JSON.parse(partsKey) as PartSelection;
    return [...new Set(Object.values(selection).filter((u): u is string => !!u && u !== baseUrl))];
  }, [partsKey, baseUrl]);
  const gltfs = useLoader(GLTFLoader, [baseUrl, ...donorUrls], registerVrm);
  const camera = useThree((s) => s.camera);

  // Callbacks and speech live in refs so new props never re-run model setup.
  const onMeasuredRef = useRef(onMeasured);
  const onAssembledRef = useRef(onAssembled);
  const speechRef = useRef(speech);
  useEffect(() => {
    onMeasuredRef.current = onMeasured;
    onAssembledRef.current = onAssembled;
    speechRef.current = speech;
  }, [onMeasured, onAssembled, speech]);
  // Profiles are read at setup; the key re-runs setup when a part gains one.
  const profilesRef = useRef(sourceProfiles);
  // Declared before the setup effect so it runs first in the same commit.
  useLayoutEffect(() => {
    profilesRef.current = sourceProfiles;
  }, [sourceProfiles]);
  const profilesKey = donorUrls.filter((url) => sourceProfiles?.[url]).join('|');

  const runtimeRef = useRef<Runtime | undefined>(undefined);
  useLayoutEffect(() => {
    const [baseGltf, ...donorGltfs] = gltfs;
    const baseVrm = vrmOf(baseGltf, baseUrl);
    const donorVrms = donorGltfs.map((g, i) => vrmOf(g, donorUrls[i]));

    const selection = JSON.parse(partsKey) as PartSelection;
    const topDonor = selection.top ? donorVrms[donorUrls.indexOf(selection.top)] : undefined;
    const visibility = resolveVisibility(
      baseUrl,
      selection,
      topDonor ? hasOnepiece(topDonor) : false,
    );

    const base = setupBase(baseVrm);
    applyBaseVisibility(baseVrm, visibility.base);
    donorVrms.forEach((vrm, i) => {
      prepareVrm(vrm);
      applyDonorVisibility(vrm, visibility.donors.get(donorUrls[i]) ?? new Set());
      pruneSpringBones(vrm);
    });

    runtimeRef.current = {
      base,
      baseAxes: boneAxesOf(baseVrm),
      donors: donorVrms,
      // Measured after visibility: only the parts actually worn are fitted.
      fits: donorVrms.map((vrm, i) =>
        prepareFit(baseVrm, vrm, profilesRef.current?.[donorUrls[i]]),
      ),
      needsSpringReset: true,
      needsCoverage: true,
    };
    onMeasuredRef.current?.(measureHeight(baseVrm));
    return () => {
      runtimeRef.current = undefined;
    };
  }, [gltfs, baseUrl, donorUrls, partsKey, profilesKey]);

  // Body shape: same bone scales on base and parts so garments follow the body.
  const { build, height } = bodyShape;
  useLayoutEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const shape = { build, height: clampHeight(height) };
    const reshape = (vrm: VRM, options: BodyShapeOptions) => {
      vrm.scene.scale.setScalar(shape.height);
      const humanoid = vrm.humanoid;
      if (!humanoid) return;
      applyBodyShape(
        (name) => humanoid.getRawBoneNode(name as VRMHumanBoneName) ?? undefined,
        VRMHumanBoneList,
        shape,
        options,
      );
    };
    reshape(runtime.base.vrm, { axes: runtime.baseAxes });
    runtime.donors.forEach((vrm, i) => {
      const { axes, scale } = runtime.fits[i];
      reshape(vrm, { axes, fit: scale });
    });
    runtime.needsSpringReset = true;
    runtime.needsCoverage = true;
    onMeasuredRef.current?.(measureHeight(runtime.base.vrm));
    onAssembledRef.current?.({ base: runtime.base.vrm, donors: runtime.donors });
  }, [gltfs, partsKey, profilesKey, build, height]);

  useLayoutEffect(() => {
    const values = JSON.parse(tintsKey) as Tints;
    for (const gltf of gltfs) applyTints(gltf.scene, values);
  }, [gltfs, tintsKey]);

  useFrame(({ clock }, delta) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const dt = Math.min(delta, 0.1);
    animateBase(runtime.base, clock.elapsedTime, dt, camera, speechRef.current);

    const baseVrm = runtime.base.vrm;
    baseVrm.scene.updateMatrixWorld(true);
    for (const [i, donor] of runtime.donors.entries()) {
      syncDonor(baseVrm, donor, dt, runtime.fits[i]);
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
