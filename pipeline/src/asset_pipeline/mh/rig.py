"""Evaluate the real MetaHuman rig with RigLogic and deform DNA meshes with it.

RigLogic semantics, from the OpenRigLogic 13.2.9 sources (`examples/Advanced.cpp`,
`src/riglogic/joints/`) and Unreal's `AnimNode_RigLogic.cpp`, and checked against the
archetype head:

- Inputs are the DNA *raw controls* (`CTRL_expressions.jawOpen`, …). Expression controls
  rest at 0. Joint-driver controls (`head.qx` … `head.qw` feed the neck-corrective RBF
  solver; body DNAs feed twist/swing and RBF solvers the same way) are the components of a
  joint's rotation relative to its neutral, so they rest at the identity quaternion. The
  rest vector is RigLogic's own initial input state (`.w`/`.qw` solver inputs = 1); unit
  quaternions are required, all-zero drivers make RigLogic output NaN.
  RigLogic appends the PSD, machine-learned and RBF pose controls it computes, in that
  order, to form its input vector (`[raw | PSD | ML | RBF]`).
- Joint outputs are *deltas* from the neutral pose, one record per DNA joint for all joints;
  joints outside the evaluated LOD keep the identity delta. This module configures
  quaternion rotations, so a record is 10 floats `[tx, ty, tz, qx, qy, qz, qw, sx, sy, sz]`
  (DNA translation units). Each evaluation uses a fresh RigInstance (8 µs), so results
  never depend on earlier calls.
- Absolute local (parent-space) transform of a joint, exactly as Unreal applies it:
  `translation = neutral_t + delta_t`, `rotation = neutral_q * delta_q` (the delta acts
  first, in the joint's neutral frame), `scale = 1 + delta_s` (the neutral scale is 1).
  Neutral quaternions come from `RigLogic.getNeutralJointValues()`, i.e. the DNA Euler
  angles converted with the DNA rotation sequence and signs.
- Blend shape outputs are weights per DNA blend shape channel; animated map outputs are
  wrinkle-mask intensities per animated map.
- Joints and mesh positions share one model space (DNA units and axes; mesh positions are
  the neutral pose), so linear blend skinning uses `world_evaluated @ inverse(world_neutral)`.

Body rigs: RigLogic outputs only the corrective joints; the driver joints themselves (and
the face rig's neck/head) are posed by animation, which callers must apply separately.
"""

import difflib
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path

import numpy as np
from numpy.typing import ArrayLike

from asset_pipeline.mh.dna import (
    F32,
    F64,
    I32,
    DnaFile,
    Mesh,
    SwigProxy,
    open_reader,
    read_dna,
)
from asset_pipeline.mh.kinematics import (
    compose_transforms,
    forward_kinematics_trs,
    quaternion_multiply,
)
from asset_pipeline.mh.openriglogic import load_openriglogic

JOINT_RECORD = 10  # tx ty tz qx qy qz qw sx sy sz
IDENTITY_DELTA = np.array([0, 0, 0, 0, 0, 0, 1, 0, 0, 0], dtype=np.float64)


def normalize_control_name(name: str) -> str:
    """Key used to match control names loosely: Unreal curves lower-case the name and use
    '_' where the DNA uses '.' (`CTRL_expressions_jawOpen` vs `CTRL_expressions.jawOpen`)."""
    return name.lower().replace(".", "_")


@dataclass(frozen=True, eq=False)
class RigOutput:
    """One evaluation of the rig (DNA units and axes)."""

    lod: int
    raw_controls: F64  # (R,) inputs that were evaluated
    joint_deltas: F64  # (J, 10) RigLogic joint outputs: deltas from neutral
    blend_shape_weights: F64  # (C,) per blend shape channel
    animated_maps: F64  # (A,) per animated map
    psd_controls: F64  # (P,) PSD values RigLogic computed
    local_translations: F64  # (J, 3) neutral + delta, parent space
    local_rotations: F64  # (J, 4) quaternions (x, y, z, w): neutral * delta
    local_scales: F64  # (J, 3) 1 + delta
    parents: I32 = field(repr=False)  # (J,), -1 for roots

    def local_matrices(self) -> F64:
        """`(J, 4, 4)` parent-space matrices `T @ R @ S`."""
        return compose_transforms(self.local_translations, self.local_rotations, self.local_scales)

    @cached_property
    def world_transforms(self) -> tuple[F64, F64, F64]:
        """Model-space `(translations, rotations, scales)` composed like Unreal's
        `FTransform` (see `kinematics.forward_kinematics_trs`)."""
        return forward_kinematics_trs(
            self.local_translations, self.local_rotations, self.local_scales, self.parents
        )

    @cached_property
    def world_matrices(self) -> F64:
        """`(J, 4, 4)` model-space matrices of `world_transforms`.

        In the MetaHuman face rig only the leaf pupil joints scale (uniformly), so this equals
        plain matrix forward kinematics; the Unreal rule keeps it exact for any rig.
        """
        return compose_transforms(*self.world_transforms)

    def joint_positions(self) -> F64:
        """`(J, 3)` model-space joint origins."""
        return self.world_matrices[:, :3, 3]


class MetaHumanRig:
    """RigLogic evaluation and mesh deformation for one DNA."""

    def __init__(self, dna: DnaFile, *, calculation: str = "scalar") -> None:
        """
        Args:
            dna: the DNA's data; meshes are only needed for `deform`.
            calculation: "scalar" (deterministic reference) or "vector" (RigLogic's SIMD
                path, if the bindings were built with it). Both use float32, not half floats.
        """
        bindings = load_openriglogic()
        riglogic = bindings.riglogic
        calculations = {
            "scalar": riglogic.CalculationType_Scalar,
            "vector": riglogic.CalculationType_AnyVector,
        }
        if calculation not in calculations:
            raise ValueError(f"calculation must be one of {sorted(calculations)}")

        self.dna = dna
        # A second, geometry-free reader: RigLogic copies what it needs at creation.
        self._handle = open_reader(dna.path, geometry=False)
        config = riglogic.Configuration()
        config.calculationType = calculations[calculation]
        config.floatingPointType = riglogic.FloatingPointType_Float
        config.rotationType = riglogic.RotationType_Quaternions
        self._riglogic = riglogic
        self._rig = riglogic.RigLogic(self._handle.reader, config)

        fresh = self._new_instance()
        self.control_names: tuple[str, ...] = dna.behavior.raw_control_names
        if fresh.getRawControlCount() != len(self.control_names):
            raise RuntimeError("RigLogic and the DNA disagree on the raw control count")
        # RigLogic initialises quaternion-w solver inputs to 1; that is the rest pose.
        self._rest = np.asarray(fresh.getRawControlValues(), dtype=np.float64)
        self._rest.flags.writeable = False
        self.joint_names: tuple[str, ...] = dna.joints.names
        self.parents: I32 = dna.joints.parents
        self.lod_count: int = int(self._rig.getLODCount())

        neutral = np.asarray(self._rig.getNeutralJointValues(), dtype=np.float64)
        neutral = neutral.reshape(len(self.joint_names), JOINT_RECORD)
        self.neutral_translations: F64 = neutral[:, 0:3]
        self.neutral_rotations: F64 = neutral[:, 3:7]
        self.neutral_scales: F64 = neutral[:, 7:10]
        self.neutral_world_matrices: F64 = compose_transforms(
            *forward_kinematics_trs(
                self.neutral_translations, self.neutral_rotations, self.neutral_scales, self.parents
            )
        )
        self._inverse_neutral_world = np.linalg.inv(self.neutral_world_matrices)

        self._exact = {name: i for i, name in enumerate(self.control_names)}
        self._loose: dict[str, int] = {}
        self._ambiguous: set[str] = set()
        for i, name in enumerate(self.control_names):
            key = normalize_control_name(name)
            if key in self._loose:
                self._ambiguous.add(key)
            self._loose[key] = i
        self._skin_cache: dict[int, tuple[I32, F32]] = {}

    @classmethod
    def from_path(cls, path: Path | str, *, lods: Iterable[int] | None = None) -> "MetaHumanRig":
        """Read a DNA (meshes of `lods`, default all) and build its rig."""
        return cls(read_dna(path, lods=lods))

    def _new_instance(self) -> SwigProxy:
        """A RigInstance in RigLogic's initial state (buffers reset, LOD 0)."""
        return self._riglogic.RigInstance(self._rig)

    # ------------------------------------------------------------------------ controls

    @property
    def control_count(self) -> int:
        return len(self.control_names)

    def control_index(self, name: str) -> int:
        """Index of a raw control by exact DNA name, else by `normalize_control_name`.

        Raises:
            KeyError: unknown or ambiguous name (with close matches in the message).
        """
        if name in self._exact:
            return self._exact[name]
        key = normalize_control_name(name)
        if key in self._ambiguous:
            raise KeyError(f"control {name!r} matches several DNA controls; use the exact name")
        if key in self._loose:
            return self._loose[key]
        close = difflib.get_close_matches(name, self.control_names, n=5, cutoff=0.5)
        raise KeyError(f"no raw control {name!r} in {self.dna.path.name} (close: {close})")

    def rest_controls(self) -> F64:
        """Raw control values of the neutral pose (a copy): RigLogic's initial input state,
        0 everywhere except the `.w`/`.qw` inputs of RBF, twist and swing solvers (1)."""
        return self._rest.copy()

    # ------------------------------------------------------------------------ evaluation

    def evaluate(self, controls: Mapping[str, float] | None = None, lod: int = 0) -> RigOutput:
        """Evaluate the rig with `controls` ({raw control name: value}) over the rest pose.

        Names match exactly or loosely (Unreal curve spelling); values are not clamped.
        """
        values = self.rest_controls()
        for name, value in (controls or {}).items():
            values[self.control_index(name)] = float(value)
        return self.evaluate_raw(values, lod)

    def evaluate_raw(self, values: ArrayLike, lod: int = 0) -> RigOutput:
        """Evaluate the rig with a full `(R,)` raw control vector (see `rest_controls`).

        Raises:
            ValueError: bad shape or LOD, or RigLogic produced non-finite outputs, which
                happens when joint-driver quaternions are not unit (e.g. all zeros).
        """
        values = np.asarray(values, dtype=np.float64)
        if values.shape != (self.control_count,):
            raise ValueError(
                f"expected {self.control_count} raw control values, got {values.shape}"
            )
        if not 0 <= lod < self.lod_count:
            raise ValueError(f"LOD {lod} out of range (rig has {self.lod_count})")
        instance = self._new_instance()
        instance.setLOD(lod)
        for index, value in enumerate(values.tolist()):
            instance.setRawControl(index, value)
        self._rig.calculate(instance)

        deltas = np.asarray(instance.getJointOutputs(), dtype=np.float64)
        deltas = deltas.reshape(len(self.joint_names), JOINT_RECORD)
        if not np.isfinite(deltas).all():
            raise ValueError(
                "RigLogic produced non-finite joint outputs; joint-driver controls "
                "(*.qx … *.qw) must form unit quaternions (identity: qw = 1)"
            )
        return RigOutput(
            lod=lod,
            raw_controls=np.asarray(instance.getRawControlValues(), dtype=np.float64),
            joint_deltas=deltas,
            blend_shape_weights=np.asarray(instance.getBlendShapeOutputs(), dtype=np.float64),
            animated_maps=np.asarray(instance.getAnimatedMapOutputs(), dtype=np.float64),
            psd_controls=np.asarray(instance.getPSDControlValues(), dtype=np.float64),
            local_translations=self.neutral_translations + deltas[:, 0:3],
            local_rotations=quaternion_multiply(self.neutral_rotations, deltas[:, 3:7]),
            local_scales=self.neutral_scales + deltas[:, 7:10],
            parents=self.parents,
        )

    # ------------------------------------------------------------------------ deformation

    def skinning_matrices(self, output: RigOutput) -> F64:
        """`(J, 4, 4)` matrices taking neutral model space to evaluated model space."""
        return output.world_matrices @ self._inverse_neutral_world

    def _dense_skin(self, mesh: Mesh) -> tuple[I32, F32]:
        if mesh.index not in self._skin_cache:
            self._skin_cache[mesh.index] = mesh.skin.dense(normalize=True)
        return self._skin_cache[mesh.index]

    def deform(
        self,
        mesh: int | str,
        output: RigOutput,
        *,
        blend_shapes: bool = True,
        skinning: bool = True,
    ) -> F64:
        """Deformed `(P, 3)` positions of a mesh: neutral positions, plus blend shape deltas
        weighted by the evaluated channels, then linear blend skinning.

        Skin weights are renormalised per position (glTF requires it; MetaHuman weights
        already sum to 1). Positions without any influence keep their blend-shaped position.

        Raises:
            ValueError: the mesh does not belong to the LOD the output was evaluated at
                (joints outside that LOD are not driven, so the result would be wrong).
        """
        data = self.dna.mesh(mesh)
        if data.index not in self.dna.lod_meshes[output.lod]:
            raise ValueError(
                f"{data.name} is a LOD {self.dna.lod_of_mesh(data.index)} mesh but the rig was "
                f"evaluated at LOD {output.lod}"
            )
        positions = data.positions.astype(np.float64)
        if blend_shapes:
            for target in data.blend_shapes:
                weight = output.blend_shape_weights[target.channel]
                if weight != 0.0:
                    np.add.at(positions, target.vertices, weight * target.deltas.astype(np.float64))
        if not skinning:
            return positions

        joints, weights = self._dense_skin(data)
        skin = self.skinning_matrices(output)[:, :3, :]  # (J, 3, 4)
        blended = np.einsum("pm,pmij->pij", weights.astype(np.float64), skin[joints])
        skinned = np.einsum("pij,pj->pi", blended[:, :, :3], positions) + blended[:, :, 3]
        unweighted = weights.sum(axis=1) == 0
        skinned[unweighted] = positions[unweighted]
        return skinned

    def displacements(self, mesh: int | str, output: RigOutput) -> F64:
        """`(P, 3)` deformed minus neutral positions."""
        return self.deform(mesh, output) - self.dna.mesh(mesh).positions.astype(np.float64)
