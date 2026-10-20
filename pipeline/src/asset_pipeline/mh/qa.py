"""Geometric quality measures for baked faces (DNA units, centimetres for MetaHumans).

Landmarks come from the neutral head and one rig evaluation, so they work on any
MetaHuman head:

- Lips: vertices near the mouth that follow `jawOpen` are the lower lip, those that do not
  are the upper lip. Lower/upper vertex pairs that touch at rest form the contact line;
  their distance in a pose is the lip gap (sealed = rest closure). The outermost pairs are
  the corners (mouth width); the central pairs' forward motion is the protrusion.
- Teeth: teeth-mesh vertices that do not follow `jawOpen` and are not tongue are the upper
  teeth; the lowest front ones are the incisal edge. Tongue vertices are skinned to
  `*Tongue*` joints; the tongue tip is the front-most one.
- Eyes: head vertices lying on the fitted eyeball sphere in a vertical slice through its
  centre; the largest vertical gap between them is the eye opening.
"""

from dataclasses import dataclass

import numpy as np
from scipy.spatial import cKDTree

from asset_pipeline.mh.dna import F64, I32
from asset_pipeline.mh.rig import MetaHumanRig

JAW_OPEN = "CTRL_expressions.jawOpen"


def sphere_fit(points: F64) -> tuple[F64, float]:
    """Least-squares sphere (centre, radius)."""
    system = np.c_[2 * points, np.ones(len(points))]
    solution = np.linalg.lstsq(system, (points**2).sum(axis=1), rcond=None)[0]
    centre = solution[:3]
    return centre, float(np.sqrt(solution[3] + centre @ centre))


@dataclass(frozen=True, eq=False)
class EyeOpening:
    """Vertical eye opening of one eye, measured on the head mesh."""

    vertices: I32  # head positions on the eyeball in the central slice
    centre: F64
    radius: float

    @classmethod
    def find(cls, head_positions: F64, eyeball_positions: F64) -> "EyeOpening":
        centre, radius = sphere_fit(eyeball_positions)
        distance = np.linalg.norm(head_positions - centre, axis=1)
        selected = np.flatnonzero(
            (np.abs(head_positions[:, 0] - centre[0]) < 0.25)
            & (np.abs(head_positions[:, 1] - centre[1]) < 1.6)
            & (head_positions[:, 2] > centre[2])
            & (distance > radius - 0.15)
            & (distance < radius + 0.4)
        )
        if len(selected) < 10:
            raise ValueError("no eyelid vertices found on the eyeball")
        return cls(vertices=selected, centre=centre, radius=radius)

    def measure(self, head_positions: F64) -> float:
        heights = np.sort(head_positions[self.vertices, 1])
        return float(np.diff(heights).max())


@dataclass(frozen=True, eq=False)
class MouthLandmarks:
    lower_lip: I32  # head positions following the jaw near the mouth
    upper_lip: I32
    pair_lower: I32  # contact pairs at rest, sorted from right (-x) to left (+x)
    pair_upper: I32
    central: np.ndarray  # bool mask over pairs: the middle 70 % of the mouth width
    corner_left: int
    corner_right: int
    incisal_edge: I32  # teeth positions: lowest front upper teeth
    tongue: I32  # teeth positions skinned to tongue joints
    rest_head: F64
    rest_teeth: F64

    @classmethod
    def find(cls, rig: MetaHumanRig, head: int | str, teeth: int | str) -> "MouthLandmarks":
        dna = rig.dna
        head_mesh, teeth_mesh = dna.mesh(head), dna.mesh(teeth)
        lod = dna.lod_of_mesh(head_mesh.index)
        rest = rig.evaluate(lod=lod)
        jaw = rig.evaluate({JAW_OPEN: 1.0}, lod=lod)
        rest_head = rig.deform(head_mesh.index, rest)
        rest_teeth = rig.deform(teeth_mesh.index, rest)
        head_motion = np.linalg.norm(rig.deform(head_mesh.index, jaw) - rest_head, axis=1)
        teeth_motion = np.linalg.norm(rig.deform(teeth_mesh.index, jaw) - rest_teeth, axis=1)
        chin_drop = float(np.percentile(head_motion, 99.5))

        p = rest_head
        # Contact line on the midline: top of the jaw-following lower lip, bottom of the still
        # upper lip between it and the nose tip, both on the front of the face.
        nose = p[np.argmax(p[:, 2])]
        midline = np.flatnonzero((np.abs(p[:, 0]) < 0.25) & (p[:, 2] > nose[2] - 5.0))
        moving = midline[head_motion[midline] > 0.5 * chin_drop]
        lower_edge = p[moving, 1].max()
        still = midline[
            (head_motion[midline] < 0.15 * chin_drop)
            & (p[midline, 1] > lower_edge)
            & (p[midline, 1] < nose[1])
        ]
        contact_y = 0.5 * (lower_edge + p[still, 1].min())
        front = p[midline[np.abs(p[midline, 1] - contact_y) < 1.5], 2].max()
        region = (
            (np.abs(p[:, 1] - contact_y) < 1.6) & (np.abs(p[:, 0]) < 3.6) & (p[:, 2] > front - 2.2)
        )
        lower = np.flatnonzero(region & (head_motion > 0.4 * chin_drop))
        upper = np.flatnonzero(region & (head_motion < 0.16 * chin_drop))
        distance, nearest = cKDTree(p[upper]).query(p[lower])
        touching = distance < 0.2
        pair_lower, pair_upper = lower[touching], upper[nearest[touching]]
        order = np.argsort(p[pair_lower, 0])
        pair_lower, pair_upper = pair_lower[order], pair_upper[order]
        half_width = 0.5 * (p[pair_lower[-1], 0] - p[pair_lower[0], 0])
        central = np.abs(p[pair_lower, 0]) < 0.7 * half_width

        tongue_joints = [i for i, name in enumerate(dna.joints.names) if "Tongue" in name]
        joints, weights = teeth_mesh.skin.dense()
        tongue_weight = (np.isin(joints, tongue_joints) * weights).sum(axis=1)
        tongue = np.flatnonzero(tongue_weight > 0.5)
        upper_teeth = np.flatnonzero((tongue_weight < 0.1) & (teeth_motion < 0.1 * chin_drop))
        front_teeth = upper_teeth[np.abs(rest_teeth[upper_teeth, 0]) < 0.6]
        incisal_edge = front_teeth[np.argsort(rest_teeth[front_teeth, 1])[:30]]
        return cls(
            lower_lip=lower,
            upper_lip=upper,
            pair_lower=pair_lower,
            pair_upper=pair_upper,
            central=central,
            corner_left=int(pair_lower[-1]),
            corner_right=int(pair_lower[0]),
            incisal_edge=incisal_edge,
            tongue=tongue,
            rest_head=rest_head,
            rest_teeth=rest_teeth,
        )

    def lip_gaps(self, head: F64) -> F64:
        return np.linalg.norm(head[self.pair_lower] - head[self.pair_upper], axis=1)

    def measure(self, head: F64, teeth: F64) -> dict[str, float]:
        """Mouth measures of a pose (positions of the head and teeth meshes)."""
        gaps = self.lip_gaps(head)
        rest_width = np.linalg.norm(
            self.rest_head[self.corner_left] - self.rest_head[self.corner_right]
        )
        width = np.linalg.norm(head[self.corner_left] - head[self.corner_right])
        forward = 0.5 * (
            (head - self.rest_head)[self.pair_lower[self.central], 2].mean()
            + (head - self.rest_head)[self.pair_upper[self.central], 2].mean()
        )
        lip_to_teeth = cKDTree(teeth[self.incisal_edge]).query(head[self.lower_lip])[0].min()
        tip = self.tongue[np.argmax(teeth[self.tongue, 2])]
        return {
            "gap_central_max": float(gaps[self.central].max()),
            "gap_max": float(gaps.max()),
            "opening": float(gaps[self.central].mean()),
            "width_ratio": float(width / rest_width),
            "protrusion": float(forward),
            "lower_lip_to_incisors": float(lip_to_teeth),
            "tongue_tip_forward": float(teeth[tip, 2] - teeth[self.incisal_edge, 2].max()),
            "tongue_tip_up": float(teeth[tip, 1] - teeth[self.incisal_edge, 1].mean()),
        }


def chin(rig: MetaHumanRig, head: int | str) -> int:
    """The front-most midline head vertex 4 cm below the jaw joint (the chin)."""
    mesh = rig.dna.mesh(head)
    positions = mesh.positions
    jaw_height = rig.neutral_world_matrices[rig.dna.joints.index("FACIAL_C_Jaw"), 1, 3]
    midline = np.flatnonzero((np.abs(positions[:, 0]) < 0.3) & (positions[:, 1] < jaw_height - 4))
    return int(midline[np.argmax(positions[midline, 2])])
