#!/usr/bin/env node
/**
 * Retargets humanoid FBX animations (UE5 Mannequin bone names) onto the
 * MetaHuman body skeleton and writes animation-only GLBs whose channels target
 * MetaHuman bone names, ready for an AnimationMixer on the assembled body.
 *
 * Method: per frame, each source bone's world rotation relative to its rest
 * pose is carried over to the target bone's rest pose, after aligning the two
 * skeletons' rest frames (up = pelvis->head, side = right->left upper arm).
 * Bones the source does not animate keep their rest pose; pelvis translation
 * is scaled by the ratio of hip heights. This is the FK part of what Unreal's
 * IK Retargeter does, sufficient for idles and gestures (no foot IK).
 *
 * Usage: node scripts/retarget-fbx.mjs --target <body.glb> --out <dir> [--role idle|talk|listen] <clip.fbx>...
 * The role (default idle) is what the character uses the clips for: idling,
 * gesturing while it speaks, or listening.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { AnimationMixer, ImageLoader, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

// Textures are irrelevant here; keep the loader away from a DOM.
ImageLoader.prototype.load = () => ({});

const ROLES = ['idle', 'talk', 'listen'];

function parseArgs(argv) {
  const args = { files: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--target') args.target = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--fps') args.fps = Number(argv[++i]);
    else if (argv[i] === '--role') args.role = argv[++i];
    else args.files.push(argv[i]);
  }
  args.role ??= 'idle';
  if (!args.target || !args.out || args.files.length === 0 || !ROLES.includes(args.role)) {
    console.error(
      'usage: retarget-fbx.mjs --target body.glb --out dir [--fps 30] [--role idle|talk|listen] clip.fbx...',
    );
    process.exit(2);
  }
  return args;
}

/** The skinned skeleton of a GLB as an Object3D tree, at rest (JSON chunk only). */
function loadTargetSkeleton(path) {
  const bytes = readFileSync(path);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  const objects = gltf.nodes.map((node) => {
    const object = new Object3D();
    object.name = node.name ?? '';
    if (node.translation) object.position.fromArray(node.translation);
    if (node.rotation) object.quaternion.fromArray(node.rotation);
    if (node.scale) object.scale.fromArray(node.scale);
    return object;
  });
  gltf.nodes.forEach((node, index) => {
    for (const child of node.children ?? []) objects[index].add(objects[child]);
  });
  const joints = gltf.skins[0].joints.map((index) => objects[index]);
  let top = joints[0];
  while (top.parent) top = top.parent;
  top.updateMatrixWorld(true);
  return { joints, byName: new Map(joints.map((joint) => [joint.name, joint])), nodes: gltf.nodes };
}

function loadSource(path) {
  const bytes = readFileSync(path);
  const object = new FBXLoader().parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  const collect = (accept) => {
    const byName = new Map();
    object.traverse((node) => {
      if (accept(node) && node.name && !byName.has(node.name)) byName.set(node.name, node);
    });
    return byName;
  };
  // Some exports carry the skeleton as plain transform nodes instead of bones.
  const bones = collect((node) => node.isBone);
  const named = (map) => map.has('pelvis') || map.has('Hips');
  const byName = named(bones) ? bones : collect((node) => node !== object);
  // HumanIK (Maya/MotionBuilder) names: look the same joints up by UE names.
  for (const [hik, ue] of [...HIK_NAMES, ...MIXAMO_NAMES]) {
    if (byName.has(hik) && !byName.has(ue)) byName.set(ue, byName.get(hik));
  }
  return { object, byName, clip: mainClip(object.animations) };
}

/**
 * The take that actually moves. ActorCore exports put a static reference-pose
 * take (e.g. "0_Open A_UE5") before the motion itself.
 */
function mainClip(clips) {
  const motion = (clip) =>
    clip.tracks
      .filter((track) => track.name.endsWith('.quaternion'))
      .reduce((sum, { values }) => {
        let range = 0;
        for (let c = 0; c < 4; c += 1) {
          let lo = Infinity;
          let hi = -Infinity;
          for (let i = c; i < values.length; i += 4) {
            lo = Math.min(lo, values[i]);
            hi = Math.max(hi, values[i]);
          }
          range = Math.max(range, hi - lo);
        }
        return sum + range;
      }, 0);
  return clips.reduce((best, clip) => (motion(clip) > motion(best) ? clip : best), clips[0]);
}

/** HumanIK joint names -> UE5 Mannequin / MetaHuman names. */
const HIK_NAMES = (() => {
  const names = new Map([
    ['Reference', 'root'],
    ['Hips', 'pelvis'],
    ['spine', 'spine_01'],
    ['spine1', 'spine_02'],
    ['spine2', 'spine_03'],
    ['spine3', 'spine_04'],
    ['spine4', 'spine_05'],
    ['Neck', 'neck_01'],
    ['Neck1', 'neck_02'],
    ['Head', 'head'],
  ]);
  const limbs = [
    ['Shoulder', 'clavicle'],
    ['Arm', 'upperarm'],
    ['ForeArm', 'lowerarm'],
    ['Hand', 'hand'],
    ['UpLeg', 'thigh'],
    ['Leg', 'calf'],
    ['Foot', 'foot'],
    ['ToeBase', 'ball'],
  ];
  const fingers = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
  for (const [side, suffix] of [
    ['Left', 'l'],
    ['Right', 'r'],
  ]) {
    for (const [hik, ue] of limbs) names.set(`${side}${hik}`, `${ue}_${suffix}`);
    for (const finger of fingers) {
      for (const n of [1, 2, 3]) {
        names.set(`${side}Hand${finger}${n}`, `${finger.toLowerCase()}_0${n}_${suffix}`);
      }
      if (finger !== 'Thumb') {
        names.set(`${side}InHand${finger}`, `${finger.toLowerCase()}_metacarpal_${suffix}`);
      }
    }
  }
  return names;
})();

/**
 * Mixamo-style names: HumanIK limbs under a capitalised three-bone spine,
 * spread over MetaHuman's five (the joints between inherit the bend).
 */
const MIXAMO_NAMES = new Map([
  ['Root', 'root'],
  ['Spine', 'spine_01'],
  ['Spine1', 'spine_03'],
  ['Spine2', 'spine_05'],
]);

/** Joints the rest-frame alignment and the pelvis scale need on both skeletons. */
const REQUIRED_JOINTS = ['pelvis', 'head', 'upperarm_l', 'upperarm_r'];

const worldPosition = (object) => object.getWorldPosition(new Vector3());
const worldQuaternion = (object) => object.getWorldQuaternion(new Quaternion());

/** Rest frame of a skeleton: columns side (right->left), up (pelvis->head), forward. */
function restFrame(byName) {
  const up = worldPosition(byName.get('head'))
    .sub(worldPosition(byName.get('pelvis')))
    .normalize();
  const side = worldPosition(byName.get('upperarm_l'))
    .sub(worldPosition(byName.get('upperarm_r')))
    .normalize();
  const forward = new Vector3().crossVectors(side, up).normalize();
  side.crossVectors(up, forward).normalize();
  return new Matrix4().makeBasis(side, up, forward);
}

function hipHeight(byName) {
  const root = byName.get('root') ?? byName.get('pelvis').parent;
  return worldPosition(byName.get('pelvis')).distanceTo(worldPosition(root));
}

/** Depth-first order so parents are solved before children. */
function hierarchyOrder(joints) {
  const set = new Set(joints);
  const order = [];
  const visit = (joint) => {
    order.push(joint);
    for (const child of joint.children) if (set.has(child)) visit(child);
  };
  for (const joint of joints) if (!set.has(joint.parent)) visit(joint);
  return order;
}

/** Seconds after the calibration pose ends before the take counts as idle (arms settling). */
const SETTLE = 1.5;
/** Hands closer than this (m), more than HANDS_IN_FRONT (m) in front of the pelvis, count as held together in front. */
const HANDS_TOGETHER = 0.25;
const HANDS_IN_FRONT = 0.05;
const DEG = 180 / Math.PI;
/** Target skeletons are +Y up (see the MetaHuman web asset contract). */
const UP = new Vector3(0, 1, 0);

const wrapDegrees = (angle) => ((((angle + 180) % 360) + 360) % 360) - 180;

/** Right->left hip direction projected onto the plane normal to `up`. */
function hipsSide(byName, up) {
  const side = worldPosition(byName.get('thigh_l') ?? byName.get('upperarm_l')).sub(
    worldPosition(byName.get('thigh_r') ?? byName.get('upperarm_r')),
  );
  return side.addScaledVector(up, -side.dot(up)).normalize();
}

/** Signed angle (degrees) from `a` to `b` about `axis`. */
function signedAngle(a, b, axis) {
  const cross = new Vector3().crossVectors(a, b);
  return Math.atan2(cross.dot(axis), a.dot(b)) * DEG;
}

/** True when this arm points straight out to the side, as in a T-pose. */
function armOut(byName, side) {
  const up = worldPosition(byName.get('head'))
    .sub(worldPosition(byName.get('pelvis')))
    .normalize();
  const across = worldPosition(byName.get('upperarm_l'))
    .sub(worldPosition(byName.get('upperarm_r')))
    .normalize();
  const arm = worldPosition(byName.get(`lowerarm_${side}`))
    .sub(worldPosition(byName.get(`upperarm_${side}`)))
    .normalize();
  const fromDown = Math.acos(Math.max(-1, Math.min(1, -arm.dot(up)))) * DEG;
  return fromDown > 60 && fromDown < 120 && Math.abs(arm.dot(across)) > 0.85;
}

/**
 * Mocap takes (iPi) open with a calibration T-pose held for a few seconds.
 * Returns the time the usable motion starts: after that pose and the swing
 * out of it, or 0 when the take does not open with one.
 */
function calibrationEnd(mixer, source, fps) {
  const { clip, object, byName } = source;
  if (!['l', 'r'].every((side) => byName.has(`lowerarm_${side}`))) return 0;
  let end = -1;
  for (let frame = 0; frame / fps <= clip.duration * 0.6; frame += 1) {
    mixer.setTime(frame / fps);
    object.updateMatrixWorld(true);
    if (armOut(byName, 'l') && armOut(byName, 'r')) end = frame / fps;
    else if (end >= 0 || frame / fps > 1) break;
  }
  return end < 0 ? 0 : Math.min(end + SETTLE, clip.duration - 1);
}

const IDENTITY = new Quaternion();

const LIMB_CHILD = {
  clavicle: 'upperarm',
  upperarm: 'lowerarm',
  lowerarm: 'hand',
  hand: 'middle_01',
  thigh: 'calf',
  calf: 'foot',
  foot: 'ball',
};

/** The joint a limb or finger bone points at (undefined for the spine and head). */
function chainChild(name) {
  const sided = /^(.+)_([lr])$/.exec(name);
  if (!sided) return undefined;
  const [, base, side] = sided;
  if (LIMB_CHILD[base]) return `${LIMB_CHILD[base]}_${side}`;
  const finger = /^(thumb|index|middle|ring|pinky)_(metacarpal|01|02)$/.exec(base);
  if (!finger) return undefined;
  const next = finger[2] === 'metacarpal' ? 1 : Number(finger[2]) + 1;
  return `${finger[1]}_0${next}_${side}`;
}

function retarget(source, target, fps) {
  const { clip } = source;
  const mapped = target.joints.filter((joint) => source.byName.has(joint.name));
  source.object.updateMatrixWorld(true);
  const sourceRest = new Map(
    mapped.map((joint) => [joint.name, worldQuaternion(source.byName.get(joint.name))]),
  );
  const sourcePelvisRest = worldPosition(source.byName.get('pelvis'));
  const targetRest = new Map(target.joints.map((joint) => [joint.name, worldQuaternion(joint)]));
  const targetPelvis = target.byName.get('pelvis');
  const targetPelvisRest = worldPosition(targetPelvis);
  const align = new Quaternion().setFromRotationMatrix(
    restFrame(target.byName).multiply(restFrame(source.byName).invert()),
  );
  const alignInverse = align.clone().invert();
  const scale = hipHeight(target.byName) / hipHeight(source.byName);
  const order = hierarchyOrder(target.joints);

  const sourceUp = worldPosition(source.byName.get('head')).sub(sourcePelvisRest).normalize();
  const hipsRest = hipsSide(source.byName, sourceUp);

  // The rest poses differ (an A-pose against a relaxed stance, say): turn each
  // limb bone's rest to point where the source's does before carrying
  // rotations over, or the difference would persist through the whole clip.
  const restFix = new Map();
  for (const joint of mapped) {
    const child = chainChild(joint.name);
    if (!child || !source.byName.has(child) || !target.byName.has(child)) continue;
    const from = worldPosition(target.byName.get(child)).sub(worldPosition(joint)).normalize();
    const to = worldPosition(source.byName.get(child))
      .sub(worldPosition(source.byName.get(joint.name)))
      .applyQuaternion(align)
      .normalize();
    restFix.set(joint.name, new Quaternion().setFromUnitVectors(from, to));
  }
  // Joints with no chain of their own (twist and corrective bones, finger
  // tips, toes) turn with the nearest ancestor that has one. Without its fix
  // a twist bone kept the stance difference (27° at the shoulder on the
  // HumanIK stand loop) and bent the skin it carries: kinked elbows, wrists
  // and sleeves.
  for (const joint of order) {
    const inherited = restFix.has(joint.name) ? null : restFix.get(joint.parent?.name);
    if (inherited) restFix.set(joint.name, inherited);
  }

  const mixer = new AnimationMixer(source.object);
  mixer.clipAction(clip).play();
  const start = calibrationEnd(mixer, source, fps);
  const frames = Math.max(2, Math.round((clip.duration - start) * fps) + 1);
  const sample = (frame) => {
    mixer.setTime(Math.min(clip.duration, start + frame / fps));
    source.object.updateMatrixWorld(true);
  };
  const pelvisOffset = () =>
    worldPosition(source.byName.get('pelvis'))
      .sub(sourcePelvisRest)
      .applyQuaternion(align)
      .multiplyScalar(scale);

  // Pass 1: where the actor stands and faces during the take. Takes start
  // wherever the calibration pose was held, so each clip is turned to face
  // forward on average and centred over the rest position.
  const yaws = [];
  let sin = 0;
  let cos = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    sample(frame);
    const yaw = signedAngle(hipsRest, hipsSide(source.byName, sourceUp), sourceUp);
    yaws.push(yaw);
    sin += Math.sin(yaw / DEG);
    cos += Math.cos(yaw / DEG);
  }
  const meanYaw = Math.atan2(sin, cos) * DEG;
  const facing = new Quaternion().setFromAxisAngle(UP, -meanYaw / DEG);
  const centre = new Vector3();
  for (let frame = 0; frame < frames; frame += 1) {
    sample(frame);
    centre.add(pelvisOffset().applyQuaternion(facing));
  }
  centre.divideScalar(frames).setY(0);

  const times = new Float32Array(frames);
  const rotations = new Map(mapped.map((joint) => [joint.name, new Float32Array(frames * 4)]));
  const pelvisPositions = new Float32Array(frames * 3);
  const turns = yaws.map((yaw) => wrapDegrees(yaw - meanYaw));
  const stats = {
    start,
    yaw: [Math.min(...turns), Math.max(...turns)],
    drift: 0,
    crouch: 0,
    lean: 0,
    floor: [Infinity, -Infinity],
  };
  const world = new Map();
  const delta = new Quaternion();
  const local = new Quaternion();
  const parentInverse = new Matrix4();
  const parentPosition = worldPosition(targetPelvis.parent);
  const parentScale = targetPelvis.parent.getWorldScale(new Vector3());
  let targetTop = targetPelvis;
  while (targetTop.parent) targetTop = targetTop.parent;
  const handLeft = target.byName.get('hand_l');
  const handRight = target.byName.get('hand_r');
  const chestHeight = worldPosition(target.byName.get('spine_03')).y;
  const headJoint = target.byName.get('head');
  const balls = ['ball_l', 'ball_r'].map((name) => target.byName.get(name)).filter(Boolean);
  const ballRest = Math.min(...balls.map((ball) => worldPosition(ball).y));
  let handsUp = 0;
  let crossed = 0;
  let handsFront = 0;

  // Pass 2: the retargeted keys.
  for (let frame = 0; frame < frames; frame += 1) {
    times[frame] = frame / fps;
    sample(frame);
    world.clear();
    for (const joint of order) {
      const parentWorld = joint.parent
        ? (world.get(joint.parent) ?? worldQuaternion(joint.parent))
        : new Quaternion();
      let jointWorld;
      if (rotations.has(joint.name)) {
        const now = worldQuaternion(source.byName.get(joint.name));
        // World-space rotation since rest, expressed in the target's frame.
        delta.copy(now).multiply(sourceRest.get(joint.name).clone().invert());
        delta.premultiply(align).multiply(alignInverse).premultiply(facing);
        jointWorld = delta
          .clone()
          .multiply(restFix.get(joint.name) ?? IDENTITY)
          .multiply(targetRest.get(joint.name));
        local.copy(parentWorld).invert().multiply(jointWorld);
        local.toArray(rotations.get(joint.name), frame * 4);
      } else {
        jointWorld = parentWorld.clone().multiply(joint.quaternion);
      }
      world.set(joint, jointWorld);
    }
    const offset = pelvisOffset().applyQuaternion(facing).sub(centre);
    stats.drift = Math.max(stats.drift, Math.hypot(offset.x, offset.z));
    const moved = offset.add(targetPelvisRest);
    // The pelvis parent (root) may itself be rotating this frame; only its rotation is keyed.
    parentInverse
      .compose(
        parentPosition,
        world.get(targetPelvis.parent) ?? worldQuaternion(targetPelvis.parent),
        parentScale,
      )
      .invert();
    // Pose the target (the GLB writer reads the JSON nodes, not these objects).
    const pose = () => {
      moved
        .clone()
        .applyMatrix4(parentInverse)
        .toArray(pelvisPositions, frame * 3);
      for (const [name, values] of rotations)
        target.byName.get(name).quaternion.fromArray(values, frame * 4);
      targetPelvis.position.fromArray(pelvisPositions, frame * 3);
      targetTop.updateMatrixWorld(true);
    };
    pose();
    // Plant the feet: leg proportions and rest stances differ, so the copied
    // leg angles leave the feet above or below the floor. One foot carries the
    // weight in an idle, so the lower toe joint goes back to its rest height.
    const lowest = Math.min(...balls.map((ball) => worldPosition(ball).y)) - ballRest;
    stats.floor = [Math.min(stats.floor[0], lowest), Math.max(stats.floor[1], lowest)];
    moved.y -= lowest;
    pose();

    // Where the hands go: conversation idles keep them low and apart.
    const left = worldPosition(handLeft);
    const right = worldPosition(handRight);
    if (Math.max(left.y, right.y) > chestHeight) handsUp += 1;
    const pelvisNow = worldPosition(targetPelvis);
    stats.crouch = Math.max(stats.crouch, 1 - pelvisNow.y / targetPelvisRest.y);
    const spine = worldPosition(headJoint).sub(pelvisNow).normalize();
    stats.lean = Math.max(stats.lean, Math.acos(Math.min(1, spine.dot(UP))) * DEG);
    // The character's left is +X: a left hand right of the right hand means crossed arms.
    if (left.x < right.x) crossed += 1;
    // Hands held together in front of the hips (clasped, over the groin): fine
    // for a crowd, odd for someone facing you in a conversation (+Z is forward).
    const together = left.distanceTo(right) < HANDS_TOGETHER;
    const inFront = Math.min(left.z, right.z) > pelvisNow.z + HANDS_IN_FRONT;
    if (together && inFront) handsFront += 1;
  }
  stats.handsUp = handsUp / frames;
  stats.crossed = crossed / frames;
  stats.handsFront = handsFront / frames;
  return { name: clip.name, times, rotations, pelvisPositions, stats };
}

/** Minimal GLB: the target skeleton's nodes at rest plus one animation. */
function writeAnimationGlb(path, target, result, clipName) {
  const chunks = [];
  let byteLength = 0;
  const bufferViews = [];
  const accessors = [];
  const add = (array, type, count, minMax) => {
    const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length });
    chunks.push(bytes);
    byteLength += bytes.length;
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      byteLength += pad;
    }
    accessors.push({
      bufferView: bufferViews.length - 1,
      componentType: 5126,
      count,
      type,
      ...minMax,
    });
    return accessors.length - 1;
  };
  const frames = result.times.length;
  const input = add(result.times, 'SCALAR', frames, {
    min: [result.times[0]],
    max: [result.times[frames - 1]],
  });
  const nodeIndex = new Map(target.nodes.map((node, index) => [node.name, index]));
  const samplers = [];
  const channels = [];
  for (const [name, values] of result.rotations) {
    samplers.push({ input, output: add(values, 'VEC4', frames), interpolation: 'LINEAR' });
    channels.push({
      sampler: samplers.length - 1,
      target: { node: nodeIndex.get(name), path: 'rotation' },
    });
  }
  samplers.push({
    input,
    output: add(result.pelvisPositions, 'VEC3', frames),
    interpolation: 'LINEAR',
  });
  channels.push({
    sampler: samplers.length - 1,
    target: { node: nodeIndex.get('pelvis'), path: 'translation' },
  });

  const json = {
    asset: { version: '2.0', generator: 'ai-sims retarget-fbx' },
    scene: 0,
    scenes: [
      {
        nodes: target.nodes
          .map((_, i) => i)
          .filter((i) => !target.nodes.some((n) => n.children?.includes(i))),
      },
    ],
    nodes: target.nodes.map(({ name, translation, rotation, scale, children }) => ({
      name,
      ...(translation && { translation }),
      ...(rotation && { rotation }),
      ...(scale && { scale }),
      ...(children && { children }),
    })),
    animations: [{ name: clipName, samplers, channels }],
    buffers: [{ byteLength }],
    bufferViews,
    accessors,
  };
  let jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20)]);
  const bin = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBytes.length + 8 + bin.length, 8);
  const chunkHeader = (length, type) => {
    const value = Buffer.alloc(8);
    value.writeUInt32LE(length, 0);
    value.writeUInt32LE(type, 4);
    return value;
  };
  writeFileSync(
    path,
    Buffer.concat([
      header,
      chunkHeader(jsonBytes.length, 0x4e4f534a),
      jsonBytes,
      chunkHeader(bin.length, 0x004e4942),
      bin,
    ]),
  );
}

const round = (value, digits) => Number(value.toFixed(digits));
// Limits for flagging a clip as a standing conversation idle (see `standing` in clips.json).
const MIN_DURATION = 4;
const MAX_TURN = 50;
const MAX_DRIFT = 0.15;
const MAX_CROUCH = 0.06;
const MAX_LEAN = 12;
const MAX_HANDS_UP = 0.15;
const MAX_CROSSED = 0.02;
const MAX_HANDS_FRONT = 0.3;

const args = parseArgs(process.argv.slice(2));
const fps = args.fps ?? 30;
mkdirSync(args.out, { recursive: true });
const summary = [];
for (const file of args.files) {
  const target = loadTargetSkeleton(args.target);
  const source = loadSource(file);
  if (!source.clip) {
    console.warn(`skip ${file}: no animation`);
    continue;
  }
  const missing = REQUIRED_JOINTS.filter((name) => !source.byName.has(name));
  if (missing.length > 0) {
    console.warn(`skip ${file}: missing joints ${missing.join(', ')}`);
    continue;
  }
  const result = retarget(source, target, fps);
  const name = basename(file).replace(/\.fbx$/i, '');
  const out = join(args.out, `${name}.glb`);
  writeAnimationGlb(out, target, result, name);
  const { start, yaw, drift, crouch, lean, floor, handsUp, crossed, handsFront } = result.stats;
  const duration = result.times.at(-1);
  // A standing idle for a conversation: faces the viewer, stays in place, long enough to loop.
  const standing =
    duration >= MIN_DURATION &&
    yaw[1] - yaw[0] <= MAX_TURN &&
    drift <= MAX_DRIFT &&
    crouch <= MAX_CROUCH &&
    lean <= MAX_LEAN;
  summary.push({
    file: basename(out),
    role: args.role,
    duration: round(duration, 2),
    bones: result.rotations.size,
    trimmedStart: round(start, 2),
    // Hip turn range around the clip's mean facing (degrees).
    yaw: yaw.map((angle) => round(angle, 1)),
    // Largest horizontal pelvis distance from the clip's centre (metres).
    drift: round(drift, 3),
    // Share of the clip with a hand above the lower chest, and with the arms crossed.
    // Deepest pelvis drop (share of its rest height) and largest pelvis->head tilt (degrees).
    crouch: round(crouch, 3),
    lean: round(lean, 1),
    // Lower toe joint height against the floor before planting, [min, max] metres.
    floor: floor.map((height) => round(height, 3)),
    handsUp: round(handsUp, 2),
    crossed: round(crossed, 2),
    // Share of the clip with the hands held together in front of the hips.
    handsFront: round(handsFront, 2),
    standing,
    // Standing, and open: hands low and apart (no crossed arms, no face
    // touching, not clasped in front of the body).
    calm:
      standing &&
      handsUp <= MAX_HANDS_UP &&
      crossed <= MAX_CROSSED &&
      handsFront <= MAX_HANDS_FRONT,
  });
}
writeFileSync(
  join(args.out, 'clips.json'),
  JSON.stringify({ fps, clips: summary }, null, 2) + '\n',
);
console.log(`wrote ${summary.length} clips to ${args.out}`);
