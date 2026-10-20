"""Write DNA meshes, their skeleton and baked morph targets as a glTF binary.

Contract: `docs/specs/2026-10-20-metahuman-web-assets.md`. One glTF mesh holds one
primitive per DNA mesh; its material is named after the mesh (`head_lod0_mesh` -> `head`).

- Vertices: one per DNA vertex layout (unwelded position/normal/UV indices). UVs move to
  glTF's top-left origin (`v' = 1 - v`). Triangles are DNA polygons fan-split in DNA winding.
- Space: DNA units and axes -> metres, +Y up, character facing +Z (`Space`). MetaHuman DNAs
  (`left, up, front`, cm) only scale by 0.01; a mirrored basis would also flip the winding.
- `_DNA_POSITION` (custom FLOAT attribute): the DNA position index of each vertex, so groom
  cards and seams address DNA positions.
- Skin: every DNA joint is a node with its DNA name; inverse bind matrices come from the
  neutral pose; JOINTS_0/WEIGHTS_0 hold at most 4 influences. Joints that never move at
  runtime (`live_joint` False; for a head with baked expressions, every FACIAL_* joint but
  the eyes) hand their weight to the nearest live ancestor, which is exact while they rest.
  Influences beyond 4 are dropped and each vertex renormalised (the worst dropped weight is
  reported).
- Morph targets: sparse POSITION/NORMAL deltas. Every primitive carries every target (glTF
  requires equal counts); unaffected primitives share one all-zero accessor. Names live in
  `mesh.extras.targetNames` (three.js reads them into `morphTargetDictionary`).
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import ArrayLike

from asset_pipeline.mh.bake import MorphTarget, mesh_kind
from asset_pipeline.mh.dna import F32, F64, I32, Descriptor, DnaFile, Mesh
from asset_pipeline.mh.glb import ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER, GlbBuilder
from asset_pipeline.mh.kinematics import (
    compose_transforms,
    euler_to_quaternion,
    forward_kinematics,
    matrix_to_quaternion,
    quaternion_to_matrix,
    topological_order,
)

GENERATOR = "ai-sims asset-pipeline mh"
# Morph deltas below these are dropped from sparse targets (0.01 mm, 0.03 degrees).
POSITION_EPSILON = 1e-5  # metres
NORMAL_EPSILON = 5e-4
MAX_INFLUENCES = 4
DNA_POSITION_ATTRIBUTE = "_DNA_POSITION"


@dataclass(frozen=True)
class Space:
    """DNA -> glTF: `glTF = (dna @ basis) * scale` for points (rows of `basis` are the DNA
    axes in glTF axes)."""

    basis: F64
    scale: float

    @classmethod
    def from_descriptor(cls, descriptor: Descriptor) -> "Space":
        system = descriptor.coordinate_system
        if not system.valid:
            raise ValueError(f"DNA coordinate system {system} is not a valid basis")
        return cls(basis=system.basis(), scale=descriptor.meters_per_unit)

    @property
    def mirrors(self) -> bool:
        return bool(np.linalg.det(self.basis) < 0)

    def points(self, values: ArrayLike) -> F64:
        return (np.asarray(values, dtype=np.float64) @ self.basis) * self.scale

    def directions(self, values: ArrayLike) -> F64:
        return np.asarray(values, dtype=np.float64) @ self.basis

    def rotations(self, quaternions: ArrayLike) -> F64:
        quaternions = np.asarray(quaternions, dtype=np.float64)
        if np.allclose(self.basis, np.eye(3)):
            return quaternions
        matrices = quaternion_to_matrix(quaternions)
        return matrix_to_quaternion(self.basis.T @ matrices @ self.basis)


@dataclass(frozen=True)
class MaterialSpec:
    """Default glTF material of a DNA mesh kind; texture fields name map files."""

    base_color: str | None = None
    normal: str | None = None
    metallic_roughness: str | None = None  # SRMF: G roughness, B metallic, as glTF expects
    base_color_factor: tuple[float, float, float, float] = (1.0, 1.0, 1.0, 1.0)
    metallic: float = 0.0
    roughness: float = 1.0
    alpha_mode: str = "OPAQUE"
    double_sided: bool = False


# Helper shells (eye occlusion, tear line, saliva, lid cartilage) need the dedicated web
# shaders; generic viewers draw them fully transparent instead of as grey blobs.
_HIDDEN = MaterialSpec(base_color_factor=(1.0, 1.0, 1.0, 0.0), roughness=0.1, alpha_mode="BLEND")
_EYE = MaterialSpec(base_color="Eyes_Color.png", normal="Eyes_Normal.png", roughness=0.05)
MATERIALS: dict[str, MaterialSpec] = {
    "head": MaterialSpec(
        base_color="Head_Basecolor.png",
        normal="Head_Normal.png",
        metallic_roughness="Head_SRMF.png",
        metallic=1.0,
    ),
    "teeth": MaterialSpec(base_color="Teeth_Color.png", normal="Teeth_Normal.png", roughness=0.35),
    "saliva": _HIDDEN,
    "eyeLeft": _EYE,
    "eyeRight": _EYE,
    "eyeshell": _HIDDEN,
    "eyelashes": MaterialSpec(
        base_color="Eyelashes_Color.png", roughness=0.6, alpha_mode="BLEND", double_sided=True
    ),
    "eyeEdge": _HIDDEN,
    "cartilage": _HIDDEN,
    "body": MaterialSpec(
        base_color="Body_Basecolor.png",
        normal="Body_Normal.png",
        metallic_roughness="Body_SRMF.png",
        metallic=1.0,
    ),
}
_SKIN_TONE = MaterialSpec(base_color_factor=(0.8, 0.62, 0.52, 1.0), roughness=0.6)


@dataclass(frozen=True)
class PrimitiveStats:
    vertices: int
    triangles: int
    targets_with_data: int
    max_dropped_weight: float


@dataclass(frozen=True)
class GlbStats:
    path: Path
    size: int
    joints: int
    targets: tuple[str, ...]
    primitives: dict[str, PrimitiveStats] = field(default_factory=dict)


def material_names(dna: DnaFile, mesh_indices: Sequence[int]) -> list[str]:
    return [mesh_kind(dna.mesh_names[index]) for index in mesh_indices]


def live_ancestors(parents: I32, live: np.ndarray) -> I32:
    """For every joint, itself if live, else its nearest live ancestor."""
    target = np.arange(len(parents), dtype=np.int32)
    for joint in topological_order(parents).tolist():
        if not live[joint]:
            parent = parents[joint]
            if parent < 0:
                raise ValueError("a root joint must be live")
            target[joint] = target[parent]
    return target


def merge_influences(
    joints: I32, weights: F32, target: I32, limit: int = MAX_INFLUENCES
) -> tuple[np.ndarray, F32, float]:
    """Remap influences onto `target[joint]`, sum duplicates, keep the `limit` strongest.

    Returns `(joints uint16 (P, limit), weights float32 (P, limit), worst dropped weight)`;
    each row sums to 1 in float32 (rounding goes to its largest weight).
    """
    count, width = joints.shape
    rows = np.repeat(np.arange(count), width)
    mapped = target[joints].ravel().astype(np.int64)
    values = weights.ravel().astype(np.float64)
    keep = values > 0
    joint_count = int(target.max(initial=0)) + 1
    keys, inverse = np.unique(rows[keep] * joint_count + mapped[keep], return_inverse=True)
    summed = np.bincount(inverse, weights=values[keep])
    key_rows, key_joints = keys // joint_count, keys % joint_count
    order = np.lexsort((-summed, key_rows))
    key_rows, key_joints, summed = key_rows[order], key_joints[order], summed[order]
    first = np.searchsorted(key_rows, np.arange(count))
    rank = np.arange(len(key_rows)) - first[key_rows]
    chosen = rank < limit
    out_joints = np.zeros((count, limit), dtype=np.uint16)
    out_weights = np.zeros((count, limit), dtype=np.float64)
    out_joints[key_rows[chosen], rank[chosen]] = key_joints[chosen]
    out_weights[key_rows[chosen], rank[chosen]] = summed[chosen]
    totals = np.bincount(key_rows, weights=summed, minlength=count)
    kept = out_weights.sum(axis=1)
    dropped = float(np.max(1.0 - np.divide(kept, totals, out=np.ones_like(kept), where=totals > 0)))
    if np.any(kept <= 0):
        raise ValueError("a vertex has no skin influence")
    normalized = (out_weights / kept[:, None]).astype(np.float32)
    normalized[:, 0] += np.float32(1.0) - normalized.sum(axis=1, dtype=np.float32)
    return out_joints, normalized, dropped


def neutral_joint_transforms(dna: DnaFile, space: Space) -> tuple[F64, F64]:
    """glTF-space local translations (m) and rotations of the DNA's neutral pose."""
    descriptor = dna.descriptor
    rotations = euler_to_quaternion(
        dna.joints.rotations * descriptor.radians_per_unit,
        descriptor.rotation_sequence,
        descriptor.rotation_signs,
    )
    return space.points(dna.joints.translations), space.rotations(rotations)


class _GlbWriter:
    def __init__(self, dna: DnaFile, space: Space, maps: Mapping[str, str]) -> None:
        self.dna = dna
        self.space = space
        self.maps = maps
        self.builder = GlbBuilder(GENERATOR)
        self._textures: dict[str, int] = {}
        self._sampler: int | None = None

    def texture(self, file_name: str | None) -> int | None:
        if file_name is None or file_name not in self.maps:
            return None
        if file_name not in self._textures:
            if self._sampler is None:
                self._sampler = self.builder.add_sampler()
            image = self.builder.add_image(self.maps[file_name])
            self._textures[file_name] = self.builder.add_texture(image, self._sampler)
        return self._textures[file_name]

    def material(self, name: str) -> int:
        spec = MATERIALS.get(name, _SKIN_TONE)
        base = self.texture(spec.base_color)
        pbr: dict[str, Any] = {
            "baseColorFactor": list(spec.base_color_factor),
            "metallicFactor": spec.metallic if spec.metallic_roughness else 0.0,
            "roughnessFactor": spec.roughness,
        }
        if base is not None:
            pbr["baseColorTexture"] = {"index": base}
        elif spec.base_color is not None:
            pbr["baseColorFactor"] = list(_SKIN_TONE.base_color_factor)
        roughness = self.texture(spec.metallic_roughness)
        if roughness is not None:
            pbr["metallicRoughnessTexture"] = {"index": roughness}
        else:
            pbr["metallicFactor"] = 0.0
        material: dict[str, Any] = {"name": name, "pbrMetallicRoughness": pbr}
        normal = self.texture(spec.normal)
        if normal is not None:
            material["normalTexture"] = {"index": normal}
        if spec.alpha_mode != "OPAQUE":
            material["alphaMode"] = spec.alpha_mode
        if spec.double_sided:
            material["doubleSided"] = True
        return self.builder.add_material(material)

    def primitive(
        self,
        mesh: Mesh,
        material: int,
        skin_target: I32,
        targets: Sequence[MorphTarget],
    ) -> tuple[dict[str, Any], PrimitiveStats]:
        builder, space = self.builder, self.space
        layouts = mesh.layout_positions
        count = len(layouts)
        positions = space.points(mesh.positions)[layouts].astype(np.float32)
        normals = space.directions(mesh.normals)[mesh.layout_normals]
        normals = (normals / np.linalg.norm(normals, axis=1, keepdims=True)).astype(np.float32)
        uvs = mesh.uvs[mesh.layout_uvs].astype(np.float32)
        uvs[:, 1] = np.float32(1.0) - uvs[:, 1]
        triangles = mesh.triangles
        flip = space.mirrors != (self.dna.descriptor.face_winding == "cw")
        if flip:
            triangles = triangles[:, [0, 2, 1]]
        dense_joints, dense_weights = mesh.skin.dense(normalize=True)
        joints, weights, dropped = merge_influences(dense_joints, dense_weights, skin_target)

        attributes = {
            "POSITION": builder.add_accessor(positions, target=ARRAY_BUFFER, bounds=True),
            "NORMAL": builder.add_accessor(normals, target=ARRAY_BUFFER),
            "TEXCOORD_0": builder.add_accessor(uvs, target=ARRAY_BUFFER),
            "JOINTS_0": builder.add_accessor(joints[layouts], target=ARRAY_BUFFER),
            "WEIGHTS_0": builder.add_accessor(weights[layouts], target=ARRAY_BUFFER),
            DNA_POSITION_ATTRIBUTE: builder.add_accessor(
                layouts.astype(np.float32), target=ARRAY_BUFFER
            ),
        }
        index_type = np.uint16 if count <= 65535 else np.uint32
        primitive: dict[str, Any] = {
            "attributes": attributes,
            "indices": builder.add_accessor(
                triangles.astype(index_type).ravel(), target=ELEMENT_ARRAY_BUFFER
            ),
            "material": material,
        }
        morphs, with_data = [], 0
        zero: tuple[int, int] | None = None
        for target in targets:
            morph = target.meshes.get(mesh.index)
            delta_p = delta_n = None
            if morph is not None:
                delta_p = space.points(morph.positions)[layouts].astype(np.float32)
                delta_n = space.directions(morph.normals)[layouts].astype(np.float32)
                moved = np.flatnonzero(np.abs(delta_p).max(axis=1) > POSITION_EPSILON)
                turned = np.flatnonzero(np.abs(delta_n).max(axis=1) > NORMAL_EPSILON)
                if not len(moved) and not len(turned):
                    delta_p = None
            if delta_p is None or delta_n is None:
                if zero is None:
                    zero = (
                        builder.add_zero_accessor(count, 3, bounds=True),
                        builder.add_zero_accessor(count, 3, bounds=False),
                    )
                morphs.append({"POSITION": zero[0], "NORMAL": zero[1]})
                continue
            with_data += 1
            morphs.append(
                {
                    "POSITION": builder.add_sparse_accessor(
                        count, moved, delta_p[moved], bounds=True
                    ),
                    "NORMAL": builder.add_sparse_accessor(
                        count, turned, delta_n[turned], bounds=False
                    ),
                }
            )
        if morphs:
            primitive["targets"] = morphs
        stats = PrimitiveStats(
            vertices=count,
            triangles=len(triangles),
            targets_with_data=with_data,
            max_dropped_weight=dropped,
        )
        return primitive, stats


def write_glb(
    path: Path,
    dna: DnaFile,
    mesh_indices: Sequence[int],
    *,
    targets: Sequence[MorphTarget] = (),
    live_joint: Callable[[str], bool] | None = None,
    maps: Mapping[str, str] | None = None,
    extras: Mapping[str, Any] | None = None,
    mesh_name: str = "head",
) -> GlbStats:
    """Write the given DNA meshes (one LOD), the full DNA skeleton and morph targets.

    Args:
        maps: map file name (e.g. `Head_Basecolor.png`) -> URI relative to the GLB.
        extras: merged into `scene.extras.mh` (kind, preset, seams, wrinkle tables, ...).
    """
    space = Space.from_descriptor(dna.descriptor)
    writer = _GlbWriter(dna, space, maps or {})
    builder = writer.builder
    names = [target.name for target in targets]
    if len(set(names)) != len(names):
        raise ValueError("morph target names must be unique")

    joints = dna.joints
    translations, rotations = neutral_joint_transforms(dna, space)
    first_node = len(builder.document.get("nodes", []))
    children: dict[int, list[int]] = {}
    for joint, parent in enumerate(joints.parents.tolist()):
        if parent >= 0:
            children.setdefault(parent, []).append(first_node + joint)
    for joint, name in enumerate(joints.names):
        node: dict[str, Any] = {
            "name": name,
            "translation": translations[joint].tolist(),
            "rotation": rotations[joint].tolist(),
        }
        if joint in children:
            node["children"] = children[joint]
        builder.add_node(node)
    world = forward_kinematics(
        compose_transforms(translations, rotations, np.ones_like(translations)), joints.parents
    )
    roots = [first_node + j for j in np.flatnonzero(joints.parents < 0).tolist()]
    skin = builder.add_skin(
        {
            "name": f"{mesh_name}_skin",
            "joints": list(range(first_node, first_node + len(joints))),
            "inverseBindMatrices": builder.add_matrices(np.linalg.inv(world)),
            "skeleton": roots[0],
        }
    )

    live = np.array([True if live_joint is None else live_joint(n) for n in joints.names])
    skin_target = live_ancestors(joints.parents, live)
    primitives, stats = [], {}
    for index in mesh_indices:
        mesh = dna.mesh(index)
        kind = mesh_kind(mesh.name)
        primitive, primitive_stats = writer.primitive(
            mesh, writer.material(kind), skin_target, targets
        )
        primitives.append(primitive)
        stats[kind] = primitive_stats
    gltf_mesh: dict[str, Any] = {"name": mesh_name, "primitives": primitives}
    if targets:
        gltf_mesh["weights"] = [0.0] * len(targets)
        gltf_mesh["extras"] = {"targetNames": names}
    mesh_node = builder.add_node(
        {"name": mesh_name, "mesh": builder.add_mesh(gltf_mesh), "skin": skin}
    )

    mh = {
        "units": "m",
        "up": "+Y",
        "forward": "+Z",
        "lod": dna.lod_of_mesh(mesh_indices[0]),
        "dna_position_index": {
            "attribute": DNA_POSITION_ATTRIBUTE,
            "primitives": [mesh_kind(dna.mesh_names[i]) for i in mesh_indices],
        },
        "skin": {
            "max_influences": MAX_INFLUENCES,
            "live_joints": [
                n for n, alive in zip(joints.names, live.tolist(), strict=True) if alive
            ],
            "merged_into_live_ancestor": not bool(live.all()),
        },
        **(extras or {}),
    }
    builder.add_scene([*roots, mesh_node], extras={"mh": mh})
    data = builder.to_glb()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".glb.tmp")
    temporary.write_bytes(data)
    temporary.replace(path)
    return GlbStats(
        path=path, size=len(data), joints=len(joints), targets=tuple(names), primitives=stats
    )
