import {
  SkinnedMesh,
  type BufferGeometry,
  type Mesh,
  type Object3D,
  type WebGLRenderer,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { assetUrl, type MhGroom } from '@/lib/assets/manifest';

import { bindToHead, fitCards, headPositionTable, strandProgress } from './grooms';
import {
  createHairMaterials,
  setHairLook,
  type HairLook,
  type HairMaterials,
} from './hairMaterial';
import { configureLoader } from './loaders';
import { loadAssetTexture } from './skinTextures';

/** A groom to wear and how to colour it. */
export interface GroomWear {
  groom: MhGroom;
  look: HairLook;
}

/** A groom put on one character: two passes of the same fitted cards. */
export interface WornGroom {
  id: string;
  meshes: SkinnedMesh[];
  materials: HairMaterials;
  dispose(): void;
}

interface CardsAsset {
  source: SkinnedMesh;
  joints: string[];
  progress: Float32Array;
}

/**
 * Card meshes by level of detail, preferred first: the converter writes
 * cards_lod0 (full) and cards_lod2 (about two thirds of the cards).
 */
const CARD_NODES: Record<0 | 1, string[]> = {
  0: ['cards_lod0', 'cards_lod2'],
  1: ['cards_lod2', 'cards_lod0'],
};

const gltfs = new Map<string, Promise<GLTF>>();
const assets = new Map<string, Promise<CardsAsset>>();

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

function loadCards(renderer: WebGLRenderer, url: string, lod: 0 | 1): Promise<CardsAsset> {
  const key = `${url}#${lod}`;
  let pending = assets.get(key);
  if (!pending) {
    pending = loadGltf(renderer, url).then((gltf) => {
      const meshes: SkinnedMesh[] = [];
      gltf.scene.traverse((node) => {
        if ((node as SkinnedMesh).isSkinnedMesh) meshes.push(node as SkinnedMesh);
      });
      const source =
        CARD_NODES[lod].map((name) => meshes.find((mesh) => mesh.name === name)).find(Boolean) ??
        meshes[0];
      if (!source) throw new Error(`No card mesh in ${url}`);
      return {
        source,
        joints: source.skeleton.bones.map((bone) => bone.name),
        progress: strandProgress(source.geometry),
      };
    });
    pending.catch(() => assets.delete(key));
    assets.set(key, pending);
  }
  return pending;
}

/**
 * The textures the cards' UVs map: the cards atlas (attribute + tangent) for
 * nearly every groom, the root-UV/seed/coverage set for the few exported with
 * Unreal's other card layout.
 */
export function cardAtlas(groom: MhGroom): {
  coverage: string;
  tangent: string | undefined;
  coverageInAlpha: boolean;
} {
  const { attribute, tangent, rootUvSeedCoverage, tangentStrandU } = groom.textures;
  if (attribute) return { coverage: attribute, tangent, coverageInAlpha: false };
  if (rootUvSeedCoverage) {
    return { coverage: rootUvSeedCoverage, tangent: tangentStrandU, coverageInAlpha: true };
  }
  throw new Error(`Groom ${groom.id} has no card atlas`);
}

const headTables = new WeakMap<BufferGeometry, Float32Array | null>();

function headTable(head: SkinnedMesh): Float32Array | null {
  if (!headTables.has(head.geometry)) {
    headTables.set(head.geometry, headPositionTable(head.geometry));
  }
  return headTables.get(head.geometry)!;
}

/**
 * Loads a groom (cards GLB + atlas textures), fits its cards to this head and
 * skins them to the head's joints. The caller adds `meshes` to the character
 * and lists them with the face meshes so expressions and visemes move them.
 */
export async function wearGroom(
  renderer: WebGLRenderer,
  wear: GroomWear,
  head: SkinnedMesh,
  lod: 0 | 1 = 0,
): Promise<WornGroom> {
  const { groom } = wear;
  if (!groom.glb) throw new Error(`${groom.id} has no cards (it is painted on the skin)`);
  const atlas = cardAtlas(groom);
  const [cards, attribute, tangent] = await Promise.all([
    loadCards(renderer, assetUrl(groom.glb), lod),
    loadAssetTexture(renderer, atlas.coverage, 'data'),
    atlas.tangent ? loadAssetTexture(renderer, atlas.tangent, 'data') : Promise.resolve(null),
  ]);
  const geometry = fitCards(cards.source.geometry, headTable(head), cards.progress);
  const materials = createHairMaterials(groom.id, {
    attribute,
    tangent,
    coverageInAlpha: atlas.coverageInAlpha,
  });
  setHairLook(materials, wear.look);

  const meshes = [materials.core, materials.fringe].map((material) => {
    const mesh = new SkinnedMesh(geometry, material);
    mesh.name = `${groom.slot}_${material === materials.core ? 'core' : 'fringe'}`;
    mesh.morphTargetDictionary = { ...cards.source.morphTargetDictionary };
    mesh.morphTargetInfluences = new Array<number>(
      cards.source.morphTargetInfluences?.length ?? 0,
    ).fill(0);
    bindToHead(mesh, cards.joints, head);
    mesh.receiveShadow = true;
    return mesh;
  });
  meshes[0]!.castShadow = true;
  meshes[0]!.customDepthMaterial = materials.depth;

  return {
    id: groom.id,
    meshes,
    materials,
    dispose() {
      geometry.dispose();
      for (const material of [materials.core, materials.fringe, materials.depth]) {
        material.dispose();
      }
    },
  };
}

/** Removes a worn groom from the character and from its morph mesh list. */
export function takeOffGroom(root: Object3D, faceMeshes: Mesh[], worn: WornGroom): void {
  for (const mesh of worn.meshes) {
    root.remove(mesh);
    const i = faceMeshes.indexOf(mesh);
    if (i >= 0) faceMeshes.splice(i, 1);
  }
  worn.dispose();
}
