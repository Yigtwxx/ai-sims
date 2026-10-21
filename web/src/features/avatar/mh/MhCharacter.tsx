'use client';

import { useFrame, useThree } from '@react-three/fiber';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import type { Camera, Material, Mesh, Object3D, WebGLRenderTarget } from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
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
import { useQuality } from '../quality';
import { applyEyeMaterials, bindIrisTextures } from './eyeMaterials';
import { densityFiles, packGroomDensity, setGroomDensity, setGroomTint } from './groomDensity';
import { takeOffGroom, wearGroom, type GroomWear, type WornGroom } from './hair';
import { setHairLook } from './hairMaterial';
import { useMhGltf } from './loaders';
import { MotionPlayer, type MocapLayer, type MotionClip } from './motion';
import {
  applySkinMaterials,
  loadSkinDetail,
  setSkinDetail,
  type WrinkleUniforms,
} from './materials';
import {
  bindSkinTextures,
  loadAssetTexture,
  loadIrisTextures,
  loadSkinTextures,
} from './skinTextures';
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
  /** Hair and facial hair cards, fitted to this head; recolouring needs no reload. */
  grooms?: readonly GroomWear[];
  /** Called every frame after the mixer and before rendering (life, lip-sync). */
  onFrame?: (handle: MhCharacterHandle, delta: number, camera: Camera) => void;
  /**
   * Called once the skin, eyes and grooms of the current props are on (or
   * failed and were skipped); again after every change that reloads them.
   */
  onSettled?: () => void;
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
    grooms = NO_GROOMS,
    onFrame,
    onSettled,
  },
  ref,
) {
  const gl = useThree((state) => state.gl);
  // The first frame can show a character whose skin and hair are still
  // loading; thumbnails and the premiere wait for both parts to settle.
  const settled = useRef({ skin: false, grooms: false });
  const latestOnSettled = useRef(onSettled);
  useLayoutEffect(() => {
    latestOnSettled.current = onSettled;
  }, [onSettled]);
  const settle = useCallback((part: 'skin' | 'grooms') => {
    settled.current[part] = true;
    if (settled.current.skin && settled.current.grooms) latestOnSettled.current?.();
  }, []);
  const bodyGltf = useMhGltf(bodyUrl);
  const headGltf = useMhGltf(headUrl);

  const assembled = useMemo(() => {
    const bodyRoot = cloneSkinned(bodyGltf.scene) as Object3D;
    const headRoot = cloneSkinned(headGltf.scene) as Object3D;
    const extras = mhExtras(bodyGltf.scene, bodyGltf.parser.json as { extras?: unknown });
    const headExtras = mhExtras(headGltf.scene, headGltf.parser.json as { extras?: unknown });
    const body = createBodyRig(bodyRoot, (extras.body_joint_deltas ?? {}) as JointDeltas);
    const headMeshes = attachHead(headRoot, body);
    // The skin primitive: grooms are fitted to its DNA positions and joints.
    const headSkin = headMeshes.find((mesh) => (mesh.material as Material).name === 'head');
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
      headSkin,
      skins,
      eyes,
      wrinkles: wrinkleDriver(bodyRoot, skins, headExtras),
    };
  }, [bodyGltf, headGltf]);

  useEffect(() => {
    settled.current.skin = false;
    if (!skin && !iris) {
      settle('skin');
      return;
    }
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
      if (!live) return;
      setVisible(assembled.root, true);
      settle('skin');
    });
    return () => {
      live = false;
    };
  }, [assembled, gl, skin, makeup, iris, settle]);

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

  // Grooms load in the background (the character never waits for its hair);
  // changing one groom re-fits all of them from the loader cache.
  const groomKey = grooms.map((wear) => wear.groom.id).join('|');
  const latestGrooms = useRef(grooms);
  useLayoutEffect(() => {
    latestGrooms.current = grooms;
  }, [grooms]);
  const worn = useRef(new Map<string, WornGroom>());
  const { hairLod } = useQuality();
  useEffect(() => {
    const head = assembled.headSkin;
    settled.current.grooms = false;
    if (!groomKey || !head) {
      settle('grooms');
      return;
    }
    let live = true;
    const wearing = worn.current;
    const mine: WornGroom[] = [];
    const wears = latestGrooms.current;
    const fitted = Promise.allSettled(wears.map((wear) => wearGroom(gl, wear, head, hairLod))).then(
      (results) => {
        results.forEach((result, i) => {
          if (result.status === 'rejected') {
            console.warn('[mh] groom failed to load', wears[i]?.groom.id, result.reason);
            return;
          }
          const groom = result.value;
          if (!live) {
            groom.dispose();
            return;
          }
          for (const mesh of groom.meshes) assembled.root.add(mesh);
          assembled.handle.faceMeshes.push(...groom.meshes);
          const look = latestGrooms.current.find((wear) => wear.groom.id === groom.id)?.look;
          if (look) setHairLook(groom.materials, look);
          wearing.set(groom.id, groom);
          mine.push(groom);
        });
      },
    );
    // Hair growing from the skin: the grooms' density darkens the scalp and brows.
    let density: WebGLRenderTarget | null = null;
    const files = densityFiles(wears);
    let tinted: Promise<void> = Promise.resolve();
    if (files.some(Boolean)) {
      tinted = Promise.all(
        files.map((file) => (file ? loadAssetTexture(gl, file, 'data') : null)),
      ).then(
        (layers) => {
          if (!live) return;
          density = packGroomDensity(gl, layers);
          const look = latestGrooms.current[0]?.look;
          setGroomDensity(assembled.skins, density.texture, files, look);
        },
        (error: unknown) => console.warn('[mh] groom density failed to load', error),
      );
    }
    void Promise.all([fitted, tinted]).then(() => {
      if (live) settle('grooms');
    });
    return () => {
      live = false;
      for (const groom of mine) {
        takeOffGroom(assembled.root, assembled.handle.faceMeshes, groom);
        wearing.delete(groom.id);
      }
      setGroomDensity(assembled.skins, null, [], undefined);
      density?.dispose();
    };
  }, [assembled, gl, groomKey, hairLod, settle]);

  useEffect(() => {
    for (const wear of grooms) {
      const groom = worn.current.get(wear.groom.id);
      if (groom) setHairLook(groom.materials, wear.look);
    }
    if (grooms[0]) setGroomTint(assembled.skins, grooms[0].look);
  }, [assembled, grooms]);

  useImperativeHandle(ref, () => assembled.handle, [assembled]);

  useLayoutEffect(() => {
    applyBodySliders(assembled.handle.body, sliders ?? {});
  }, [assembled, sliders]);

  useFrame(({ camera }, delta) => {
    onFrame?.(assembled.handle, delta, camera);
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
const NO_GROOMS: readonly GroomWear[] = [];

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
        // Converter clips are meshopt-compressed; they carry no textures.
        pending = new GLTFLoader()
          .setMeshoptDecoder(MeshoptDecoder)
          .loadAsync(url)
          .then((gltf) => {
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
