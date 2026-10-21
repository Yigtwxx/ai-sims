import {
  DoubleSide,
  type BufferAttribute,
  type MeshStandardMaterial,
  type Object3D,
  type SkinnedMesh,
  type WebGLRenderer,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

import { assetUrl, type MhOutfit } from '@/lib/assets/manifest';

import { mhExtras, type BodyRig } from './assembly';
import { acquireChannelPack } from './channelPack';
import { colorsByMaterial, planFabric, type FabricSlot, type OutfitMaterialSpec } from './fabric';
import {
  createFabricMaterial,
  setFabricColors,
  type FabricMaterial,
  type FabricTextures,
} from './fabricMaterial';
import { bindGarment, decodeHideBitset, syncGarmentMorphs } from './garments';
import type { Rgb } from './hairColor';
import { configureLoader } from './loaders';
import { loadAssetTexture } from './skinTextures';

/** An outfit item to wear on this body: its GLB and the creator's colours (linear). */
export interface OutfitWear {
  outfit: MhOutfit;
  file: string;
  colors: Record<string, Rgb>;
}

/** An outfit put on one character. */
export interface WornOutfit {
  id: string;
  meshes: SkinnedMesh[];
  /** Fabric materials by glTF material name (jeans and plain parts keep the GLB's). */
  fabrics: Map<string, FabricMaterial>;
  /** Body vertices the garment covers (null: hides nothing). */
  hide: Uint8Array | null;
  dispose(): void;
}

const gltfs = new Map<string, Promise<GLTF>>();

function loadGltf(renderer: WebGLRenderer, url: string): Promise<GLTF> {
  let pending = gltfs.get(url);
  if (!pending) {
    const loader = new GLTFLoader();
    configureLoader(loader, renderer);
    pending = loader.loadAsync(url);
    pending.catch(() => gltfs.delete(url));
    gltfs.set(url, pending);
  }
  return pending;
}

function skinnedMeshes(root: Object3D): SkinnedMesh[] {
  const meshes: SkinnedMesh[] = [];
  root.traverse((node) => {
    if ((node as SkinnedMesh).isSkinnedMesh) meshes.push(node as SkinnedMesh);
  });
  return meshes;
}

interface HeldTextures extends FabricTextures {
  /** Lets go of the shared packs. */
  release(): void;
}

/** The planned detail maps and packs of one fabric part. */
async function fabricTextures(
  renderer: WebGLRenderer,
  spec: OutfitMaterialSpec,
): Promise<HeldTextures> {
  const plan = planFabric(spec);
  const own = Object.entries(plan.maps) as [FabricSlot, string][];
  const packs = plan.packs.map((files) => acquireChannelPack(renderer, files));
  const release = () => {
    for (const pack of packs) pack.release();
  };
  try {
    const [maps, packed] = await Promise.all([
      Promise.all(own.map(([, file]) => loadAssetTexture(renderer, file, 'data'))),
      Promise.all(packs.map((pack) => pack.texture)),
    ]);
    return {
      maps: Object.fromEntries(own.map(([slot], i) => [slot, maps[i]])),
      packs: packed,
      release,
    };
  } catch (error) {
    release();
    throw error;
  }
}

/**
 * Loads an outfit GLB, binds its garments to the body skeleton (they follow
 * its slider morphs from then on) and gives fabric parts the fabric shader.
 * The caller adds `meshes` to the character, lists them in `body.garments`
 * and hides the skin under them (see ./garments.ts).
 */
export async function wearOutfit(
  renderer: WebGLRenderer,
  wear: OutfitWear,
  body: BodyRig,
): Promise<WornOutfit> {
  const gltf = await loadGltf(renderer, assetUrl(wear.file));
  const extras = mhExtras(gltf.scene, gltf.parser.json as { extras?: unknown });
  const specs = (extras.materials ?? {}) as Record<string, OutfitMaterialSpec>;
  const root = cloneSkinned(gltf.scene);
  const meshes = skinnedMeshes(root);
  if (meshes.length === 0) throw new Error(`No garment mesh in ${wear.file}`);

  const sources = new Map(
    meshes.map((mesh) => {
      const source = mesh.material as MeshStandardMaterial;
      return [source.name, source] as const;
    }),
  );
  const fabricNames = [...sources.keys()].filter((name) => specs[name]?.shader === 'mh-fabric-v1');
  // Settle every part before failing, so no part keeps a hold on its packs.
  const loaded = await Promise.allSettled(
    fabricNames.map(async (name) => [name, await fabricTextures(renderer, specs[name]!)] as const),
  );
  const held = loaded.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  const failure = loaded.find((result) => result.status === 'rejected');
  if (failure) {
    for (const [, textures] of held) textures.release();
    throw failure.reason;
  }

  const fabrics = new Map<string, FabricMaterial>();
  const colors = colorsByMaterial(wear.colors, Object.keys(specs));
  for (const [name, textures] of held) {
    const fabric = createFabricMaterial(name, specs[name]!, sources.get(name)!, textures);
    setFabricColors(fabric, colors.get(name) ?? {});
    fabrics.set(name, fabric);
  }

  for (const mesh of meshes) {
    const source = mesh.material as MeshStandardMaterial;
    const fabric = fabrics.get(source.name);
    if (fabric) mesh.material = fabric.material;
    else source.side = DoubleSide;
    // bindGarment rewrites skin indices: never touch the cached GLB's geometry.
    mesh.geometry = mesh.geometry.clone();
    bindGarment(mesh, body);
    mesh.position.copy(body.mesh.position);
    mesh.quaternion.copy(body.mesh.quaternion);
    mesh.scale.copy(body.mesh.scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `${wear.outfit.category}_${mesh.name}`;
    syncGarmentMorphs(mesh, body);
  }

  const bitset = typeof extras.body_hide === 'string' ? extras.body_hide : null;
  const bodyVertices = (body.mesh.geometry.getAttribute('position') as BufferAttribute).count;
  return {
    id: wear.outfit.id,
    meshes,
    fabrics,
    hide: bitset ? decodeHideBitset(bitset, bodyVertices) : null,
    dispose() {
      for (const mesh of meshes) mesh.geometry.dispose();
      for (const fabric of fabrics.values()) fabric.material.dispose();
      for (const [, textures] of held) textures.release();
    },
  };
}

/** Recolours a worn outfit (creator colour change, no reload). */
export function setOutfitColors(worn: WornOutfit, colors: Readonly<Record<string, Rgb>>): void {
  const byMaterial = colorsByMaterial(colors, [...worn.fabrics.keys()]);
  for (const [name, fabric] of worn.fabrics) setFabricColors(fabric, byMaterial.get(name) ?? {});
}
