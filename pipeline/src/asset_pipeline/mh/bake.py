"""Bake morph targets (ARKit 52, visemes) by evaluating the real MetaHuman rig.

A morph target is the difference between two rig evaluations, `pose - reference`, taken on
every baked mesh after blend shapes and skinning (`MetaHumanRig.deform`), so joints, blend
shapes and PSD correctives all contribute exactly as RigLogic combines them:

- ARKit shapes use Unreal's pose controls (Default subtracted) over the rest pose;
  `mouthClose` is `jawOpen + lips together` minus `jawOpen` (see `arkit.py`).
- Visemes use the recipes in `visemes.py` (raw controls) over the rest pose.
- Normal deltas are `normals(deformed) - normals(reference)`, both recomputed the same way
  (area-weighted, per DNA position), so authored-vs-recomputed differences cancel.
- Eyeballs are not baked: they rotate with their joints at runtime, so their deltas stay
  zero (`frozen` meshes). Lids, lashes, tear line, occlusion and teeth are baked; the teeth
  follow the jaw through skinning.
- Wrinkle maps: RigLogic's animated-map outputs `pose - reference`, per target, so the
  runtime can blend wrinkle normals and colours as `sum(morph weight * map weight)`.

Deltas stay in DNA units and axes; `gltf.py` converts them.
"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field

import numpy as np

from asset_pipeline.mh.arkit import ARKIT_NAMES, JAW_OPEN, MOUTH_CLOSE, ArkitMapping
from asset_pipeline.mh.dna import F64, I32, Mesh
from asset_pipeline.mh.rig import MetaHumanRig, RigOutput

MAP_EPSILON = 1e-4  # wrinkle-map weights below this are dropped
EYEBALL_MESHES = ("eyeLeft", "eyeRight")


@dataclass(frozen=True)
class ShapeSpec:
    """Controls of a target pose and of the pose it is measured from ({} = rest)."""

    controls: Mapping[str, float]
    reference: Mapping[str, float] = field(default_factory=dict)


@dataclass(frozen=True, eq=False)
class MeshMorph:
    positions: F64  # (P, 3) position deltas, DNA units
    normals: F64  # (P, 3) normal deltas (difference of unit normals)


@dataclass(frozen=True, eq=False)
class MorphTarget:
    name: str
    spec: ShapeSpec
    meshes: dict[int, MeshMorph]  # by DNA mesh index; absent meshes do not change
    animated_maps: dict[str, float]  # wrinkle-map weight per animated map name


def mesh_kind(mesh_name: str) -> str:
    """`head_lod0_mesh` -> `head` (the stable material / primitive name)."""
    base = mesh_name
    for suffix in ("_mesh",):
        base = base.removesuffix(suffix)
    head, _, lod = base.rpartition("_lod")
    return head if head and lod.isdigit() else base


def vertex_normals(positions: F64, triangles: I32) -> F64:
    """Area-weighted unit normals per position; `triangles` index positions."""
    corners = positions[triangles]
    face = np.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0])
    normals = np.zeros_like(positions)
    for column in range(3):
        np.add.at(normals, triangles[:, column], face)
    length = np.linalg.norm(normals, axis=1, keepdims=True)
    return np.divide(normals, length, out=np.zeros_like(normals), where=length > 0)


class MorphBaker:
    """Evaluates shapes on one LOD's meshes, caching reference deformations."""

    def __init__(
        self,
        rig: MetaHumanRig,
        meshes: Iterable[int | str],
        *,
        frozen: Iterable[int | str] = (),
    ) -> None:
        self.rig = rig
        self.meshes: list[Mesh] = [rig.dna.mesh(m) for m in meshes]
        lods = {rig.dna.lod_of_mesh(mesh.index) for mesh in self.meshes}
        if len(lods) != 1:
            raise ValueError(f"bake meshes span several LODs: {sorted(lods)}")
        self.lod = lods.pop()
        self.frozen = {rig.dna.mesh(m).index for m in frozen}
        self._triangles = {
            mesh.index: mesh.layout_positions[mesh.triangles] for mesh in self.meshes
        }
        self._references: dict[
            tuple[tuple[str, float], ...], tuple[RigOutput, dict[int, tuple[F64, F64]]]
        ] = {}

    def _key(self, controls: Mapping[str, float]) -> tuple[tuple[str, float], ...]:
        return tuple(
            sorted(
                (self.rig.control_names[self.rig.control_index(k)], float(v))
                for k, v in controls.items()
            )
        )

    def _pose(self, controls: Mapping[str, float]) -> tuple[RigOutput, dict[int, tuple[F64, F64]]]:
        output = self.rig.evaluate(controls, lod=self.lod)
        shapes = {}
        for mesh in self.meshes:
            if mesh.index in self.frozen:
                continue
            positions = self.rig.deform(mesh.index, output)
            shapes[mesh.index] = (positions, vertex_normals(positions, self._triangles[mesh.index]))
        return output, shapes

    def _reference(
        self, controls: Mapping[str, float]
    ) -> tuple[RigOutput, dict[int, tuple[F64, F64]]]:
        key = self._key(controls)
        if key not in self._references:
            self._references[key] = self._pose(controls)
        return self._references[key]

    def evaluate(self, controls: Mapping[str, float]) -> RigOutput:
        return self.rig.evaluate(controls, lod=self.lod)

    def bake(self, name: str, spec: ShapeSpec) -> MorphTarget:
        reference_output, reference = self._reference(spec.reference)
        output, posed = self._pose(spec.controls)
        meshes = {}
        for index, (positions, normals) in posed.items():
            base_positions, base_normals = reference[index]
            meshes[index] = MeshMorph(
                positions=positions - base_positions, normals=normals - base_normals
            )
        names = self.rig.dna.behavior.animated_map_names
        maps = output.animated_maps - reference_output.animated_maps
        animated = {
            names[i]: round(float(maps[i]), 6) for i in np.flatnonzero(np.abs(maps) > MAP_EPSILON)
        }
        return MorphTarget(name=name, spec=spec, meshes=meshes, animated_maps=animated)

    def bake_all(self, shapes: Mapping[str, ShapeSpec]) -> list[MorphTarget]:
        return [self.bake(name, spec) for name, spec in shapes.items()]


def arkit_shapes(mapping: ArkitMapping) -> dict[str, ShapeSpec]:
    """The 52 ARKit shapes in Apple's order (`mouthClose` relative to `jawOpen`)."""
    shapes = {}
    for name in ARKIT_NAMES:
        if name == MOUTH_CLOSE:
            shapes[name] = ShapeSpec(
                controls=mapping.controls(MOUTH_CLOSE), reference=mapping.controls(JAW_OPEN)
            )
        else:
            shapes[name] = ShapeSpec(controls=mapping.controls(name))
    return shapes


def viseme_shapes(recipes: Mapping[str, Mapping[str, float]]) -> dict[str, ShapeSpec]:
    """`viseme_<name>` shapes from raw-control recipes (over the rest pose)."""
    return {
        f"viseme_{name}": ShapeSpec(controls=dict(controls)) for name, controls in recipes.items()
    }


def head_bake_meshes(rig: MetaHumanRig, lod: int = 0) -> tuple[list[int], list[int]]:
    """(meshes to bake, eyeball meshes to keep frozen) of a head DNA's LOD."""
    meshes = list(rig.dna.lod_meshes[lod])
    frozen = [m for m in meshes if mesh_kind(rig.dna.mesh_names[m]) in EYEBALL_MESHES]
    return meshes, frozen
