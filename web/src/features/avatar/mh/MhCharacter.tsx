'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo } from 'react';
import type { Material, Mesh, Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

import type { MhIris, MhSkin } from '@/lib/assets/manifest';

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
import { applyEyeMaterials, bindIrisTextures } from './eyeMaterials';
import { useMhGltf } from './loaders';
import { MotionPlayer, type MocapLayer, type MotionClip } from './motion';
import {
  applySkinMaterials,
  loadSkinDetail,
  setSkinDetail,
  type WrinkleUniforms,
} from './materials';
import { bindSkinTextures, loadIrisTextures, loadSkinTextures } from './skinTextures';
import { compileWrinkleTable, computeWrinkleWeights, type AnimatedMaps } from './wrinkles';

export interface MhCharacterHandle {
  /** Body rig (skeleton master) once assembled. */
  body: BodyRig;
  /** Head primitives carrying the ARKit + viseme morphs. */
  faceMeshes: Mesh[];
  /** Sets a face morph on every head primitive that has it. */
  setFaceMorph: (name: string, weight: number) => void;
  /** Mocap body clips, once loaded (null: procedural idle only). */
  motion: MotionPlayer | null;
}

export interface MhCharacterProps {
  bodyUrl: string;
  headUrl: string;
  sliders?: Partial<Record<BodySliderId, number>>;
  /**
   * Skin set to wear (face + body maps, wrinkles). Converted heads carry no skin
   * maps, so the character stays hidden until the first set is bound; without a
   * set the GLBs' own materials are used.
   */
  skin?: MhSkin | null;
  /** Wear the skin's makeup-baked face albedo when it has one. */
  makeup?: boolean;
  /** Eyeball maps; converted heads carry none, so the eyes are white without one. */
  iris?: MhIris | null;
  /** Idle body clips (GLB animations targeting MetaHuman bone names). */
  idleClips?: readonly string[];
  /** How much of the body the idle clips drive; the procedural layer does the rest. */
  idleLayer?: MocapLayer;
  /** Called every frame after the mixer and before rendering (life, lip-sync). */
  onFrame?: (handle: MhCharacterHandle, delta: number) => void;
}

/**
 * Loads one body and one head GLB, clones them (the loader cache is shared) and
 * assembles a single character: head skinned to the body skeleton, body sliders
 * applied with rebinding, skin materials replaced by the MetaHuman skin shader.
 */
export const MhCharacter = forwardRef<MhCharacterHandle, MhCharacterProps>(function MhCharacter(
  {
    bodyUrl,
    headUrl,
    sliders,
    skin = null,
    makeup = false,
    iris = null,
    idleClips = NO_CLIPS,
    idleLayer = 'full',
    onFrame,
  },
  ref,
) {
  const gl = useThree((state) => state.gl);
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
      motion: null,
    };
    return {
      root: bodyRoot,
      handle,
      skins,
      eyes,
      wrinkles: wrinkleDriver(bodyRoot, skins, headExtras),
    };
  }, [bodyGltf, headGltf]);

  useEffect(() => {
    if (!skin && !iris) return;
    let live = true;
    // A converted head has no maps of its own: hide it rather than show it white.
    if (skin && !hasMaps(assembled.skins)) setVisible(assembled.root, false);
    const jobs = [
      skin &&
        loadSkinTextures(gl, skin, { makeup }).then((textures) => {
          if (live) bindSkinTextures(assembled.skins, textures);
        }),
      iris &&
        loadIrisTextures(gl, iris).then((textures) => {
          if (live) bindIrisTextures(assembled.eyes, textures);
        }),
    ];
    void Promise.allSettled(jobs).then((results) => {
      for (const result of results) {
        // Missing files must not take the character down with them.
        if (result.status === 'rejected') console.warn('[mh] texture set failed', result.reason);
      }
      if (live) setVisible(assembled.root, true);
    });
    return () => {
      live = false;
    };
  }, [assembled, gl, skin, makeup, iris]);

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

  const clipKey = idleClips.join('|');
  useEffect(() => {
    if (!clipKey) return;
    let live = true;
    let player: MotionPlayer | null = null;
    void loadClips(clipKey.split('|'))
      .then((clips) => {
        if (!live || clips.length === 0) return;
        const body = assembled.handle.body;
        player = new MotionPlayer(
          assembled.root,
          clips,
          body.bones.get('pelvis') ?? null,
          body.sliderPosition.get('pelvis') ?? null,
          idleLayer,
        );
        attachMotion(assembled.handle, player);
      })
      .catch((error: unknown) => console.warn('[mh] idle clips failed to load', error));
    return () => {
      live = false;
      attachMotion(assembled.handle, null);
      player?.dispose();
    };
  }, [assembled, clipKey, idleLayer]);

  useImperativeHandle(ref, () => assembled.handle, [assembled]);

  useLayoutEffect(() => {
    applyBodySliders(assembled.handle.body, sliders ?? {});
  }, [assembled, sliders]);

  useFrame((_, delta) => {
    onFrame?.(assembled.handle, delta);
    // Wrinkles follow whatever the face morphs ended up as this frame.
    const wrinkles = assembled.wrinkles;
    if (wrinkles?.uniforms.wrinkleMasks.value) {
      const active = computeWrinkleWeights(
        wrinkles.mesh.morphTargetInfluences ?? [],
        wrinkles.table,
        wrinkles.uniforms.wrinkleWeights.value,
      );
      wrinkles.uniforms.wrinkleActive.value = active ? 1 : 0;
    }
  });

  return <primitive object={assembled.root} />;
});

const NO_CLIPS: readonly string[] = [];

const clipCache = new Map<string, Promise<MotionClip[]>>();

/**
 * Animation clips of animation-only GLBs (with their skeleton's pelvis rest),
 * once per URL. A file that fails to load is skipped, not fatal to the others.
 */
async function loadClips(urls: readonly string[]): Promise<MotionClip[]> {
  const results = await Promise.allSettled(
    urls.map((url) => {
      let pending = clipCache.get(url);
      if (!pending) {
        pending = new GLTFLoader().loadAsync(url).then((gltf) => {
          const pelvisRest = gltf.scene.getObjectByName('pelvis')?.position.clone() ?? null;
          return gltf.animations.map((clip) => ({ clip, pelvisRest }));
        });
        pending.catch(() => clipCache.delete(url));
        clipCache.set(url, pending);
      }
      return pending;
    }),
  );
  return results.flatMap((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    console.warn('[mh] idle clip failed to load', urls[i], result.reason);
    return [];
  });
}

function attachMotion(handle: MhCharacterHandle, motion: MotionPlayer | null): void {
  handle.motion = motion;
}

function hasMaps(materials: readonly Material[]): boolean {
  return materials.every((material) => (material as Material & { map?: unknown }).map);
}

function setVisible(root: Object3D, visible: boolean): void {
  root.visible = visible;
}

/** The head skin mesh, its compiled morph -> wrinkle table and the shader inputs. */
function wrinkleDriver(
  root: Object3D,
  skins: readonly Material[],
  headExtras: Record<string, unknown>,
) {
  const material = skins.find((skin) => skin.userData.wrinkleUniforms);
  const maps = headExtras.animated_maps as AnimatedMaps | undefined;
  if (!material || !maps) return null;
  let mesh: Mesh | undefined;
  root.traverse((node) => {
    if ((node as Mesh).isMesh && (node as Mesh).material === material) mesh = node as Mesh;
  });
  if (!mesh?.morphTargetDictionary) return null;
  return {
    mesh,
    table: compileWrinkleTable(maps, mesh.morphTargetDictionary),
    uniforms: material.userData.wrinkleUniforms as WrinkleUniforms,
  };
}
