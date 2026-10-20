'use client';

import { useFrame } from '@react-three/fiber';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo } from 'react';
import type { Mesh, Object3D } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

import {
  applyBodySliders,
  attachHead,
  bindNeckSeam,
  collectMorphMeshes,
  createBodyRig,
  mhExtras,
  setMorph,
  type BodyRig,
  type BodySliderId,
  type JointDeltas,
  type NeckSeamExtras,
} from './assembly';
import { useMhGltf } from './loaders';
import { applyEyeMaterials } from './eyeMaterials';
import { applySkinMaterials, loadSkinDetail, setSkinDetail } from './materials';

export interface MhCharacterHandle {
  /** Body rig (skeleton master) once assembled. */
  body: BodyRig;
  /** Head primitives carrying the ARKit + viseme morphs. */
  faceMeshes: Mesh[];
  /** Sets a face morph on every head primitive that has it. */
  setFaceMorph: (name: string, weight: number) => void;
}

export interface MhCharacterProps {
  bodyUrl: string;
  headUrl: string;
  sliders?: Partial<Record<BodySliderId, number>>;
  /** Called every frame after the mixer and before rendering (life, lip-sync). */
  onFrame?: (handle: MhCharacterHandle, delta: number) => void;
}

/**
 * Loads one body and one head GLB, clones them (the loader cache is shared) and
 * assembles a single character: head skinned to the body skeleton, body sliders
 * applied with rebinding, skin materials replaced by the MetaHuman skin shader.
 */
export const MhCharacter = forwardRef<MhCharacterHandle, MhCharacterProps>(function MhCharacter(
  { bodyUrl, headUrl, sliders, onFrame },
  ref,
) {
  const bodyGltf = useMhGltf(bodyUrl);
  const headGltf = useMhGltf(headUrl);

  const assembled = useMemo(() => {
    const bodyRoot = cloneSkinned(bodyGltf.scene) as Object3D;
    const headRoot = cloneSkinned(headGltf.scene) as Object3D;
    const extras = mhExtras(bodyGltf.scene, bodyGltf.parser.json as { extras?: unknown });
    const headExtras = mhExtras(headGltf.scene, headGltf.parser.json as { extras?: unknown });
    const body = createBodyRig(bodyRoot, (extras.body_joint_deltas ?? {}) as JointDeltas);
    const headMeshes = attachHead(headRoot, body);
    for (const mesh of headMeshes) bodyRoot.add(mesh);
    bodyRoot.updateMatrixWorld(true);
    body.seam = bindNeckSeam(
      headMeshes,
      headExtras.neck_seam as NeckSeamExtras | undefined,
      body,
      extras.neck_seam as NeckSeamExtras | undefined,
    );
    bodyRoot.traverse((node) => {
      const mesh = node as Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    const skins = applySkinMaterials(bodyRoot, { microNormal: null });
    const eyes = applyEyeMaterials(bodyRoot);
    const faceMeshes = collectMorphMeshes(bodyRoot).filter((mesh) => mesh !== body.mesh);
    const handle: MhCharacterHandle = {
      body,
      faceMeshes,
      setFaceMorph: (name, weight) => setMorph(faceMeshes, name, weight),
    };
    return { root: bodyRoot, handle, skins, eyes };
  }, [bodyGltf, headGltf]);

  useEffect(() => {
    let live = true;
    void loadSkinDetail().then((detail) => {
      if (live) setSkinDetail(assembled.skins, detail);
    });
    return () => {
      live = false;
      for (const material of [...assembled.skins, ...assembled.eyes]) material.dispose();
    };
  }, [assembled]);

  useImperativeHandle(ref, () => assembled.handle, [assembled]);

  useLayoutEffect(() => {
    applyBodySliders(assembled.handle.body, sliders ?? {});
  }, [assembled, sliders]);

  useFrame((_, delta) => onFrame?.(assembled.handle, delta));

  return <primitive object={assembled.root} />;
});
