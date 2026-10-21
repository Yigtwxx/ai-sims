import { MathUtils, Quaternion, Vector3, type Object3D } from 'three';

const DEG = Math.PI / 180;
/** Chest turn the idle clips may show before the stage turns the character back (radians). */
export const FACING_SLACK = 6 * DEG;
/** How quickly the counter-turn follows the clip (1/s): slow enough to read as a settle, not a snap. */
const FACING_RATE = 1.6;

/**
 * How far the chest is turned from facing +Z (radians, + toward the
 * character's left), from the two clavicles in the character's own space:
 * at rest the line from the right to the left one runs along +X.
 */
export function chestYaw(left: Vector3, right: Vector3): number {
  return -Math.atan2(left.z - right.z, left.x - right.x);
}

/**
 * The turn that brings a chest at `yaw` back within `slack` of the viewer:
 * small sways pass untouched, a clip that turns the body away is countered
 * beyond them.
 */
export function counterTurn(yaw: number, slack = FACING_SLACK): number {
  const excess = Math.max(0, Math.abs(yaw) - slack);
  return excess === 0 ? 0 : -Math.sign(yaw) * excess;
}

/** The counter-turn on one skeleton: what the clip left on its root bone and what we wrote. */
interface Turned {
  angle: number;
  base: Quaternion;
  written: Quaternion;
}

const turned = new WeakMap<Object3D, Turned>();
const UP = new Vector3(0, 1, 0);
const yawTurn = new Quaternion();
const leftLocal = new Vector3();
const rightLocal = new Vector3();

/**
 * Keeps an idling character facing the viewer: some mocap idles shift the
 * weight into a quarter turn and hold it, which a creator close-up shows as a
 * profile. Turns the skeleton's root bone (feet included, like a dancer
 * resetting their stance) against the part of the chest turn beyond the
 * slack. A bone, not the scene root: skinned meshes bound later (garments,
 * grooms, a re-baked body) bake the root's transform into their bind matrix.
 *
 * Call once per frame after the clips and the life layer have posed the
 * skeleton. A root bone no clip animates still holds last frame's turn; it is
 * taken off before measuring, so the turn never measures itself.
 */
export function keepFacing(
  rootBone: Object3D | undefined,
  left: Object3D | undefined,
  right: Object3D | undefined,
  delta: number,
): void {
  if (!rootBone || !left || !right) return;
  let state = turned.get(rootBone);
  if (!state) {
    state = { angle: 0, base: new Quaternion(), written: new Quaternion() };
    turned.set(rootBone, state);
  } else if (rootBone.quaternion.equals(state.written)) {
    rootBone.quaternion.copy(state.base);
  }
  state.base.copy(rootBone.quaternion);

  // World matrices are still last render's (with last frame's turn on the
  // root): refresh the two clavicle chains so the turn never measures itself.
  left.updateWorldMatrix(true, false);
  right.updateWorldMatrix(true, false);
  const space = rootBone.parent;
  left.getWorldPosition(leftLocal);
  right.getWorldPosition(rightLocal);
  if (space) {
    space.worldToLocal(leftLocal);
    space.worldToLocal(rightLocal);
  }
  const target = counterTurn(chestYaw(leftLocal, rightLocal));
  state.angle = MathUtils.damp(state.angle, target, FACING_RATE, Math.min(delta, 0.1));

  // About the character's up axis, in the space the root bone hangs in.
  rootBone.quaternion.premultiply(yawTurn.setFromAxisAngle(UP, state.angle));
  state.written.copy(rootBone.quaternion);
}
