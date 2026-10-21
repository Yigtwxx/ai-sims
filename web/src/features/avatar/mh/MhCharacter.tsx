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
import type {
  Camera,
  Material,
  Mesh,
  Object3D,
  Scene,
  Texture,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
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
  presetSkinnedBounds,
  setMorph,
  type BodyRig,
  type BodySliderId,
  type JointDeltas,
  type NeckSeamExtras,
} from './assembly';
import { useQuality } from '../quality';
import { applyEyeMaterials, bindIrisTextures } from './eyeMaterials';
import { applyBodyHide } from './garments';
import { densityFiles, packGroomDensity, setGroomDensity, setGroomTint } from './groomDensity';
import { takeOffGroom, wearGroom, type GroomWear, type WornGroom } from './hair';
import { setHairLook } from './hairMaterial';
import { useMhGltf } from './loaders';
import { MotionPlayer, type MocapLayer, type MotionClip } from './motion';
import { setOutfitColors, wearOutfit, type OutfitWear, type WornOutfit } from './outfits';
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
  /** Garments bound to the body skeleton; recolouring needs no reload. */
  outfits?: readonly OutfitWear[];
  /** Called every frame after the mixer and before rendering (life, lip-sync). */
  onFrame?: (handle: MhCharacterHandle, delta: number, camera: Camera) => void;
  /**
   * Called once the skin, eyes and grooms of the current props are on (or
   * failed and were skipped); again after every change that reloads them.
   */
  onSettled?: () => void;
  /**
   * Upload every texture and compile every material before reporting settled,
   * a texture per frame. For a character assembled off screen: shown without
   * it, its first frame uploads all its maps at once and the stage freezes.
   */
  prewarm?: boolean;
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
    outfits = NO_OUTFITS,
    onFrame,
    onSettled,
    prewarm = false,
  },
  ref,
) {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  // The first frame can show a character whose skin and hair are still
  // loading; thumbnails and the premiere wait for both parts to settle.
  const settled = useRef({ skin: false, grooms: false, outfits: false });
  const latestOnSettled = useRef(onSettled);
  const warm = useRef<{ enabled: boolean; root: Object3D | null; camera: Camera; scene: Scene }>({
    enabled: prewarm,
    root: null,
    camera,
    scene,
  });
  useLayoutEffect(() => {
    latestOnSettled.current = onSettled;
    warm.current.enabled = prewarm;
    warm.current.camera = camera;
    warm.current.scene = scene;
  }, [onSettled, prewarm, camera, scene]);
  // Counts settles, so a warm-up that a newer change overtook reports nothing.
  const settles = useRef(0);
  const settle = useCallback(
    (part: keyof typeof settled.current) => {
      settled.current[part] = true;
      const { skin: skinDone, grooms: groomsDone, outfits: outfitsDone } = settled.current;
      if (!skinDone || !groomsDone || !outfitsDone) return;
      const run = ++settles.current;
      const { enabled, root, camera: view, scene: world } = warm.current;
      if (!enabled || !root) {
        latestOnSettled.current?.();
        return;
      }
      void warmUp(gl, root, view, world).then(() => {
        if (run === settles.current) latestOnSettled.current?.();
      });
    },
    [gl],
  );
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
        // Always in frame; culling would first walk every skinned vertex
        // through its bones to size the body's bounds (a long first frame).
        mesh.frustumCulled = false;
      }
    });
    presetSkinnedBounds(bodyRoot);
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
  // changing one groom re-fits all of them from the loader cache. The hair on
  // now stays until the new set is fitted, so a change never shows a bald head.
  const groomKey = grooms.map((wear) => wear.groom.id).join('|');
  const latestGrooms = useRef(grooms);
  useLayoutEffect(() => {
    latestGrooms.current = grooms;
  }, [grooms]);
  const worn = useRef(new Map<string, WornGroom>());
  const density = useRef<WebGLRenderTarget | null>(null);
  const { hairLod } = useQuality();
  const swapGrooms = useCallback(
    (next: WornGroom[], files: (string | null)[], layers: WebGLRenderTarget | null) => {
      for (const groom of worn.current.values()) {
        takeOffGroom(assembled.root, assembled.handle.faceMeshes, groom);
      }
      worn.current.clear();
      for (const groom of next) {
        for (const mesh of groom.meshes) assembled.root.add(mesh);
        assembled.handle.faceMeshes.push(...groom.meshes);
        worn.current.set(groom.id, groom);
      }
      presetSkinnedBounds(assembled.root);
      // Hair growing from the skin: the grooms' density darkens the scalp and brows.
      setGroomDensity(
        assembled.skins,
        layers?.texture ?? null,
        files,
        latestGrooms.current[0]?.look,
      );
      density.current?.dispose();
      density.current = layers;
    },
    [assembled],
  );
  useEffect(() => () => swapGrooms([], [], null), [swapGrooms]);
  useEffect(() => {
    const head = assembled.headSkin;
    settled.current.grooms = false;
    if (!groomKey || !head) {
      swapGrooms([], [], null);
      settle('grooms');
      return;
    }
    let live = true;
    const wears = latestGrooms.current;
    const fitted = Promise.allSettled(wears.map((wear) => wearGroom(gl, wear, head, hairLod))).then(
      (results) =>
        results.flatMap((result, i) => {
          if (result.status === 'fulfilled') return [result.value];
          console.warn('[mh] groom failed to load', wears[i]?.groom.id, result.reason);
          return [];
        }),
    );
    const files = densityFiles(wears);
    const layers: Promise<WebGLRenderTarget | null> = files.some(Boolean)
      ? Promise.all(files.map((file) => (file ? loadAssetTexture(gl, file, 'data') : null))).then(
          (textures) => packGroomDensity(gl, textures),
          (error: unknown) => {
            console.warn('[mh] groom density failed to load', error);
            return null;
          },
        )
      : Promise.resolve(null);
    void Promise.all([fitted, layers]).then(([next, packed]) => {
      if (!live) {
        for (const groom of next) groom.dispose();
        packed?.dispose();
        return;
      }
      for (const groom of next) {
        const look = latestGrooms.current.find((wear) => wear.groom.id === groom.id)?.look;
        if (look) setHairLook(groom.materials, look);
      }
      swapGrooms(next, files, packed);
      settle('grooms');
    });
    return () => {
      live = false;
    };
  }, [assembled, gl, groomKey, hairLod, settle, swapGrooms]);

  useEffect(() => {
    for (const wear of grooms) {
      const groom = worn.current.get(wear.groom.id);
      if (groom) setHairLook(groom.materials, wear.look);
    }
    if (grooms[0]) setGroomTint(assembled.skins, grooms[0].look);
  }, [assembled, grooms]);

  // Outfits load in the background; the previous ones stay on until the new
  // set is ready, so changing a garment never flashes bare skin.
  const outfitKey = outfits.map((wear) => `${wear.outfit.id}@${wear.file}`).join('|');
  const latestOutfits = useRef(outfits);
  useLayoutEffect(() => {
    latestOutfits.current = outfits;
  }, [outfits]);
  const wornOutfits = useRef<WornOutfit[]>([]);
  const swapOutfits = useCallback(
    (next: WornOutfit[]) => {
      const body = assembled.handle.body;
      for (const worn of wornOutfits.current) {
        for (const mesh of worn.meshes) {
          mesh.removeFromParent();
          const i = body.garments.indexOf(mesh);
          if (i >= 0) body.garments.splice(i, 1);
        }
        worn.dispose();
      }
      for (const worn of next) {
        for (const mesh of worn.meshes) (body.mesh.parent ?? assembled.root).add(mesh);
        body.garments.push(...worn.meshes);
      }
      presetSkinnedBounds(assembled.root);
      wornOutfits.current = next;
      applyBodyHide(
        body.mesh,
        next.flatMap((worn) => (worn.hide ? [worn.hide] : [])),
      );
    },
    [assembled],
  );
  useEffect(() => () => swapOutfits([]), [swapOutfits]);
  useEffect(() => {
    settled.current.outfits = false;
    const wears = latestOutfits.current;
    if (!outfitKey) {
      swapOutfits([]);
      settle('outfits');
      return;
    }
    let live = true;
    const body = assembled.handle.body;
    void Promise.allSettled(wears.map((wear) => wearOutfit(gl, wear, body))).then((results) => {
      const next: WornOutfit[] = [];
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') next.push(result.value);
        else console.warn('[mh] outfit failed to load', wears[i]?.outfit.id, result.reason);
      });
      if (!live) {
        for (const worn of next) worn.dispose();
        return;
      }
      for (const worn of next) {
        const colors = latestOutfits.current.find((wear) => wear.outfit.id === worn.id)?.colors;
        if (colors) setOutfitColors(worn, colors);
      }
      swapOutfits(next);
      settle('outfits');
    });
    return () => {
      live = false;
    };
  }, [assembled, gl, outfitKey, settle, swapOutfits]);

  useEffect(() => {
    for (const wear of outfits) {
      const worn = wornOutfits.current.find((candidate) => candidate.id === wear.outfit.id);
      if (worn) setOutfitColors(worn, wear.colors);
    }
  }, [outfits]);

  useImperativeHandle(ref, () => assembled.handle, [assembled]);
  useLayoutEffect(() => {
    warm.current.root = assembled.root;
  }, [assembled]);

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
const NO_OUTFITS: readonly OutfitWear[] = [];

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

/** Every texture a character's materials sample, uniforms of patched shaders included. */
function texturesOf(root: Object3D): Set<Texture> {
  const found = new Set<Texture>();
  const take = (value: unknown) => {
    if ((value as Texture | null)?.isTexture) found.add(value as Texture);
    else if (Array.isArray(value)) value.forEach(take);
  };
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      Object.values(material).forEach(take);
      // Uniform groups the skin, hair and fabric shaders keep in userData.
      for (const group of Object.values(material.userData)) {
        if (group && typeof group === 'object') {
          for (const uniform of Object.values(group as Record<string, { value?: unknown }>)) {
            take(uniform?.value);
          }
        }
      }
    }
  });
  return found;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Uploads a character's textures one per frame, then compiles its materials. */
async function warmUp(
  gl: WebGLRenderer,
  root: Object3D,
  camera: Camera,
  scene: Scene,
): Promise<void> {
  for (const texture of texturesOf(root)) {
    gl.initTexture(texture);
    await nextFrame();
  }
  await gl.compileAsync(root, camera, scene);
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
