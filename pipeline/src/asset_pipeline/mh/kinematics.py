"""Rigid-transform math shared by the rig evaluator and the glTF writer (pure numpy).

Conventions match Epic's `tdm` library, RigLogic and Unreal, and were verified against the
archetype head (the eye joints land on the eyeball sphere centres to within 0.2 mm):

- Quaternions are `(x, y, z, w)` with the Hamilton product. They rotate column vectors
  actively: `v' = q v q*`, i.e. `quaternion_to_matrix(q) @ v`.
- `quaternion_multiply(a, b)` applies `b` first, then `a` (tdm `a * b`, Unreal `FQuat a * b`).
- Euler angles follow the DNA rotation sequence. Sequence `"xyz"` (MetaHuman, Maya's default
  rotate order) means `R = Rz @ Ry @ Rx`: x is applied first, about the parent's axes. Each
  angle is multiplied by its axis' rotation sign before composing (tdm `euler_to_quat`).
- 4x4 matrices use the column-vector convention, `local = T @ R @ S`.

Two hierarchy rules exist and agree unless a non-uniformly scaled joint has children:

- `forward_kinematics` multiplies matrices, `world = parent_world @ local` (glTF, three.js);
  a non-uniform parent scale shears rotated children.
- `forward_kinematics_trs` follows Unreal's `FTransform` product, used to drive MetaHuman
  skinning: rotations multiply, scales multiply per axis and only the child's translation is
  scaled by the parent (no shear). Bakes should use this one.
"""

from collections.abc import Sequence

import numpy as np
from numpy.typing import ArrayLike, NDArray

type F64 = NDArray[np.float64]
type I64 = NDArray[np.int64]

ROTATION_SEQUENCES = ("xyz", "xzy", "yxz", "yzx", "zxy", "zyx")
_AXIS = {"x": 0, "y": 1, "z": 2}


def axis_quaternions(axis: str, angles: ArrayLike) -> F64:
    """Quaternions `(…, 4)` rotating by `angles` (radians) about the x, y or z axis."""
    half = np.asarray(angles, dtype=np.float64) * 0.5
    q = np.zeros((*half.shape, 4), dtype=np.float64)
    q[..., _AXIS[axis]] = np.sin(half)
    q[..., 3] = np.cos(half)
    return q


def quaternion_multiply(a: ArrayLike, b: ArrayLike) -> F64:
    """Hamilton product `a * b` (rotation `b` first, then `a`); broadcasts over `(…, 4)`."""
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    ax, ay, az, aw = np.moveaxis(a, -1, 0)
    bx, by, bz, bw = np.moveaxis(b, -1, 0)
    return np.stack(
        [
            aw * bx + ax * bw + ay * bz - az * by,
            aw * by + ay * bw + az * bx - ax * bz,
            aw * bz + az * bw + ax * by - ay * bx,
            aw * bw - ax * bx - ay * by - az * bz,
        ],
        axis=-1,
    )


def euler_to_quaternion(
    angles: ArrayLike, sequence: str = "xyz", signs: Sequence[int] = (1, 1, 1)
) -> F64:
    """Quaternions `(…, 4)` for Euler `angles` `(…, 3)` in radians, ordered (x, y, z).

    For sequence "abc" the first axis is applied first: `q = q_c * q_b * q_a`, which is
    exactly tdm's `euler_to_quat<…, rot_seq::abc>` (RigLogic's neutral joint values).
    """
    if sequence not in ROTATION_SEQUENCES:
        raise ValueError(f"unknown rotation sequence {sequence!r}")
    signed = np.asarray(angles, dtype=np.float64) * np.asarray(signs, dtype=np.float64)
    first, second, third = (axis_quaternions(axis, signed[..., _AXIS[axis]]) for axis in sequence)
    return quaternion_multiply(third, quaternion_multiply(second, first))


def quaternion_to_matrix(q: ArrayLike) -> F64:
    """Rotation matrices `(…, 3, 3)` of unit quaternions `(…, 4)` (normalized first)."""
    q = np.asarray(q, dtype=np.float64)
    q = q / np.linalg.norm(q, axis=-1, keepdims=True)
    x, y, z, w = np.moveaxis(q, -1, 0)
    return np.stack(
        [
            np.stack([1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)], -1),
            np.stack([2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)], -1),
            np.stack([2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)], -1),
        ],
        axis=-2,
    )


def rotate_vectors(q: ArrayLike, v: ArrayLike) -> F64:
    """Rotate vectors `(…, 3)` by quaternions `(…, 4)` (broadcasting)."""
    return np.einsum("...ij,...j->...i", quaternion_to_matrix(q), np.asarray(v, np.float64))


def compose_transforms(translations: ArrayLike, rotations: ArrayLike, scales: ArrayLike) -> F64:
    """`(N, 4, 4)` matrices `T @ R @ S` from `(N, 3)` translations, `(N, 4)` quaternions and
    `(N, 3)` scales."""
    translations = np.asarray(translations, dtype=np.float64)
    matrices = np.zeros((translations.shape[0], 4, 4), dtype=np.float64)
    matrices[:, :3, :3] = quaternion_to_matrix(rotations) * np.asarray(scales)[:, None, :]
    matrices[:, :3, 3] = translations
    matrices[:, 3, 3] = 1.0
    return matrices


def joint_depths(parents: ArrayLike) -> I64:
    """Depth of every joint (roots, whose parent is -1, have depth 0).

    Raises:
        ValueError: on out-of-range parents or cycles.
    """
    parents = np.asarray(parents, dtype=np.int64)
    count = parents.shape[0]
    if np.any((parents < -1) | (parents >= count)):
        raise ValueError("parent index out of range")
    depth = np.full(count, -1, dtype=np.int64)
    for start in range(count):
        chain: list[int] = []
        joint = start
        while joint != -1 and depth[joint] < 0:
            if joint in chain:
                raise ValueError(f"joint hierarchy has a cycle through joint {joint}")
            chain.append(joint)
            joint = int(parents[joint])
        base = -1 if joint == -1 else int(depth[joint])
        for offset, member in enumerate(reversed(chain), start=1):
            depth[member] = base + offset
    return depth


def topological_order(parents: ArrayLike) -> I64:
    """Joint indices ordered so every parent precedes its children."""
    return np.argsort(joint_depths(parents), kind="stable")


def _levels(parents: ArrayLike) -> list[I64]:
    depth = joint_depths(parents)
    return [np.flatnonzero(depth == level) for level in range(int(depth.max(initial=-1)) + 1)]


def forward_kinematics(local: ArrayLike, parents: ArrayLike) -> F64:
    """World matrices `(N, 4, 4)`: `world = parent_world @ local` (matrix rule)."""
    local = np.asarray(local, dtype=np.float64)
    parents = np.asarray(parents, dtype=np.int64)
    world = local.copy()
    for joints in _levels(parents)[1:]:
        world[joints] = world[parents[joints]] @ local[joints]
    return world


def forward_kinematics_trs(
    translations: ArrayLike, rotations: ArrayLike, scales: ArrayLike, parents: ArrayLike
) -> tuple[F64, F64, F64]:
    """Model-space `(translations, rotations, scales)` with Unreal's `FTransform` product:

    `world_q = parent_q * local_q`, `world_s = parent_s * local_s` (per axis) and
    `world_t = parent_q.rotate(parent_s * local_t) + parent_t`.

    Raises:
        ValueError: on negative scales (Unreal switches to a matrix product for those).
    """
    world_t = np.array(translations, dtype=np.float64)
    world_q = np.array(rotations, dtype=np.float64)
    world_s = np.array(scales, dtype=np.float64)
    if np.any(world_s < 0):
        raise ValueError("negative joint scales are not supported")
    parents = np.asarray(parents, dtype=np.int64)
    for joints in _levels(parents)[1:]:
        up = parents[joints]
        world_t[joints] = rotate_vectors(world_q[up], world_s[up] * world_t[joints]) + world_t[up]
        world_q[joints] = quaternion_multiply(world_q[up], world_q[joints])
        world_s[joints] = world_s[up] * world_s[joints]
    return world_t, world_q, world_s
