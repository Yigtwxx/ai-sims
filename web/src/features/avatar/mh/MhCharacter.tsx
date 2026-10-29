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
  use,
} from 'react';
import type { Camera, Group, Material, Mesh, Object3D, Scene, WebGLRenderTarget } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

import type { MhIris, MhSkin } from '@/lib/assets/manifest';

import {
  applyBodySliders,
  attachHead,
  collectBones,
  bindNeckSeam,
  bodySliderKey,
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
import { applyEyeMaterials, bindIrisTextures, setIrisTint, type IrisTint } from './eyeMaterials';
import { applyBodyHide, releaseBodyHide } from './garments';
import { applyFaceBlend, prepareFaceBlend, type PreparedBlend } from './faceBlend';
import {
  densityFiles,
  packGroomDensity,
  paintedSlots,
  setGroomDensity,
  setGroomTint,
} from './groomDensity';
import { takeOffGroom, wearGroom, type GroomWear, type WornGroom } from './hair';
import type { FaceBlendWear } from './resolve';
import { setHairLook } from './hairMaterial';
import { meshoptDecoder, useMhGltf, useMhGltfs } from './loaders';
import { MotionPlayer, type MocapLayer, type MotionClip } from './motion';
import {
  layerOutfits,
  setOutfitColors,
  wearOutfit,
  type OutfitWear,
  type WornOutfit,
} from './outfits';
import {
  applySkinMaterials,
  loadSkinDetail,
  setSkinDetail,
  setSkinTone,
  setUnderwear,
  type WrinkleUniforms,
} from './materials';
import {
  bindSkinTextures,
  loadAssetTexture,
  loadIrisTextures,
  loadSkinTextures,
} from './skinTextures';
import { texturesIn, uploadTextures, warmUp, watchSceneTarget } from './warmUp';
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
  /** Fine tone adjustment of the skin set, -1 lighter .. 1 darker; needs no reload. */
  skinTone?: number;
  /** Eyeball maps; converted heads carry none, so the eyes are white without one. */
  iris?: MhIris | null;
  /**
   * Heads the face leans towards (same topology as the worn head): positions,
   * morphs and eye joints are blended when the character assembles.
   */
  blend?: readonly FaceBlendWear[];
  /** Colour laid over the iris (null: its own); needs no reload. */
  irisTint?: IrisTint | null;
  /** Idle body clips (GLB animations targeting MetaHuman bone names). */
  idleClips?: readonly string[];
  /** How much of the body the idle clips drive; the procedural layer does the rest. */
  idleLayer?: MocapLayer;
  /** Full-body gestures played while the character speaks. */
  talkClips?: readonly string[];
  /** Full-body listening clips, mixed in with the idles while it listens. */
  listenClips?: readonly string[];
  /** Hair and facial hair cards, fitted to this head; recolouring needs no reload. */
  grooms?: readonly GroomWear[];
  /** Garments bound to the body skeleton; recolouring needs no reload. */
  outfits?: readonly OutfitWear[];
  /** Called every frame after the mixer and before rendering (life, lip-sync). */
  onFrame?: (handle: MhCharacterHandle, delta: number, camera: Camera) => void;
  /**
   * Called once the skin, eyes and grooms of the current props are on (or
   * failed and were skipped); again after every change that reloads them.
   * Never after the unmount, nor for a state a newer change overtook.
   */
  onSettled?: (handle: MhCharacterHandle) => void;
  /** Called when a change starts reloading any of them (and on mount); onSettled follows. */
  onUnsettled?: (handle: MhCharacterHandle) => void;
  /**
   * Upload every texture and compile every material before reporting settled,
   * a texture per frame. For a character assembled off screen: shown without
   * it, its first frame uploads all its maps at once and the stage freezes.
   */
  prewarm?: boolean;
  /** The body wears an underwear top where no top covers it (women); briefs always. */
  underwearTop?: boolean;
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
    skinTone = 0,
    iris = null,
    irisTint = null,
    blend = NO_BLEND,
    idleClips = NO_CLIPS,
    idleLayer = 'full',
    talkClips = NO_CLIPS,
    listenClips = NO_CLIPS,
    grooms = NO_GROOMS,
    outfits = NO_OUTFITS,
    onFrame,
    onSettled,
    onUnsettled,
    prewarm = false,
    underwearTop = false,
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
  const latestOnUnsettled = useRef(onUnsettled);
  const warm = useRef<{ enabled: boolean; camera: Camera; scene: Scene }>({
    enabled: prewarm,
    camera,
    scene,
  });
  useLayoutEffect(() => {
    latestOnSettled.current = onSettled;
    latestOnUnsettled.current = onUnsettled;
    warm.current.enabled = prewarm;
    warm.current.camera = camera;
    warm.current.scene = scene;
    watchSceneTarget(scene);
  }, [onSettled, onUnsettled, prewarm, camera, scene]);
  const bodyGltf = useMhGltf(bodyUrl);
  const headGltf = useMhGltf(headUrl);
  // Keyed by value: a new array with the same heads and weights reuses the assembly.
  const blendKey = blend.map((b) => `${b.headUrl}@${b.weight}`).join('|');
  const blendUrls = useMemo(
    () => (blendKey ? blendKey.split('|').map((part) => part.slice(0, part.lastIndexOf('@'))) : []),
    [blendKey],
  );
  const blendGltfs = useMhGltfs(blendUrls);
  // Worked out a slice at a time while the character suspends (see preparedBlend).
  const prepared = use(preparedBlend(headUrl, headGltf, blendKey, blendGltfs));

  const assembled = useMemo(() => {
    const bodyRoot = cloneSkinned(bodyGltf.scene) as Object3D;
    const headRoot = cloneSkinned(headGltf.scene) as Object3D;
    const extras = mhExtras(bodyGltf.scene, bodyGltf.parser.json as { extras?: unknown });
    const headExtras = mhExtras(headGltf.scene, headGltf.parser.json as { extras?: unknown });
    const body = createBodyRig(bodyRoot, (extras.body_joint_deltas ?? {}) as JointDeltas);
    // Read before attachHead moves the face-only bones under the body's.
    const headBones = [...collectBones(headRoot).values()];
    const headMeshes = attachHead(headRoot, body);
    if (prepared) {
      const ownBones = new Set(headBones.filter((bone) => !body.bones.has(bone.name)));
      applyFaceBlend(headMeshes, ownBones, prepared);
    }
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
      // A blended head owns its geometries (and their morph textures); a plain one shares the loader's.
      ownGeometries: prepared ? headMeshes.map((mesh) => mesh.geometry) : [],
    };
  }, [bodyGltf, headGltf, prepared]);

  // Numbers settled states. A change that reloads a part and the unmount bump
  // it too, so a warm-up they overtook stops where it is and reports nothing.
  const runs = useRef(0);
  useEffect(
    () => () => {
      runs.current += 1;
    },
    [],
  );
  const unsettle = useCallback(
    (part: keyof typeof settled.current) => {
      settled.current[part] = false;
      runs.current += 1;
      latestOnUnsettled.current?.(assembled.handle);
    },
    [assembled],
  );
  const settle = useCallback(
    (part: keyof typeof settled.current) => {
      settled.current[part] = true;
      const { skin: skinDone, grooms: groomsDone, outfits: outfitsDone } = settled.current;
      if (!skinDone || !groomsDone || !outfitsDone) return;
      const run = ++runs.current;
      const current = () => run === runs.current;
      const { enabled, camera: view, scene: world } = warm.current;
      if (!enabled) {
        latestOnSettled.current?.(assembled.handle);
        return;
      }
      void warmUp(gl, assembled.root, view, world, current)
        // A failed warm-up costs a slow first frame, not the swap: report anyway.
        .catch((error: unknown) => console.warn('[mh] warm-up failed', error))
        .then(() => {
          if (current()) latestOnSettled.current?.(assembled.handle);
        });
    },
    [gl, assembled],
  );
  /**
   * Uploads the textures of parts about to go on (or of the hidden character)
   * a frame at a time and compiles their shaders off the main thread, so the
   * frame that first draws them does not stall the page. A failure only costs
   * that slow frame. Resolves whether `current` still holds.
   */
  const prepare = useCallback(
    (parts: Object3D | readonly Object3D[], current: () => boolean) =>
      warmUp(gl, parts, warm.current.camera, warm.current.scene, current).catch(
        (error: unknown) => {
          console.warn('[mh] warm-up failed', error);
          return current();
        },
      ),
    [gl],
  );

  // A converted head has no maps of its own: hide it rather than show it white.
  // Before the first frame, which would otherwise also compile and upload a
  // map-less skin it never keeps.
  useLayoutEffect(() => {
    if (skin && !hasMaps(assembled.skins)) setVisible(assembled.root, false);
  }, [assembled, skin]);

  useEffect(() => {
    unsettle('skin');
    if (!skin && !iris) {
      setVisible(assembled.root, true);
      settle('skin');
      return;
    }
    let live = true;
    const current = () => live;
    const hidden = !assembled.root.visible;
    void Promise.all([
      skippingFailure(skin && loadSkinTextures(gl, skin, { makeup })),
      skippingFailure(iris && loadIrisTextures(gl, iris)),
    ])
      .then(async ([skinMaps, irisMaps]) => {
        // On screen, new maps would all upload in the frame that binds them.
        if (!(await uploadTextures(gl, texturesIn([skinMaps, irisMaps]), current))) return;
        if (skinMaps) bindSkinTextures(assembled.skins, skinMaps);
        if (irisMaps) bindIrisTextures(assembled.eyes, irisMaps);
        // The first maps change the skin and eye shaders: compile before showing them.
        if (hidden && !(await prepare(assembled.root, current))) return;
        setVisible(assembled.root, true);
        settle('skin');
      })
      .catch((error: unknown) => {
        console.warn('[mh] texture upload failed', error);
        if (!live) return;
        setVisible(assembled.root, true);
        settle('skin');
      });
    return () => {
      live = false;
    };
  }, [assembled, gl, skin, makeup, iris, settle, unsettle, prepare]);

  useEffect(() => {
    let live = true;
    void loadSkinDetail().then((detail) => {
      if (live) setSkinDetail(assembled.skins, detail);
    });
    return () => {
      live = false;
      for (const material of [...assembled.skins, ...assembled.eyes]) material.dispose();
      for (const geometry of assembled.ownGeometries) geometry.dispose();
    };
  }, [assembled]);

  // One key for all roles: the effect reloads when any set changes.
  const clipKey = [idleClips, talkClips, listenClips].map((urls) => urls.join('|')).join('#');
  useEffect(() => {
    const [idle = [], talk = [], listen = []] = clipKey
      .split('#')
      .map((urls) => (urls ? urls.split('|') : []));
    if (idle.length === 0) return;
    let live = true;
    let player: MotionPlayer | null = null;
    void Promise.all([loadClips(idle), loadClips(talk), loadClips(listen)])
      .then(([idleSet, talkSet, listenSet]) => {
        if (!live || idleSet.length === 0) return;
        const body = assembled.handle.body;
        player = new MotionPlayer(
          assembled.root,
          { idle: idleSet, talk: talkSet, listen: listenSet },
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
    (
      next: WornGroom[],
      files: (string | null)[],
      layers: WebGLRenderTarget | null,
      painted: boolean[] = [],
    ) => {
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
        painted,
      );
      density.current?.dispose();
      density.current = layers;
    },
    [assembled],
  );
  useEffect(() => () => swapGrooms([], [], null), [swapGrooms]);
  useEffect(() => {
    const head = assembled.headSkin;
    unsettle('grooms');
    if (!groomKey || !head) {
      swapGrooms([], [], null);
      settle('grooms');
      return;
    }
    let live = true;
    const wears = latestGrooms.current;
    // Painted grooms have no cards: the skin draws them from the density pack.
    const carded = wears.filter((wear) => wear.groom.glb);
    const fitted = Promise.allSettled(
      carded.map((wear) => wearGroom(gl, wear, head, hairLod)),
    ).then((results) =>
      results.flatMap((result, i) => {
        if (result.status === 'fulfilled') return [result.value];
        console.warn('[mh] groom failed to load', carded[i]?.groom.id, result.reason);
        return [];
      }),
    );
    const files = densityFiles(wears);
    const painted = paintedSlots(wears);
    const layers: Promise<WebGLRenderTarget | null> = files.some(Boolean)
      ? Promise.all(files.map((file) => (file ? loadAssetTexture(gl, file, 'data') : null))).then(
          (textures) => packGroomDensity(gl, textures, painted.some(Boolean)),
          (error: unknown) => {
            console.warn('[mh] groom density failed to load', error);
            return null;
          },
        )
      : Promise.resolve(null);
    void Promise.all([fitted, layers]).then(async ([next, packed]) => {
      for (const groom of next) {
        const look = latestGrooms.current.find((wear) => wear.groom.id === groom.id)?.look;
        if (look) setHairLook(groom.materials, look);
      }
      // The hair on now stays while the new cards upload and compile.
      const cards = next.flatMap((groom) => groom.meshes);
      if (live) await prepare(cards, () => live);
      if (!live) {
        for (const groom of next) groom.dispose();
        packed?.dispose();
        return;
      }
      swapGrooms(next, files, packed, painted);
      settle('grooms');
    });
    return () => {
      live = false;
    };
  }, [assembled, gl, groomKey, hairLod, settle, unsettle, swapGrooms, prepare]);

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
  // Lifts the character onto its shoes' soles (the bare feet stand on the floor).
  const stand = useRef<Group>(null);
  const swapOutfits = useCallback(
    (next: WornOutfit[], release = false) => {
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
      wornOutfits.current = next;
      // In the same frame as the shoes, so they never show sunk into the floor.
      if (stand.current) stand.current.position.y = Math.max(0, ...next.map((worn) => worn.sole));
      layerOutfits(next, body);
      presetSkinnedBounds(assembled.root);
      // Teardown (release) leaves the shared mask to the character that set it last.
      if (release) releaseBodyHide(body.mesh);
      else
        applyBodyHide(
          body.mesh,
          next.flatMap((worn) => (worn.hide ? [worn.hide] : [])),
        );
      // In the same frame as the garments, so a change never flashes bare skin.
      const worn = new Set(next.map((outfit) => outfit.category));
      const full = worn.has('full');
      setUnderwear(assembled.skins, {
        top: underwearTop && !full && !worn.has('top'),
        bottom: !full && !worn.has('bottom'),
      });
    },
    [assembled, underwearTop],
  );
  useEffect(() => () => swapOutfits([], true), [swapOutfits]);
  useEffect(() => {
    if (assembled) setSkinTone(assembled.skins, skinTone);
  }, [assembled, skinTone]);
  const [tintR, tintG, tintB] = irisTint?.color ?? [];
  const tintReference = irisTint?.reference;
  useEffect(() => {
    const tint =
      tintR === undefined || tintG === undefined || tintB === undefined
        ? null
        : { color: [tintR, tintG, tintB] as IrisTint['color'], reference: tintReference ?? 1 };
    setIrisTint(assembled.eyes, tint);
  }, [assembled, tintR, tintG, tintB, tintReference]);
  useEffect(() => {
    unsettle('outfits');
    const wears = latestOutfits.current;
    if (!outfitKey) {
      swapOutfits([]);
      settle('outfits');
      return;
    }
    let live = true;
    const body = assembled.handle.body;
    void Promise.allSettled(wears.map((wear) => wearOutfit(gl, wear, body))).then(
      async (results) => {
        const next: WornOutfit[] = [];
        results.forEach((result, i) => {
          if (result.status === 'fulfilled') next.push(result.value);
          else console.warn('[mh] outfit failed to load', wears[i]?.outfit.id, result.reason);
        });
        for (const worn of next) {
          const colors = latestOutfits.current.find((wear) => wear.outfit.id === worn.id)?.colors;
          if (colors) setOutfitColors(worn, colors);
        }
        // The clothes on now stay while the new ones upload and compile.
        const garments = next.flatMap((worn) => worn.meshes);
        if (live) await prepare(garments, () => live);
        if (!live) {
          for (const worn of next) worn.dispose();
          return;
        }
        swapOutfits(next);
        settle('outfits');
      },
    );
    return () => {
      live = false;
    };
  }, [assembled, gl, outfitKey, settle, unsettle, swapOutfits, prepare]);

  useEffect(() => {
    for (const wear of outfits) {
      const worn = wornOutfits.current.find((candidate) => candidate.id === wear.outfit.id);
      if (worn) setOutfitColors(worn, wear.colors);
    }
  }, [outfits]);

  useImperativeHandle(ref, () => assembled.handle, [assembled]);

  // By value: any edit brings an equal but new sliders object (see bodySliderKey).
  const sliderKey = bodySliderKey(sliders);
  const latestSliders = useRef(sliders);
  useLayoutEffect(() => {
    latestSliders.current = sliders;
  }, [sliders]);
  useLayoutEffect(() => {
    applyBodySliders(assembled.handle.body, latestSliders.current ?? {});
  }, [assembled, sliderKey]);
  // Layering walks every vertex of the clothes: it waits for the sliders to rest.
  useEffect(() => {
    const timer = window.setTimeout(
      () => layerOutfits(wornOutfits.current, assembled.handle.body),
      LAYER_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [assembled, sliderKey]);

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

  return (
    // A parent, like the turntable: skinned meshes bound later keep their bind
    // matrices valid however far it lifts the character.
    <group ref={stand}>
      <primitive object={assembled.root} />
    </group>
  );
});

/** Quiet period (ms) after the last slider change before the clothes are layered again. */
const LAYER_DELAY_MS = 150;
const NO_CLIPS: readonly string[] = [];
const NO_GROOMS: readonly GroomWear[] = [];
const NO_OUTFITS: readonly OutfitWear[] = [];
const NO_BLEND: readonly FaceBlendWear[] = [];

const clipCache = new Map<string, Promise<MotionClip[]>>();

/** Face blends worked out lately, by worn head and blend: the stage holds at most two characters. */
const blendCache = new Map<string, Promise<PreparedBlend | null>>();
const BLEND_CACHE_SIZE = 2;
const NO_PREPARED_BLEND = Promise.resolve(null);

/**
 * The prepared blend of a worn head towards the blend GLBs (`blendKey` lists
 * their URLs and weights in order), one promise per blend for `use`: the
 * character suspends while it is worked out a few milliseconds at a time,
 * instead of freezing the stage while it assembles.
 */
function preparedBlend(
  headUrl: string,
  head: GLTF,
  blendKey: string,
  sources: readonly GLTF[],
): Promise<PreparedBlend | null> {
  if (!blendKey) return NO_PREPARED_BLEND;
  const key = `${headUrl}#${blendKey}`;
  let promise = blendCache.get(key);
  if (!promise) {
    const weights = blendKey.split('|').map((part) => Number(part.split('@').pop()));
    promise = prepareFaceBlend(
      head.scene,
      sources.map((gltf, k) => ({ root: gltf.scene, weight: weights[k] ?? 0 })),
    ).catch((error: unknown) => {
      // The preset face is still a face: show it rather than fail the stage.
      console.warn('[mh] face blend failed', error);
      return null;
    });
    blendCache.set(key, promise);
    while (blendCache.size > BLEND_CACHE_SIZE) blendCache.delete(blendCache.keys().next().value!);
  }
  return promise;
}

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
          .setMeshoptDecoder(meshoptDecoder())
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

/** A texture set, or null when there is none or it failed (missing files must not take the character down). */
function skippingFailure<T>(job: Promise<T> | null): Promise<T | null> {
  if (!job) return Promise.resolve(null);
  return job.catch((error: unknown) => {
    console.warn('[mh] texture set failed', error);
    return null;
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
