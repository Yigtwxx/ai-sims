"""Read MetaHuman DNA files into plain dataclasses of numpy arrays.

Everything stays in the DNA's own units and axes; nothing is converted to glTF here. For
MetaHuman DNAs (file format 2.x) that means:

- translations and positions in `Descriptor.translation_unit` (centimetres),
- joint rotations as Euler angles in `Descriptor.rotation_unit` (degrees) applied in
  `Descriptor.rotation_sequence` ("xyz": `R = Rz @ Ry @ Rx`) with `rotation_signs`,
- axes described by `Descriptor.coordinate_system`: ("left", "up", "front") means +x is the
  character's left, +y up and +z the direction the character faces (right-handed, Y-up;
  identical to glTF axes for a character facing +Z),
- UVs as stored, with the origin at the bottom-left (Unreal and glTF use `v' = 1 - v`),
- polygons in the stored winding order (`Descriptor.face_winding`, "ccw" for MetaHumans).

Indices: a mesh has positions, normals and UVs as separate arrays; a *vertex layout* (one
render vertex) picks one of each. Faces reference layouts, skin weights and blend shape
deltas reference positions.
"""

import difflib
from collections.abc import Collection, Iterable, Mapping
from dataclasses import dataclass, field
from functools import cache, cached_property
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from asset_pipeline.mh.openriglogic import load_openriglogic

type F32 = NDArray[np.float32]
type F64 = NDArray[np.float64]
type I32 = NDArray[np.int32]
type I64 = NDArray[np.int64]
# Objects produced by the SWIG bindings carry no type information.
type SwigProxy = Any

_AXIS_UNIT_VECTORS = {
    "left": (1.0, 0.0, 0.0),
    "right": (-1.0, 0.0, 0.0),
    "up": (0.0, 1.0, 0.0),
    "down": (0.0, -1.0, 0.0),
    "front": (0.0, 0.0, 1.0),
    "back": (0.0, 0.0, -1.0),
}


class DnaReadError(RuntimeError):
    """The DNA file is missing or the DNA library rejected it."""


# ---------------------------------------------------------------------------- data types


@dataclass(frozen=True)
class CoordinateSystem:
    """Directions of the DNA's x, y and z axes, named from the character's point of view.

    MetaHuman DNAs use ("left", "up", "front"). Some template DNAs leave the field
    uninitialised (all "left"); `valid` is False for those.
    """

    x: str
    y: str
    z: str

    def basis(self) -> F64:
        """Rows are the DNA x, y, z axes in the canonical frame (+x character's left, +y up,
        +z character's front), which is glTF's frame for a character facing +Z."""
        return np.array([_AXIS_UNIT_VECTORS[axis] for axis in (self.x, self.y, self.z)])

    @property
    def valid(self) -> bool:
        return bool(np.isclose(abs(np.linalg.det(self.basis())), 1.0))

    @property
    def right_handed(self) -> bool:
        return bool(np.linalg.det(self.basis()) > 0.5)


@dataclass(frozen=True)
class Descriptor:
    name: str
    archetype: str
    gender: str
    age: int
    metadata: Mapping[str, str]
    translation_unit: str  # "cm" | "m"
    rotation_unit: str  # "degrees" | "radians"
    coordinate_system: CoordinateSystem
    rotation_sequence: str  # "xyz" | "xzy" | "yxz" | "yzx" | "zxy" | "zyx"
    rotation_signs: tuple[int, int, int]  # +1 / -1 per axis
    face_winding: str  # "ccw" | "cw"
    lod_count: int
    db_max_lod: int
    db_complexity: str
    db_name: str
    file_format: tuple[int, int]  # (generation, version), e.g. (2, 5)

    @property
    def meters_per_unit(self) -> float:
        return {"cm": 0.01, "m": 1.0}[self.translation_unit]

    @property
    def radians_per_unit(self) -> float:
        return {"degrees": float(np.pi / 180.0), "radians": 1.0}[self.rotation_unit]


@dataclass(frozen=True, eq=False)
class Joints:
    """Joint hierarchy and neutral (bind) pose in parent space."""

    names: tuple[str, ...]
    parents: I32  # (J,), -1 for roots (the DNA stores a root as its own parent)
    translations: F64  # (J, 3) parent-space translation, DNA translation units
    rotations: F64  # (J, 3) Euler (x, y, z), DNA rotation units and sequence
    lod_joints: tuple[I32, ...]  # joint indices active per LOD

    def __len__(self) -> int:
        return len(self.names)

    @cached_property
    def _index(self) -> dict[str, int]:
        return {name: i for i, name in enumerate(self.names)}

    def index(self, name: str) -> int:
        try:
            return self._index[name]
        except KeyError:
            close = difflib.get_close_matches(name, self.names, n=5)
            raise KeyError(f"no joint {name!r} (close: {close})") from None


@dataclass(frozen=True, eq=False)
class SkinWeights:
    """Joint influences per vertex position, in compressed rows.

    Influences of position `p` are `joints[offsets[p]:offsets[p + 1]]` with matching
    `weights`, as stored in the DNA (not renormalised).
    """

    offsets: I64  # (P + 1,)
    joints: I32  # (K,)
    weights: F32  # (K,)
    max_influences: int  # as declared by the DNA for this mesh

    @property
    def position_count(self) -> int:
        return len(self.offsets) - 1

    def dense(self, influences: int | None = None, *, normalize: bool = True) -> tuple[I32, F32]:
        """`(P, M)` joint indices and weights, strongest first, padded with joint 0 / weight 0.

        Args:
            influences: number of columns M; defaults to the largest per-vertex count. Extra
                influences are dropped (smallest first).
            normalize: rescale each row to sum to 1 (rows with no weight stay zero).
        """
        counts = np.diff(self.offsets)
        width = int(counts.max(initial=0)) if influences is None else influences
        rows = np.repeat(np.arange(self.position_count), counts)
        slots = np.arange(len(self.joints)) - np.repeat(self.offsets[:-1], counts)
        full_width = int(counts.max(initial=0))
        joints = np.zeros((self.position_count, max(full_width, 1)), dtype=np.int32)
        weights = np.zeros((self.position_count, max(full_width, 1)), dtype=np.float32)
        joints[rows, slots] = self.joints
        weights[rows, slots] = self.weights
        order = np.argsort(-weights, axis=1, kind="stable")[:, :width]
        joints = np.take_along_axis(joints, order, axis=1)
        weights = np.take_along_axis(weights, order, axis=1)
        if width > full_width:
            pad = width - full_width
            joints = np.pad(joints, ((0, 0), (0, pad)))
            weights = np.pad(weights, ((0, 0), (0, pad)))
        if normalize:
            totals = weights.sum(axis=1, keepdims=True)
            weights = np.divide(weights, totals, out=np.zeros_like(weights), where=totals > 0)
        return joints, weights


@dataclass(frozen=True, eq=False)
class BlendShapeTarget:
    """Sparse position deltas of one mesh, driven by blend shape channel `channel`."""

    channel: int
    vertices: I32  # (D,) position indices
    deltas: F32  # (D, 3) DNA translation units


@dataclass(frozen=True, eq=False)
class Mesh:
    index: int
    name: str
    positions: F32  # (P, 3)
    normals: F32  # (N, 3)
    uvs: F32  # (T, 2), origin bottom-left as stored
    layout_positions: I32  # (V,) index into positions per vertex layout
    layout_uvs: I32  # (V,)
    layout_normals: I32  # (V,)
    face_offsets: I64  # (F + 1,) polygon i is face_layouts[face_offsets[i]:face_offsets[i + 1]]
    face_layouts: I32  # vertex layout indices of all polygons, concatenated
    triangles: I32  # (T, 3) vertex layout indices, fan-triangulated in stored winding
    triangle_faces: I32  # (T,) source polygon of each triangle
    skin: SkinWeights
    blend_shapes: tuple[BlendShapeTarget, ...]

    @property
    def layout_count(self) -> int:
        return len(self.layout_positions)

    @property
    def face_count(self) -> int:
        return len(self.face_offsets) - 1

    def face(self, index: int) -> I32:
        return self.face_layouts[self.face_offsets[index] : self.face_offsets[index + 1]]


@dataclass(frozen=True, eq=False)
class ConditionalTable:
    """Piecewise-linear mapping used for GUI->raw controls and animated maps (RigLogic
    `ConditionalTable`): a row whose interval `from_values <= x <= to_values` contains its
    input `x` adds `slopes * x + cuts` to its output; outputs are clamped to [0, 1]."""

    inputs: I32
    outputs: I32
    from_values: F32
    to_values: F32
    slopes: F32
    cuts: F32


@dataclass(frozen=True, eq=False)
class Psds:
    """Pose space deformers (corrective combinations), as RigLogic's `PSDNet` evaluates them:
    `psd = min(1, prod(values) * prod(clamp(input[c], 0, 1) for its columns c))`.

    Indices address RigLogic's input vector `[raw | PSD | ML | RBF pose controls]`, so a
    PSD may combine raw controls, other PSDs and RBF outputs (the neck correctives).
    """

    count: int
    rows: I32  # input index of the PSD (raw control count + PSD index), per entry
    columns: I32  # input index of a contributing control, per entry
    values: F32  # weight per entry


@dataclass(frozen=True, eq=False)
class Behavior:
    """Rig behaviour metadata. RigLogic evaluates it; this is for inspection and baking."""

    gui_control_names: tuple[str, ...]
    raw_control_names: tuple[str, ...]
    gui_to_raw: ConditionalTable
    psds: Psds
    blend_shape_channel_names: tuple[str, ...]
    blend_shape_lods: I32  # input index count per LOD (BehaviorReader semantics)
    blend_shape_inputs: I32  # input index (raw control or PSD) per entry
    blend_shape_outputs: I32  # blend shape channel per entry
    lod_blend_shape_channels: tuple[I32, ...]  # definition-layer channel indices per LOD
    animated_map_names: tuple[str, ...]
    animated_map_lods: I32  # conditional table rows per LOD
    animated_maps: ConditionalTable
    lod_animated_maps: tuple[I32, ...]
    joint_group_count: int
    rbf_solver_names: tuple[str, ...]
    rbf_pose_names: tuple[str, ...]
    rbf_pose_control_names: tuple[str, ...]  # RBF outputs, last in the input vector
    ml_control_names: tuple[str, ...]
    # Joints listed by joint groups / twist and swing setups (sorted). In a body DNA these are
    # exactly the correctives and twists RigLogic poses; a face DNA also lists the body
    # joints it shares (spine_04 ... head) without really driving them.
    joint_group_joints: I32
    twist_swing_joints: I32

    @property
    def driven_joints(self) -> I32:
        """Joints RigLogic may write (joint groups plus twist/swing outputs)."""
        return np.union1d(self.joint_group_joints, self.twist_swing_joints).astype(np.int32)

    @property
    def input_count(self) -> int:
        """Length of RigLogic's input vector `[raw | PSD | ML | RBF pose controls]`."""
        return (
            len(self.raw_control_names)
            + self.psds.count
            + len(self.ml_control_names)
            + len(self.rbf_pose_control_names)
        )


@dataclass(frozen=True, eq=False)
class DnaFile:
    path: Path
    descriptor: Descriptor
    joints: Joints
    behavior: Behavior
    mesh_names: tuple[str, ...]
    lod_meshes: tuple[tuple[int, ...], ...]  # mesh indices per LOD
    meshes: Mapping[int, Mesh] = field(repr=False)  # only the meshes that were read

    def mesh(self, key: int | str) -> Mesh:
        """A mesh that was read, by DNA mesh index or name."""
        if isinstance(key, str):
            if key not in self.mesh_names:
                close = difflib.get_close_matches(key, self.mesh_names, n=5)
                raise KeyError(f"no mesh {key!r} in {self.path.name} (close: {close})")
            index = self.mesh_names.index(key)
        else:
            index = key
        try:
            return self.meshes[index]
        except KeyError:
            raise KeyError(f"mesh {key!r} was not read (read_dna(..., lods=...))") from None

    def meshes_for_lod(self, lod: int) -> list[Mesh]:
        return [self.meshes[i] for i in self.lod_meshes[lod] if i in self.meshes]

    def lod_of_mesh(self, index: int) -> int:
        for lod, indices in enumerate(self.lod_meshes):
            if index in indices:
                return lod
        raise KeyError(f"mesh {index} is not part of any LOD")


# ---------------------------------------------------------------------------- reading


@dataclass(frozen=True, eq=False)
class DnaHandle:
    """An open DNA reader; keeps the stream alive as long as the reader."""

    path: Path
    reader: SwigProxy  # dna.BinaryStreamReader
    stream: SwigProxy  # dna.FileStream


def open_reader(path: Path | str, *, geometry: bool = True) -> DnaHandle:
    """Read a DNA file with the DNA library.

    Args:
        geometry: load meshes. Without them the reader still holds every layer RigLogic needs
            (behaviour, RBF, machine-learned, twist/swing and joint metadata).
    """
    path = Path(path)
    if not path.is_file():
        raise DnaReadError(f"DNA file not found: {path}")
    dna = load_openriglogic().dna
    if geometry:
        layer = dna.DataLayer_All
    else:
        layer = (
            dna.DataLayer_RBFBehavior
            | dna.DataLayer_MachineLearnedBehavior
            | dna.DataLayer_JointBehaviorMetadata
            | dna.DataLayer_TwistSwingBehavior
        )
    stream = dna.FileStream(
        str(path), dna.FileStream.AccessMode_Read, dna.FileStream.OpenMode_Binary
    )
    reader = dna.BinaryStreamReader(stream, layer)
    reader.read()
    if not dna.Status.isOk():
        raise DnaReadError(f"cannot read {path}: {dna.Status.get().message}")
    return DnaHandle(path=path, reader=reader, stream=stream)


@cache
def _enum_names(prefix: str) -> dict[int, str]:
    """Map the bindings' integer enum values to names, e.g. Direction_left -> "left"."""
    dna = load_openriglogic().dna
    return {
        int(getattr(dna, name)): name.removeprefix(prefix)
        for name in dir(dna)
        if name.startswith(prefix)
    }


def _f32(values: Iterable[float]) -> F32:
    """The bindings return Python lists; generators are materialised first."""
    return np.asarray(values if isinstance(values, list | tuple) else list(values), np.float32)


def _i32(values: Iterable[int]) -> I32:
    return np.asarray(values if isinstance(values, list | tuple) else list(values), np.int32)


def _read_descriptor(reader: SwigProxy) -> Descriptor:
    directions = _enum_names("Direction_")
    system = reader.getCoordinateSystem()
    signs = reader.getRotationSign()
    metadata = {}
    for i in range(reader.getMetaDataCount()):
        key = reader.getMetaDataKey(i)
        metadata[key] = reader.getMetaDataValue(key)
    return Descriptor(
        name=reader.getName(),
        archetype=_enum_names("Archetype_").get(reader.getArchetype(), "unknown"),
        gender=_enum_names("Gender_").get(reader.getGender(), "unknown"),
        age=int(reader.getAge()),
        metadata=metadata,
        translation_unit=_enum_names("TranslationUnit_")[reader.getTranslationUnit()],
        rotation_unit=_enum_names("RotationUnit_")[reader.getRotationUnit()],
        coordinate_system=CoordinateSystem(
            x=directions[system.x], y=directions[system.y], z=directions[system.z]
        ),
        rotation_sequence=_enum_names("RotationSequence_")[reader.getRotationSequence()],
        rotation_signs=(int(signs.x), int(signs.y), int(signs.z)),
        face_winding=_enum_names("FaceWindingOrder_")[reader.getFaceWindingOrder()],
        lod_count=int(reader.getLODCount()),
        db_max_lod=int(reader.getDBMaxLOD()),
        db_complexity=reader.getDBComplexity(),
        db_name=reader.getDBName(),
        file_format=(int(reader.getFileFormatGeneration()), int(reader.getFileFormatVersion())),
    )


def _read_joints(reader: SwigProxy) -> Joints:
    count = reader.getJointCount()
    parents = _i32(reader.getJointParentIndex(j) for j in range(count))
    parents[parents == np.arange(count)] = -1
    # Stored as float32; widening to float64 is exact and keeps later math precise.
    translations = _vectors(
        reader.getNeutralJointTranslationXs(),
        reader.getNeutralJointTranslationYs(),
        reader.getNeutralJointTranslationZs(),
    ).astype(np.float64)
    rotations = _vectors(
        reader.getNeutralJointRotationXs(),
        reader.getNeutralJointRotationYs(),
        reader.getNeutralJointRotationZs(),
    ).astype(np.float64)
    return Joints(
        names=tuple(reader.getJointName(j) for j in range(count)),
        parents=parents,
        translations=translations,
        rotations=rotations,
        lod_joints=tuple(
            _i32(reader.getJointIndicesForLOD(lod)) for lod in range(reader.getLODCount())
        ),
    )


def _read_behavior(reader: SwigProxy) -> Behavior:
    lods = range(reader.getLODCount())
    return Behavior(
        gui_control_names=tuple(
            reader.getGUIControlName(i) for i in range(reader.getGUIControlCount())
        ),
        raw_control_names=tuple(
            reader.getRawControlName(i) for i in range(reader.getRawControlCount())
        ),
        gui_to_raw=ConditionalTable(
            inputs=_i32(reader.getGUIToRawInputIndices()),
            outputs=_i32(reader.getGUIToRawOutputIndices()),
            from_values=_f32(reader.getGUIToRawFromValues()),
            to_values=_f32(reader.getGUIToRawToValues()),
            slopes=_f32(reader.getGUIToRawSlopeValues()),
            cuts=_f32(reader.getGUIToRawCutValues()),
        ),
        psds=Psds(
            count=int(reader.getPSDCount()),
            rows=_i32(reader.getPSDRowIndices()),
            columns=_i32(reader.getPSDColumnIndices()),
            values=_f32(reader.getPSDValues()),
        ),
        blend_shape_channel_names=tuple(
            reader.getBlendShapeChannelName(i) for i in range(reader.getBlendShapeChannelCount())
        ),
        blend_shape_lods=_i32(reader.getBlendShapeChannelLODs()),
        blend_shape_inputs=_i32(reader.getBlendShapeChannelInputIndices()),
        blend_shape_outputs=_i32(reader.getBlendShapeChannelOutputIndices()),
        lod_blend_shape_channels=tuple(
            _i32(reader.getBlendShapeChannelIndicesForLOD(lod)) for lod in lods
        ),
        animated_map_names=tuple(
            reader.getAnimatedMapName(i) for i in range(reader.getAnimatedMapCount())
        ),
        animated_map_lods=_i32(reader.getAnimatedMapLODs()),
        animated_maps=ConditionalTable(
            inputs=_i32(reader.getAnimatedMapInputIndices()),
            outputs=_i32(reader.getAnimatedMapOutputIndices()),
            from_values=_f32(reader.getAnimatedMapFromValues()),
            to_values=_f32(reader.getAnimatedMapToValues()),
            slopes=_f32(reader.getAnimatedMapSlopeValues()),
            cuts=_f32(reader.getAnimatedMapCutValues()),
        ),
        lod_animated_maps=tuple(_i32(reader.getAnimatedMapIndicesForLOD(lod)) for lod in lods),
        joint_group_count=int(reader.getJointGroupCount()),
        rbf_solver_names=tuple(
            reader.getRBFSolverName(i) for i in range(reader.getRBFSolverCount())
        ),
        rbf_pose_names=tuple(reader.getRBFPoseName(i) for i in range(reader.getRBFPoseCount())),
        rbf_pose_control_names=tuple(
            reader.getRBFPoseControlName(i) for i in range(reader.getRBFPoseControlCount())
        ),
        ml_control_names=tuple(
            reader.getMLControlName(i) for i in range(reader.getMLControlCount())
        ),
        joint_group_joints=np.unique(
            _i32(
                joint
                for group in range(reader.getJointGroupCount())
                for joint in reader.getJointGroupJointIndices(group)
            )
        ),
        twist_swing_joints=np.unique(
            _i32(
                [
                    *(
                        j
                        for t in range(reader.getTwistCount())
                        for j in reader.getTwistOutputJointIndices(t)
                    ),
                    *(
                        j
                        for s in range(reader.getSwingCount())
                        for j in reader.getSwingOutputJointIndices(s)
                    ),
                ]
            )
        ),
    )


def _vectors(xs: Iterable[float], ys: Iterable[float], zs: Iterable[float]) -> F32:
    return np.stack([_f32(xs), _f32(ys), _f32(zs)], axis=1).reshape(-1, 3)


def _read_skin(reader: SwigProxy, mesh: int, position_count: int) -> SkinWeights:
    counts = np.zeros(position_count, dtype=np.int64)
    joints: list[int] = []
    weights: list[float] = []
    for vertex in range(min(reader.getSkinWeightsCount(mesh), position_count)):
        vertex_joints = reader.getSkinWeightsJointIndices(mesh, vertex)
        vertex_weights = reader.getSkinWeightsValues(mesh, vertex)
        if len(vertex_joints) != len(vertex_weights):
            raise DnaReadError(f"mesh {mesh} vertex {vertex}: joint/weight count mismatch")
        counts[vertex] = len(vertex_joints)
        joints.extend(vertex_joints)
        weights.extend(vertex_weights)
    offsets = np.zeros(position_count + 1, dtype=np.int64)
    np.cumsum(counts, out=offsets[1:])
    return SkinWeights(
        offsets=offsets,
        joints=_i32(joints),
        weights=_f32(weights),
        max_influences=int(reader.getMaximumInfluencePerVertex(mesh)),
    )


def _triangulate(face_offsets: I64, face_layouts: I32) -> tuple[I32, I32]:
    """Fan-triangulate polygons (v0, v1, v2), (v0, v2, v3), … keeping their winding."""
    sizes = np.diff(face_offsets)
    if np.any(sizes < 3):
        raise DnaReadError("mesh has a face with fewer than 3 vertices")
    per_face = sizes - 2
    faces = np.repeat(np.arange(len(sizes), dtype=np.int32), per_face)
    corner = np.arange(per_face.sum()) - np.repeat(np.cumsum(per_face) - per_face, per_face)
    start = face_offsets[:-1][faces]
    triangles = np.stack(
        [
            face_layouts[start],
            face_layouts[start + corner + 1],
            face_layouts[start + corner + 2],
        ],
        axis=1,
    )
    return triangles.astype(np.int32), faces


def _read_mesh(reader: SwigProxy, index: int, channels: Collection[int] | None) -> Mesh:
    positions = _vectors(
        reader.getVertexPositionXs(index),
        reader.getVertexPositionYs(index),
        reader.getVertexPositionZs(index),
    )
    normals = _vectors(
        reader.getVertexNormalXs(index),
        reader.getVertexNormalYs(index),
        reader.getVertexNormalZs(index),
    )
    uvs = np.stack(
        [
            _f32(reader.getVertexTextureCoordinateUs(index)),
            _f32(reader.getVertexTextureCoordinateVs(index)),
        ],
        axis=1,
    ).reshape(-1, 2)
    face_count = reader.getFaceCount(index)
    polygons = [reader.getFaceVertexLayoutIndices(index, face) for face in range(face_count)]
    face_offsets = np.zeros(face_count + 1, dtype=np.int64)
    np.cumsum([len(polygon) for polygon in polygons], out=face_offsets[1:])
    face_layouts = _i32([layout for polygon in polygons for layout in polygon])
    triangles, triangle_faces = _triangulate(face_offsets, face_layouts)

    targets = []
    for target in range(reader.getBlendShapeTargetCount(index)):
        channel = int(reader.getBlendShapeChannelIndex(index, target))
        if channels is not None and channel not in channels:
            continue
        targets.append(
            BlendShapeTarget(
                channel=channel,
                vertices=_i32(reader.getBlendShapeTargetVertexIndices(index, target)),
                deltas=_vectors(
                    reader.getBlendShapeTargetDeltaXs(index, target),
                    reader.getBlendShapeTargetDeltaYs(index, target),
                    reader.getBlendShapeTargetDeltaZs(index, target),
                ),
            )
        )

    mesh = Mesh(
        index=index,
        name=reader.getMeshName(index),
        positions=positions,
        normals=normals,
        uvs=uvs,
        layout_positions=_i32(reader.getVertexLayoutPositionIndices(index)),
        layout_uvs=_i32(reader.getVertexLayoutTextureCoordinateIndices(index)),
        layout_normals=_i32(reader.getVertexLayoutNormalIndices(index)),
        face_offsets=face_offsets,
        face_layouts=face_layouts,
        triangles=triangles,
        triangle_faces=triangle_faces,
        skin=_read_skin(reader, index, len(positions)),
        blend_shapes=tuple(targets),
    )
    _validate_mesh(mesh)
    return mesh


def _validate_mesh(mesh: Mesh) -> None:
    def check(name: str, indices: I32, size: int) -> None:
        if len(indices) and (indices.min() < 0 or indices.max() >= size):
            raise DnaReadError(f"{mesh.name}: {name} index out of range (size {size})")

    check("layout position", mesh.layout_positions, len(mesh.positions))
    check("layout normal", mesh.layout_normals, len(mesh.normals))
    check("layout uv", mesh.layout_uvs, len(mesh.uvs))
    check("face layout", mesh.face_layouts, mesh.layout_count)
    for target in mesh.blend_shapes:
        check(
            f"blend shape (channel {target.channel}) vertex", target.vertices, len(mesh.positions)
        )


def read_dna(
    path: Path | str,
    *,
    lods: Iterable[int] | None = None,
    geometry: bool = True,
    blend_shapes: bool | Collection[int] = True,
) -> DnaFile:
    """Read descriptor, joints, behaviour metadata and (optionally) meshes of a DNA file.

    Args:
        lods: read only the meshes of these LODs (default: all LODs).
        geometry: read meshes at all.
        blend_shapes: read all blend shape targets (True), none (False) or only the targets
            of these blend shape channel indices.
    """
    handle = open_reader(path, geometry=geometry)
    reader = handle.reader
    lod_meshes = tuple(
        tuple(int(m) for m in reader.getMeshIndicesForLOD(lod))
        for lod in range(reader.getLODCount())
    )
    meshes: dict[int, Mesh] = {}
    if geometry:
        wanted_lods = range(len(lod_meshes)) if lods is None else lods
        if blend_shapes is True:
            channels: Collection[int] | None = None
        elif blend_shapes is False:
            channels = frozenset()
        else:
            channels = frozenset(blend_shapes)
        for lod in wanted_lods:
            if not 0 <= lod < len(lod_meshes):
                raise ValueError(f"LOD {lod} out of range (DNA has {len(lod_meshes)})")
            for index in lod_meshes[lod]:
                if index not in meshes:
                    meshes[index] = _read_mesh(reader, index, channels)
    return DnaFile(
        path=handle.path,
        descriptor=_read_descriptor(reader),
        joints=_read_joints(reader),
        behavior=_read_behavior(reader),
        mesh_names=tuple(reader.getMeshName(m) for m in range(reader.getMeshCount())),
        lod_meshes=lod_meshes,
        meshes=meshes,
    )
