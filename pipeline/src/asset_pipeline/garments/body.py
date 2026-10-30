"""Measurements of Unreal's outfit-base body for drafting patterns.

Positions are glTF as `ue outfits` exported them: Y up, metres, front +z, A-pose, no head.
Arm vertices are left out of the cross-sections (in the A-pose the hands hang beside the
hips); they are told apart by the joint that weighs most on them.
"""

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from numpy.typing import NDArray
from scipy.spatial import ConvexHull, QhullError

from asset_pipeline.garments import GarmentError
from asset_pipeline.mh.glb import accessor_array, accessor_values, read_glb

F64 = NDArray[np.float64]

ARM_PARTS = (
    "clavicle",
    "upperarm",
    "lowerarm",
    "hand",
    "wrist",
    "elbow",
    "thumb",
    "index",
    "middle",
    "ring",
    "pinky",
)
LIMB_PARTS = tuple(part for part in ARM_PARTS if part != "clavicle")
SECTION_BAND = 0.008  # half-height of the slab of vertices one cross-section takes (m)


def is_arm_joint(name: str) -> bool:
    """Shoulder, arm, hand and finger joints; toes share finger names (`ringtoe_01_l`)."""
    lower = name.lower()
    return "toe" not in lower and any(part in lower for part in ARM_PARTS)


def is_limb_joint(name: str) -> bool:
    """Arm joints from the shoulder down: the clavicle's skin is the top of the torso."""
    lower = name.lower()
    return "toe" not in lower and any(part in lower for part in LIMB_PARTS)


@dataclass(frozen=True, eq=False)
class BaseBody:
    positions: F64  # (V, 3)
    triangles: NDArray[np.int64]  # (T, 3)
    arm: NDArray[np.bool_]  # (V,) vertices an arm joint weighs most on
    limb: NDArray[np.bool_] | None = None  # (V,) the same without the clavicles
    joints: dict[str, F64] = field(default_factory=dict)  # bind position per joint name

    @property
    def trunk(self) -> F64:
        """Torso and leg vertices."""
        return self.positions[~self.arm]

    @property
    def top(self) -> float:
        return float(self.positions[:, 1].max())


def load_base_body(path: Path) -> BaseBody:
    document, binary = read_glb(path.read_bytes())
    primitive = document["meshes"][0]["primitives"][0]
    attributes = primitive["attributes"]
    positions = accessor_values(document, binary, attributes["POSITION"])
    triangles = accessor_array(document, binary, primitive["indices"]).reshape(-1, 3)
    keys = sorted(k for k in attributes if k.startswith("JOINTS_"))
    if not keys or not document.get("skins"):
        raise GarmentError(f"{path.name}: the base body has no skin to tell arms apart")
    joints = np.concatenate([accessor_array(document, binary, attributes[k]) for k in keys], 1)
    weights = np.concatenate(
        [
            accessor_values(document, binary, attributes[k.replace("JOINTS", "WEIGHTS")])
            for k in keys
        ],
        1,
    )
    skin = document["skins"][0]
    names = [document["nodes"][j].get("name", "") for j in skin["joints"]]
    arm_joint = np.array([is_arm_joint(n) for n in names])
    limb_joint = np.array([is_limb_joint(n) for n in names])
    heaviest = joints[np.arange(len(joints)), weights.argmax(1)]
    # glTF stores the inverse binds column-major; the bind world is their inverse.
    inverse = accessor_values(document, binary, skin["inverseBindMatrices"]).reshape(-1, 4, 4)
    world = np.linalg.inv(np.transpose(inverse, (0, 2, 1)))
    return BaseBody(
        positions,
        triangles.astype(np.int64),
        arm_joint[heaviest],
        limb_joint[heaviest],
        {name: world[i, :3, 3].copy() for i, name in enumerate(names)},
    )


@dataclass(frozen=True, eq=False)
class Section:
    """Convex hull of the body's horizontal slab at one height, in the (x, z) plane."""

    height: float
    hull: F64  # (K, 2) counter-clockwise seen from above (+y)

    @property
    def perimeter(self) -> float:
        return float(np.linalg.norm(np.roll(self.hull, -1, 0) - self.hull, axis=1).sum())


def convex_hull(points: F64) -> F64:
    """Hull vertices of 2D points, counter-clockwise in (x, z) seen from +y."""
    try:
        hull = points[ConvexHull(points).vertices]
    except (QhullError, ValueError) as error:
        raise GarmentError(f"no hull through {len(points)} points") from error
    # scipy orders 2D hulls counter-clockwise in (x, z); seen from +y that axis pair is
    # mirrored (x right, z towards the viewer), so reverse it.
    return hull[::-1].copy()


def section(points: F64, height: float, band: float = SECTION_BAND) -> Section:
    slab = points[np.abs(points[:, 1] - height) < band]
    if len(slab) < 3:
        raise GarmentError(f"no body at height {height:.3f} m")
    return Section(height, convex_hull(slab[:, [0, 2]]))


def offset_hull(hull: F64, distance: float, segments: int = 32) -> F64:
    """The convex hull grown by `distance` (Minkowski sum with a disc); its perimeter grows
    by 2 pi distance."""
    if distance <= 0:
        return hull
    angles = np.linspace(0, 2 * np.pi, segments, endpoint=False)
    disc = distance * np.stack([np.cos(angles), np.sin(angles)], 1)
    return convex_hull((hull[:, None, :] + disc[None]).reshape(-1, 2))


@dataclass(frozen=True)
class Landmarks:
    waist: float  # narrowest torso height
    hip: float  # widest hip height
    knee: float  # narrowest leg height around the knee


def landmarks(body: BaseBody, step: float = 0.005) -> Landmarks:
    """Heights searched as fractions of the body's top (neck), which suits both genders."""
    trunk = body.trunk
    top = body.top

    def pick(low: float, high: float, widest: bool) -> float:
        heights = np.arange(low * top, high * top, step)
        perimeters = np.array([section(trunk, float(h)).perimeter for h in heights])
        return float(heights[perimeters.argmax() if widest else perimeters.argmin()])

    return Landmarks(
        waist=pick(0.70, 0.82, widest=False),
        hip=pick(0.52, 0.66, widest=True),
        knee=pick(0.28, 0.40, widest=False),
    )
