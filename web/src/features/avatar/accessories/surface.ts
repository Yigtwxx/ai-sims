import {
  Matrix4,
  Vector2,
  Vector3,
  type BufferAttribute,
  type Material,
  type Mesh,
  type Object3D,
  type SkinnedMesh,
  type Texture,
} from 'three';

/**
 * Posed, world-space samples of a character's visible surface. Rig-agnostic:
 * which mesh is skin, hair or clothing is decided by a `RoleClassifier`
 * supplied by the rig adapter (see vroid.ts for the VRoid naming scheme).
 * Skinned meshes are evaluated with their current morphs and bone transforms
 * (getVertexPosition), so a fit matches what is on screen.
 */

export type SurfaceRole =
  'face' | 'body' | 'hair' | 'top' | 'bottom' | 'shoes' | 'accessory' | 'other';

/** Maps a mesh (and its first material's name) to a surface role. */
export type RoleClassifier = (mesh: Mesh, materialName: string) => SurfaceRole;

export interface SurfaceMesh {
  mesh: Mesh;
  role: SurfaceRole;
  /** World positions, xyz per vertex. */
  positions: Float32Array;
  /** Triangle indices of the full surface (before any coverage culling). */
  index: ArrayLike<number>;
  /** Per-vertex texture opacity for cutout materials; undefined when fully opaque. */
  opacity?: Float32Array;
}

type TexturedMaterial = Material & { map?: Texture | null; alphaTest: number };

const ALPHA_SAMPLE_SIZE = 256;
const alphaCache = new WeakMap<Texture, ((u: number, v: number) => number) | null>();

/** Reads a texture's alpha at a UV (downsampled once per texture, browser only). */
function alphaSampler(texture: Texture): ((u: number, v: number) => number) | null {
  if (alphaCache.has(texture)) return alphaCache.get(texture) ?? null;
  let sampler: ((u: number, v: number) => number) | null = null;
  const image = texture.image as CanvasImageSource | undefined;
  const context =
    image && typeof document !== 'undefined'
      ? document.createElement('canvas').getContext('2d', { willReadFrequently: true })
      : null;
  if (image && context) {
    context.canvas.width = context.canvas.height = ALPHA_SAMPLE_SIZE;
    context.drawImage(image, 0, 0, ALPHA_SAMPLE_SIZE, ALPHA_SAMPLE_SIZE);
    const pixels = context.getImageData(0, 0, ALPHA_SAMPLE_SIZE, ALPHA_SAMPLE_SIZE).data;
    const uv = new Vector2();
    const last = ALPHA_SAMPLE_SIZE - 1;
    sampler = (u, v) => {
      // transformUv applies the texture matrix, wrapping and flipY.
      texture.transformUv(uv.set(u, v));
      const x = Math.min(last, Math.max(0, Math.floor(uv.x * ALPHA_SAMPLE_SIZE)));
      const y = Math.min(last, Math.max(0, Math.floor(uv.y * ALPHA_SAMPLE_SIZE)));
      return pixels[(y * ALPHA_SAMPLE_SIZE + x) * 4 + 3] / 255;
    };
  }
  alphaCache.set(texture, sampler);
  return sampler;
}

export function firstMaterial(mesh: Mesh): TexturedMaterial {
  return (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as TexturedMaterial;
}

function isShown(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/** World position of one vertex in the current pose (morphs, then skinning). */
export function posedVertex(mesh: Mesh, index: number, target: Vector3): Vector3 {
  mesh.getVertexPosition(index, target);
  return target.applyMatrix4(mesh.matrixWorld);
}

const _v = new Vector3();

/** Sample one mesh: posed positions, full index and texture opacity. */
export function sampleMesh(mesh: Mesh, classify: RoleClassifier): SurfaceMesh {
  const material = firstMaterial(mesh);
  const geometry = mesh.geometry;
  const count = geometry.getAttribute('position').count;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    posedVertex(mesh, i, _v);
    positions[i * 3] = _v.x;
    positions[i * 3 + 1] = _v.y;
    positions[i * 3 + 2] = _v.z;
  }
  // Skin-coverage culling swaps the index; keep measuring the complete surface.
  const original =
    (geometry.userData.originalIndex as BufferAttribute | undefined) ?? geometry.index ?? null;
  const index = original ? original.array : Uint32Array.from({ length: count }, (_, i) => i);

  let opacity: Float32Array | undefined;
  const uv = geometry.getAttribute('uv');
  const cutout = (material.alphaTest ?? 0) > 0 || material.transparent;
  const sample = material.map && uv && cutout ? alphaSampler(material.map) : null;
  if (sample && uv) {
    opacity = new Float32Array(count);
    for (let i = 0; i < count; i++) opacity[i] = sample(uv.getX(i), uv.getY(i));
  }
  return { mesh, role: classify(mesh, material.name ?? ''), positions, index, opacity };
}

/** Sample every shown mesh under `root` whose role passes `accept`. */
export function sampleSurfaces(
  root: Object3D,
  classify: RoleClassifier,
  accept: (role: SurfaceRole) => boolean,
): SurfaceMesh[] {
  const meshes: Mesh[] = [];
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (mesh.isMesh && isShown(mesh) && accept(classify(mesh, firstMaterial(mesh).name ?? '')))
      meshes.push(mesh);
  });
  return meshes.map((mesh) => sampleMesh(mesh, classify));
}

/** True when the triangle's texture is opaque at all three corners. */
export function triangleOpaque(surface: SurfaceMesh, tri: number, cutoff = 0.5): boolean {
  const o = surface.opacity;
  if (!o) return true;
  const { index } = surface;
  return (
    o[index[tri * 3]] >= cutoff &&
    o[index[tri * 3 + 1]] >= cutoff &&
    o[index[tri * 3 + 2]] >= cutoff
  );
}

// ---------------------------------------------------------------------------
// Skin weights

/** True for `bone` itself and all of its descendants. */
export function isUnder(bone: Object3D): (node: Object3D) => boolean {
  return (node) => {
    for (let o: Object3D | null = node; o; o = o.parent) if (o === bone) return true;
    return false;
  };
}

/** Total skin weight per vertex carried by bones for which `accept` is true. */
export function boneWeights(mesh: Mesh, accept: (bone: Object3D) => boolean): Float32Array {
  const geometry = mesh.geometry;
  const count = geometry.getAttribute('position').count;
  const out = new Float32Array(count);
  const skinned = mesh as SkinnedMesh;
  const indices = geometry.getAttribute('skinIndex');
  const weights = geometry.getAttribute('skinWeight');
  if (!skinned.isSkinnedMesh || !indices || !weights) {
    // A rigid mesh follows its parent chain as a whole.
    let followed = false;
    for (let o: Object3D | null = mesh; o; o = o.parent) if (accept(o)) followed = true;
    return out.fill(followed ? 1 : 0);
  }
  const accepted = skinned.skeleton.bones.map((bone) => accept(bone));
  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      const w = weights.getComponent(i, k);
      if (w > 0 && accepted[indices.getComponent(i, k)]) sum += w;
    }
    out[i] = sum;
  }
  return out;
}

/**
 * The bone carrying the most skin weight over a set of vertices: the natural
 * parent for an accessory resting on them. Rigid meshes report their parent.
 */
export function dominantBone(mesh: Mesh, vertices: Iterable<number>): Object3D | undefined {
  const skinned = mesh as SkinnedMesh;
  const indices = mesh.geometry.getAttribute('skinIndex');
  const weights = mesh.geometry.getAttribute('skinWeight');
  if (!skinned.isSkinnedMesh || !indices || !weights) return mesh.parent ?? undefined;
  const totals = new Map<number, number>();
  for (const v of vertices) {
    for (let k = 0; k < 4; k++) {
      const w = weights.getComponent(v, k);
      if (w <= 0) continue;
      const b = indices.getComponent(v, k);
      totals.set(b, (totals.get(b) ?? 0) + w);
    }
  }
  let best = -1;
  let bestWeight = 0;
  for (const [b, w] of totals) {
    if (w > bestWeight) {
      best = b;
      bestWeight = w;
    }
  }
  return best >= 0 ? skinned.skeleton.bones[best] : undefined;
}

// ---------------------------------------------------------------------------
// Frames

/** An orthonormal frame: x = character's left, y = up, z = forward. */
export interface Frame {
  origin: Vector3;
  x: Vector3;
  y: Vector3;
  z: Vector3;
}

/**
 * Frame from a lateral direction (toward the character's left) and an
 * approximate up: up is made perpendicular, forward = left x up.
 */
export function frameFromAxes(origin: Vector3, left: Vector3, up: Vector3): Frame | undefined {
  const x = left.clone();
  if (x.lengthSq() < 1e-12) return undefined;
  x.normalize();
  const y = up.clone().addScaledVector(x, -up.dot(x));
  if (y.lengthSq() < 1e-12) return undefined;
  y.normalize();
  const z = new Vector3().crossVectors(x, y).normalize();
  return { origin: origin.clone(), x, y, z };
}

/** Head frame from the two eye positions (origin between them) and the head's up. */
export function headFrameFromEyes(leftEye: Vector3, rightEye: Vector3, up: Vector3) {
  const origin = leftEye.clone().add(rightEye).multiplyScalar(0.5);
  return frameFromAxes(origin, leftEye.clone().sub(rightEye), up);
}

/** Upright body frame (y = world up) at `origin`, left from a left/right joint pair. */
export function uprightFrame(origin: Vector3, leftJoint: Vector3, rightJoint: Vector3) {
  const left = leftJoint.clone().sub(rightJoint);
  left.y = 0;
  return frameFromAxes(origin, left, new Vector3(0, 1, 0));
}

export function frameToLocal(frame: Frame, world: Vector3, target: Vector3): Vector3 {
  _v.subVectors(world, frame.origin);
  return target.set(_v.dot(frame.x), _v.dot(frame.y), _v.dot(frame.z));
}

export function frameToWorld(
  frame: Frame,
  x: number,
  y: number,
  z: number,
  target: Vector3,
): Vector3 {
  return target
    .copy(frame.origin)
    .addScaledVector(frame.x, x)
    .addScaledVector(frame.y, y)
    .addScaledVector(frame.z, z);
}

/** World matrix whose basis is the frame axes (columns x, y, z) at its origin. */
export function frameMatrix(frame: Frame, target = new Matrix4()): Matrix4 {
  return target.makeBasis(frame.x, frame.y, frame.z).setPosition(frame.origin);
}

/** World positions (all, or the listed vertices) in frame coordinates, xyz interleaved. */
export function toFrameCoords(
  frame: Frame,
  positions: ArrayLike<number>,
  vertices?: ArrayLike<number>,
): Float32Array {
  const n = vertices ? vertices.length : Math.floor(positions.length / 3);
  const out = new Float32Array(n * 3);
  const { origin, x, y, z } = frame;
  for (let k = 0; k < n; k++) {
    const i = vertices ? vertices[k] : k;
    const dx = positions[i * 3] - origin.x;
    const dy = positions[i * 3 + 1] - origin.y;
    const dz = positions[i * 3 + 2] - origin.z;
    out[k * 3] = dx * x.x + dy * x.y + dz * x.z;
    out[k * 3 + 1] = dx * y.x + dy * y.y + dz * y.z;
    out[k * 3 + 2] = dx * z.x + dy * z.y + dz * z.z;
  }
  return out;
}
