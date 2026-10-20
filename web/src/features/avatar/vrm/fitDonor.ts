import { VRMHumanBoneList, type VRM, type VRMHumanBoneName } from '@pixiv/three-vrm';
import { Matrix4, Vector3, type Material, type Object3D, type SkinnedMesh } from 'three';

import { boneAxesOf, vectorToLocal, type AxisMap, type Vec3 } from './boneAxes';
import {
  fitHeadProfiles,
  fitLimbProfiles,
  headProfile,
  limbProfile,
  type BoneFit,
  type HeadProfile,
  type LimbProfile,
} from './fit';

/**
 * Body profiles and part fitting. A profile summarises a model's skin around
 * the head and each limb/torso segment (see fit.ts). Profiles of every source
 * model are baked into `profiles.json` (parts files don't carry their source
 * body); the base is measured live. A part is then scaled by the ratio of the
 * base profile to its source profile.
 */

export interface BodyProfile {
  head?: HeadProfile;
  limbs: Partial<Record<VRMHumanBoneName, LimbProfile>>;
}

export interface PreparedFit {
  /** Rest-pose axes of the donor's joints. */
  axes: (bone: Object3D) => AxisMap;
  /** Fit scale per humanoid bone, canonical axes. */
  scale: (name: string) => Vec3 | undefined;
  /** Contents offset per donor raw bone, in that bone's local axes (metres at height 1). */
  offsets: Map<Object3D, Vector3>;
}

const HEAD_RANGE = { min: 0.9, max: 1.2 };
const LIMB_RANGE = { min: 0.92, max: 1.3 };

/** Segments that are profiled, with the child joints that define each axis. */
const LIMBS: readonly (readonly [VRMHumanBoneName, ...VRMHumanBoneName[]])[] = [
  ['hips', 'spine'],
  ['spine', 'chest'],
  ['chest', 'upperChest', 'neck'],
  ['upperChest', 'neck'],
  ['neck', 'head'],
  ['leftShoulder', 'leftUpperArm'],
  ['rightShoulder', 'rightUpperArm'],
  ['leftUpperArm', 'leftLowerArm'],
  ['rightUpperArm', 'rightLowerArm'],
  ['leftLowerArm', 'leftHand'],
  ['rightLowerArm', 'rightHand'],
  ['leftUpperLeg', 'leftLowerLeg'],
  ['rightUpperLeg', 'rightLowerLeg'],
  ['leftLowerLeg', 'leftFoot'],
  ['rightLowerLeg', 'rightFoot'],
  ['leftFoot', 'leftToes'],
  ['rightFoot', 'rightToes'],
];

function firstMaterial(mesh: SkinnedMesh): Material | undefined {
  return Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
}

const isSkin = (mesh: SkinnedMesh) => /_SKIN\b/i.test(firstMaterial(mesh)?.name ?? '');

interface Samples {
  /** Vertex positions owned by each humanoid bone, canonical axes, relative to its joint. */
  points: Map<VRMHumanBoneName, number[]>;
  /** Bind-pose joint positions, canonical axes. */
  joints: Map<VRMHumanBoneName, Vec3>;
}

const _matrix = new Matrix4();
const _vertex = new Vector3();
const _joint = new Vector3();

/**
 * Bind-pose vertices grouped by the humanoid bone that owns them: the
 * dominant joint, or its nearest humanoid ancestor (bust springs belong to
 * the chest). Canonical axes: VRM 0.x models face -Z, so x and z flip.
 */
function sampleByBone(vrm: VRM, include: (mesh: SkinnedMesh) => boolean): Samples {
  const flip = vrm.meta?.metaVersion === '0' ? -1 : 1;
  const humanoid = vrm.humanoid;
  const names = new Map<Object3D, VRMHumanBoneName>();
  for (const name of VRMHumanBoneList) {
    const node = humanoid?.getRawBoneNode(name);
    if (node) names.set(node, name);
  }
  const ownerCache = new Map<Object3D, VRMHumanBoneName | null>();
  const ownerOf = (joint: Object3D): VRMHumanBoneName | null => {
    const cached = ownerCache.get(joint);
    if (cached !== undefined) return cached;
    let node: Object3D | null = joint;
    while (node && !names.has(node)) node = node.parent;
    const owner = node ? (names.get(node) ?? null) : null;
    ownerCache.set(joint, owner);
    return owner;
  };

  const samples: Samples = { points: new Map(), joints: new Map() };
  const toCanonical = (v: Vector3): Vec3 => [v.x * flip, v.y, v.z * flip];

  vrm.scene.traverse((obj) => {
    const mesh = obj as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const { bones, boneInverses } = mesh.skeleton;
    // Joint positions at bind time, from the inverse bind matrices.
    const jointPosition = bones.map((_, i) =>
      toCanonical(_joint.setFromMatrixPosition(_matrix.copy(boneInverses[i]).invert())),
    );
    bones.forEach((bone, i) => {
      const name = names.get(bone);
      if (name && !samples.joints.has(name)) samples.joints.set(name, jointPosition[i]);
    });
    if (!include(mesh)) return;

    const owners = bones.map((bone) => ownerOf(bone));
    const ownerJoint = owners.map((owner) => {
      const node = owner ? humanoid?.getRawBoneNode(owner) : undefined;
      const index = node ? bones.findIndex((bone) => bone === node) : -1;
      return index >= 0 ? jointPosition[index] : undefined;
    });
    const position = mesh.geometry.getAttribute('position');
    const skinIndex = mesh.geometry.getAttribute('skinIndex');
    const skinWeight = mesh.geometry.getAttribute('skinWeight');
    if (!position || !skinIndex || !skinWeight) return;

    for (let v = 0; v < position.count; v++) {
      let joint = -1;
      let weight = 0;
      for (let k = 0; k < 4; k++) {
        const w = skinWeight.getComponent(v, k);
        if (w > weight) {
          weight = w;
          joint = skinIndex.getComponent(v, k);
        }
      }
      const owner = owners[joint];
      const origin = ownerJoint[joint];
      if (!owner || !origin) continue;
      _vertex.fromBufferAttribute(position, v).applyMatrix4(mesh.bindMatrix);
      const p = toCanonical(_vertex);
      let list = samples.points.get(owner);
      if (!list) samples.points.set(owner, (list = []));
      list.push(p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]);
    }
  });
  return samples;
}

const profiles = new WeakMap<VRM, BodyProfile>();

/** Skin profile of a model that has its body (a base VRM). Cached per model. */
export function measureBodyProfile(vrm: VRM): BodyProfile {
  const cached = profiles.get(vrm);
  if (cached) return cached;
  const skin = sampleByBone(vrm, isSkin);
  const profile: BodyProfile = { limbs: {} };
  const head = headProfile(skin.points.get('head') ?? []);
  if (head) profile.head = head;
  for (const [bone, ...children] of LIMBS) {
    const from = skin.joints.get(bone);
    const to = children.map((child) => skin.joints.get(child)).find(Boolean);
    const points = skin.points.get(bone);
    if (!from || !to || !points) continue;
    const delta: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const length = Math.hypot(...delta);
    if (length < 1e-4) continue;
    const limb = limbProfile(
      points,
      [delta[0] / length, delta[1] / length, delta[2] / length],
      length,
    );
    if (limb) profile.limbs[bone] = limb;
  }
  profiles.set(vrm, profile);
  return profile;
}

/** Per-bone fits that carry a part from its source body onto the base body. */
export function computeFits(
  base: BodyProfile,
  source: BodyProfile,
): Partial<Record<VRMHumanBoneName, BoneFit>> {
  const fits: Partial<Record<VRMHumanBoneName, BoneFit>> = {};
  if (base.head && source.head) {
    const head = fitHeadProfiles(base.head, source.head, HEAD_RANGE);
    if (head) fits.head = head;
  }
  for (const [name, limb] of Object.entries(base.limbs) as [VRMHumanBoneName, LimbProfile][]) {
    const sourceLimb = source.limbs[name];
    if (!sourceLimb) continue;
    const fit = fitLimbProfiles(limb, sourceLimb, LIMB_RANGE);
    if (fit) fits[name] = fit;
  }
  return fits;
}

/**
 * What the frame loop needs to fit a donor onto the base. Without the donor's
 * source profile (not baked yet) the part is used as authored.
 */
export function prepareFit(
  base: VRM,
  donor: VRM,
  sourceProfile: BodyProfile | undefined,
): PreparedFit {
  const axes = boneAxesOf(donor);
  const fits = sourceProfile ? computeFits(measureBodyProfile(base), sourceProfile) : {};
  const offsets = new Map<Object3D, Vector3>();
  for (const [name, fit] of Object.entries(fits) as [VRMHumanBoneName, BoneFit][]) {
    if (fit.offset.every((o) => Math.abs(o) < 1e-5)) continue;
    const bone = donor.humanoid?.getRawBoneNode(name);
    if (bone) offsets.set(bone, new Vector3(...vectorToLocal(fit.offset, axes(bone))));
  }
  return {
    axes,
    scale: (name) => fits[name as VRMHumanBoneName]?.scale,
    offsets,
  };
}
