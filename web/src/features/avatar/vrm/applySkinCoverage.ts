import type { VRM } from '@pixiv/three-vrm';
import {
  BufferAttribute,
  Vector2,
  Vector3,
  type Material,
  type SkinnedMesh,
  type Texture,
} from 'three';

import { classifyMaterial } from './partCategories';
import {
  computeCoveredVertices,
  computeVertexNormals,
  filterCoveredTriangles,
} from './skinCoverage';

/**
 * Coverage cylinder around each skin normal (metres); see skinCoverage.ts.
 * Tuned for poke-through only: skin is hidden when it sits outside a garment
 * (garment below the surface); skin under a garment is left alone because the
 * opaque garment already hides it, and removing it opens holes at open edges.
 */
const COVER_LIMITS = { lateral: 0.016, inner: 0.045, outer: 0.004 };
const ALPHA_CUTOFF = 0.5;
const SAMPLE_SIZE = 256;

type AlphaSampler = (u: number, v: number) => number;

const samplers = new WeakMap<Texture, AlphaSampler>();

/** Read a garment texture's alpha at a UV (downsampled once and cached). */
function alphaSamplerFor(texture: Texture): AlphaSampler | undefined {
  const cached = samplers.get(texture);
  if (cached) return cached;
  const image = texture.image as CanvasImageSource | undefined;
  if (!image || typeof document === 'undefined') return undefined;

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SAMPLE_SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return undefined;
  context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  const pixels = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;

  const uv = new Vector2();
  const sampler: AlphaSampler = (u, v) => {
    // transformUv applies the texture matrix, wrapping and flipY.
    texture.transformUv(uv.set(u, v));
    const x = Math.min(SAMPLE_SIZE - 1, Math.max(0, Math.floor(uv.x * SAMPLE_SIZE)));
    const y = Math.min(SAMPLE_SIZE - 1, Math.max(0, Math.floor(uv.y * SAMPLE_SIZE)));
    return pixels[(y * SAMPLE_SIZE + x) * 4 + 3] / 255;
  };
  samplers.set(texture, sampler);
  return sampler;
}

function firstMaterial(mesh: SkinnedMesh): Material & { map?: Texture | null } {
  return (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as Material & {
    map?: Texture | null;
  };
}

function visibleSkinnedMeshes(vrm: VRM, roles: ReadonlySet<string>): SkinnedMesh[] {
  const meshes: SkinnedMesh[] = [];
  vrm.scene.traverse((obj) => {
    const mesh = obj as SkinnedMesh;
    if (
      mesh.isSkinnedMesh &&
      mesh.visible &&
      roles.has(classifyMaterial(firstMaterial(mesh).name))
    ) {
      meshes.push(mesh);
    }
  });
  return meshes;
}

const _vertex = new Vector3();

/** World-space skinned positions (current pose), optionally filtered per vertex. */
function skinnedPositions(mesh: SkinnedMesh, keep?: (index: number) => boolean): number[] {
  const out: number[] = [];
  const count = mesh.geometry.getAttribute('position').count;
  for (let i = 0; i < count; i++) {
    if (keep && !keep(i)) continue;
    mesh.getVertexPosition(i, _vertex);
    mesh.applyBoneTransform(i, _vertex);
    _vertex.applyMatrix4(mesh.matrixWorld);
    out.push(_vertex.x, _vertex.y, _vertex.z);
  }
  return out;
}

const SKIN_ROLES = new Set(['body']);
const GARMENT_ROLES = new Set(['top', 'bottom', 'shoes']);

/**
 * Recompute which base skin triangles are hidden under the donors' garments.
 * Call after donors are synced to the base pose; repeat when parts change.
 */
export function applySkinCoverage(base: VRM, donors: VRM[]): void {
  const garmentPoints: number[] = [];
  for (const donor of donors) {
    for (const mesh of visibleSkinnedMeshes(donor, GARMENT_ROLES)) {
      const map = firstMaterial(mesh).map;
      const sample = map ? alphaSamplerFor(map) : undefined;
      const uv = mesh.geometry.getAttribute('uv');
      const opaque =
        sample && uv ? (i: number) => sample(uv.getX(i), uv.getY(i)) >= ALPHA_CUTOFF : undefined;
      garmentPoints.push(...skinnedPositions(mesh, opaque));
    }
  }

  for (const skin of visibleSkinnedMeshes(base, SKIN_ROLES)) {
    const geometry = skin.geometry;
    const original =
      (geometry.userData.originalIndex as BufferAttribute | undefined) ?? geometry.index;
    if (!original) continue;
    geometry.userData.originalIndex = original;

    if (garmentPoints.length === 0) {
      geometry.setIndex(original);
      continue;
    }
    const positions = Float32Array.from(skinnedPositions(skin));
    const covered = computeCoveredVertices({
      skin: positions,
      normals: computeVertexNormals(positions, original.array),
      garments: Float32Array.from(garmentPoints),
      ...COVER_LIMITS,
    });
    geometry.setIndex(new BufferAttribute(filterCoveredTriangles(original.array, covered), 1));
  }
}
