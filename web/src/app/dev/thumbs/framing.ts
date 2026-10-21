/**
 * Thumbnail framing from the figure, not from the item: every shot of a
 * category is cut from the same landmarks of the body and head (eyes, chin,
 * crown, hips, knees, feet), so two hairstyles or two tops of the same
 * category sit at the same size and height in their images and can be
 * compared side by side. Pure: the bench measures the landmarks in the scene.
 */
import type { ThumbShot } from '@/components/dev/thumbConfig';

export type Vec3 = readonly [number, number, number];

/** World-space landmarks of the posed figure (metres, +Y up, facing +Z). */
export interface Landmarks {
  /** Midpoint of the eyeballs. */
  eyes: Vec3;
  /** Chin bone. */
  chin: Vec3;
  /** Highest point of the head skin (the top of the skull, without hair). */
  crown: number;
  pelvis: Vec3;
  /** Wrist joints (hand bones), left and right: how far the sleeves reach. */
  hands: readonly [Vec3, Vec3];
  /** Knee joints (calf bones), left and right. */
  knees: readonly [Vec3, Vec3];
  /** Ankle joints (foot bones), left and right. */
  ankles: readonly [Vec3, Vec3];
  /** Balls of the feet, left and right. */
  toes: readonly [Vec3, Vec3];
  /** Lowest point of the body skin (the soles). */
  floor: number;
}

/** The region a shot must show, in the plane facing the camera. */
export interface ShotBox {
  /** Centre across (X) and depth (Z) the camera aims at. */
  x: number;
  z: number;
  bottom: number;
  top: number;
  /** Half the width that must fit; the shot is square, so the larger span wins. */
  halfWidth: number;
  /**
   * Where the extra height goes when the width needs a wider shot than the
   * height: split around the box (centre) or all below it (top: the top edge
   * stays where it is, so a top stays cut at the chin).
   */
  anchor?: 'centre' | 'top';
  /** Camera turn around the figure (degrees, + toward the figure's left) and tilt (+ looks down). */
  yaw: number;
  pitch: number;
}

export interface CameraPose {
  position: Vec3;
  target: Vec3;
}

const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Crown to chin: the unit the head shots are measured in, so a smaller head gets a closer camera. */
export const headHeight = (marks: Landmarks) => Math.max(0.12, marks.crown - marks.chin[1]);

/**
 * The box each shot frames. Head shots scale with the head and centre on the
 * eyes; body shots run between joints and the soles and centre on the hips or
 * between the feet. Margins leave room for large items (an afro or a mohawk
 * above the crown, a long beard below the chin) without cutting them.
 */
export function shotBox(shot: ThumbShot, marks: Landmarks): ShotBox {
  const head = headHeight(marks);
  const [ex, ey, ez] = marks.eyes;
  const chin = marks.chin[1];
  const hips = marks.pelvis;
  const feet = mid(mid(marks.ankles[0], marks.ankles[1]), mid(marks.toes[0], marks.toes[1]));
  const feetSpan = Math.abs(marks.toes[0][0] - marks.toes[1][0]);
  const kneeY = (marks.knees[0][1] + marks.knees[1][1]) / 2;
  switch (shot) {
    case 'bust':
      return {
        x: ex,
        z: ez,
        top: marks.crown + 0.45 * head,
        bottom: chin - 1.05 * head,
        halfWidth: 0,
        yaw: 0,
        pitch: 3,
      };
    case 'brows':
      return {
        x: ex,
        z: ez,
        top: ey + 0.33 * head,
        bottom: ey - 0.32 * head,
        halfWidth: 0.33 * head,
        yaw: 0,
        pitch: 0,
      };
    case 'beard':
      return {
        x: ex,
        z: ez,
        top: ey - 0.06 * head,
        bottom: chin - 0.42 * head,
        halfWidth: 0,
        yaw: 0,
        pitch: 2,
      };
    case 'mustache':
      return {
        x: ex,
        z: ez,
        top: ey - 0.16 * head,
        bottom: chin - 0.14 * head,
        halfWidth: 0.33 * head,
        yaw: 0,
        pitch: 2,
      };
    case 'top': {
      // Down to the wrists and out to both of them: sleeve lengths and cuffs
      // are what tell many tops apart.
      const reach = Math.max(...marks.hands.map((hand) => Math.abs(hand[0] - hips[0])));
      const wrists = Math.min(marks.hands[0][1], marks.hands[1][1]);
      return {
        x: hips[0],
        z: hips[2],
        top: chin + 0.02,
        bottom: Math.min(hips[1] - 0.2, wrists - 0.06),
        halfWidth: reach + 0.1,
        anchor: 'top',
        yaw: 0,
        pitch: 2,
      };
    }
    case 'bottom':
      return {
        x: hips[0],
        z: hips[2],
        top: hips[1] + 0.16,
        bottom: marks.floor - 0.04,
        halfWidth: 0,
        yaw: 0,
        pitch: 2,
      };
    case 'shoes':
      return {
        x: feet[0],
        z: feet[2],
        top: lerp(marks.floor, kneeY, 0.5),
        bottom: marks.floor - 0.03,
        halfWidth: feetSpan / 2 + 0.13,
        yaw: 20,
        pitch: 14,
      };
    case 'full':
      return {
        x: hips[0],
        z: hips[2],
        top: marks.crown + 0.08,
        bottom: marks.floor - 0.06,
        halfWidth: 0,
        yaw: 0,
        pitch: 2,
      };
  }
}

const RAD = Math.PI / 180;

/**
 * Vertical field of view (degrees) of the centred square the bench crops
 * from a canvas whose camera has `fov` over its height.
 */
export function squareFov(fov: number, width: number, height: number): number {
  const narrow = Math.min(1, width / Math.max(1, height));
  return (2 * Math.atan(Math.tan((fov * RAD) / 2) * narrow)) / RAD;
}

/**
 * A camera that fits the box in a square image with the given vertical field
 * of view: aimed at the box centre from the shot's yaw and pitch, as far away
 * as the taller or wider of the box's spans needs.
 */
export function cameraFor(box: ShotBox, fov: number): CameraPose {
  const halfHeight = Math.max(0.01, (box.top - box.bottom) / 2);
  const half = Math.max(halfHeight, box.halfWidth);
  const distance = half / Math.tan((fov * RAD) / 2);
  const middle = box.anchor === 'top' ? box.top - half : (box.top + box.bottom) / 2;
  const target: Vec3 = [box.x, middle, box.z];
  const yaw = box.yaw * RAD;
  const pitch = box.pitch * RAD;
  return {
    position: [
      target[0] + distance * Math.sin(yaw) * Math.cos(pitch),
      target[1] + distance * Math.sin(pitch),
      target[2] + distance * Math.cos(yaw) * Math.cos(pitch),
    ],
    target,
  };
}

/** Largest coordinate difference between two poses (metres). */
export function poseDistance(a: CameraPose, b: CameraPose): number {
  let most = 0;
  for (let i = 0; i < 3; i += 1) {
    most = Math.max(
      most,
      Math.abs(a.position[i] - b.position[i]),
      Math.abs(a.target[i] - b.target[i]),
    );
  }
  return most;
}
