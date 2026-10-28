"""Fit audit (`asset-pipeline mh-fit-audit`): where skin shows through clothes and where
hair cards sink into or float off heads, measured on the converted web assets.

Read-only: it reads `web/manifest.json`, `web/curation.json` (hidden ids are skipped) and
the GLBs, and writes one JSON report (default `build/fit/report.json`). Painted grooms
(no cards) are skipped.

Outfits. Every visible outfit is put on the body of each gender it is offered for
(manifest `compat`), at a set of body states (neutral, every slider at -1 and +1, the
manifest presets and a few combined extremes) in the rest pose, and at neutral in two
frames (middle and peak swing) of the first visible idle and talk clips. Body and garment
take the same slider morph weights; the body is rebound at the slider joint positions as
the runtime does (`web/src/features/avatar/mh/assembly.ts`, `applyBodySliders`), and poses
are linear blend skinning of both with the clip's local rotations (pelvis translation
and the procedural life layer are left out). Measured per case:

- `skin_through`: body vertices the shader draws (not every triangle around them is
  hidden by `body_hide`) that the garment covers at neutral, yet lie outside it now.
  Covered means the closest garment point faces the vertex, the cloth runs along the
  skin and the offset is along the skin normal (so hems, cuffs and collar rims, past
  which skin is meant to show, do not count), and no other garment layer lies over the
  vertex along its normal. The cloth's outside is the side its winding faces (it agrees
  with the stored normals on 98-100 % of every garment's triangles), and the skin must
  face that way too: skin facing an inner layer of thick cloth is inside it.
- `cloth_sunk_visible` / `cloth_sunk_hidden`: garment vertices inside the body (signed
  distance to the skin), under drawn skin no other cloth covers (the skin shows where
  the cloth should be), or else under skin `body_hide` discards or under an outer layer
  (a dent in the cloth at most).
- `layers_crossed`: inner layers of thick cloth (vertex pairs stacked along the skin
  normal at neutral, on one body part) that come out past the outer layer; their two-sided
  back face reads as a dark blotch.
- `holes`: hidden body triangles nothing covers any more (no cloth over or just under
  them, no body in front): the background shows through the body.
- `head`: `skin_through` for the head mesh, whose neck and upper chest run under collars
  and are never hidden, on every visible face of the gender. The head is placed like the
  runtime does: its skin follows the body joints of the same name with the head's own
  inverse binds, its neck boundary is snapped onto the body's (approximately, in the body
  frame), the garment is moved off the head by the port of `fitGarmentOverHead` and, for
  poses, re-skinned near the head by the port of `skinGarmentToHead` (`garments.ts`).

In poses, a point only counts against the cloth (or skin) it was paired with at neutral,
so the clip's own arm-through-torso moments are not fit defects. Regions are the
dominant skin joint of the offending vertices.

Grooms. Every visible groom's LOD0 cards are refitted to a few faces of each compatible
gender (the extremes of skull width and neck length) and to the face they were fitted to
(`fitted_to`, the reference), with the runtime formula (`grooms.ts`, `refitPositions`):
`position = sum(w * head[p]) + offset`, in the head's bind space. Measured per case:

- `inside`: card vertices inside the head (signed distance below -1 mm against the
  closest head triangle's outward normal; only where that triangle faces the vertex, so
  the open neck, eye and mouth edges do not count), and the cards they belong to;
  `sunk_beyond_reference`: those this face pushes deeper than the reference face does
  (root ends tucked into the skin by design do not count there).
- `root_float`: cards whose root (the vertex nearest the scalp, smallest binding offset)
  is more than 5 mm off the head surface, and `root_sunk`: roots inside the head.

Thresholds are module constants; every case also reports its maximum and 95th percentile
depth in millimetres, so a looser or stricter reading needs no rerun.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from collections import Counter
from collections.abc import Callable, Iterable, Mapping, Sequence
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy.spatial import cKDTree

from asset_pipeline.mh.geometry import closest_triangles, components, vertex_normals
from asset_pipeline.mh.glb import accessor_array, accessor_values, read_glb
from asset_pipeline.mh.kinematics import compose_transforms, forward_kinematics

COMMAND = "mh-fit-audit"
REPORT_FILE = Path("build") / "fit" / "report.json"
CURATION_FILE = "curation.json"

F64 = NDArray[np.float64]
I64 = NDArray[np.int64]
Bool = NDArray[np.bool_]

# --- thresholds (metres) ----------------------------------------------------------------
SKIN_THROUGH = 0.0005  # skin this far outside the garment that covers it shows through
CLOTH_SUNK = 0.0005  # garment this far inside the skin
COVER_REACH = 0.06  # a garment farther than this from a skin vertex does not cover it
# In a pose, only the cloth (or skin) a point was paired with at neutral counts: the
# closest triangle now must lie within this (rest positions) of the neutral partner, so
# an arm swinging through the torso in the clip is not a fit defect.
TRACK_REACH = 0.05
# Skin standing farther out of the cloth than this at neutral is not under it (a hand
# below a cuff, a jaw above a collar rim): only skin inside, or at most this far out at
# neutral, is paired with the cloth.
COVER_OUT = 0.02
# |offset . face normal| / |offset| at least this: the closest point lies inside the
# triangle's face, not on an open edge (hem, cuff, eye or neck opening) past which the
# point merely sits.
SQUARE = 0.8
# |garment normal . skin normal| at least this: the cloth runs along the skin there. The
# rims of thick hems and collars face along the limb or neck and cover nothing.
PARALLEL = 0.5
# offset . skin normal / |offset| at least this: the skin stands out of the cloth along
# its own normal (not merely above a collar or past a hem that faces it).
OUTWARD = 0.7
RAY_REACH = 0.03  # an outer garment layer within this along the skin normal covers it
# Own skin up to this far past the cloth still lies between a skin point and the cloth
# (a sole touching the underside of the toe whose top is tested).
BETWEEN_MARGIN = 0.003
RAY_STEP = 0.005  # ray sample spacing for the candidate triangle search
RAY_NEIGHBOURS = 8  # triangle centroids gathered around each ray sample
# Garment vertices closer than this and stacked along the skin normal (offset within ~37
# degrees of it, at least 0.5 mm apart) at neutral are an inner and an outer layer of
# one cloth; the inner one showing out past the outer by LAYER_CROSS reads as a dark
# blotch (its two-sided back face) on the outside.
LAYER_REACH = 0.006
LAYER_CROSS = 0.0003
# Hidden skin (every vertex of the triangle in `body_hide`) whose outward normal ray
# meets no garment within this is a hole: the background shows through the body.
HOLE_REACH = 0.1
CARD_INSIDE = 0.001  # card vertices this far inside the head
ROOT_FLOAT = 0.005  # card roots this far off the scalp
CARD_REACH = 0.04  # card vertices farther than this from every head vertex are skipped
# Mirrors of `web/src/features/avatar/mh/garments.ts` (fitGarmentOverHead).
HEAD_REACH = 0.05
HEAD_NEIGHBOURS = 4
HEAD_CLEARANCE = 0.003
HEAD_BAND = 0.015  # skinGarmentToHead's fade
NEAR_CANDIDATES = 16  # closest-triangle candidates per point (by centroid)

SLIDERS = ("height", "weight", "muscle", "chest", "waist", "hips", "shoulders")
# Combined extremes on top of the single slider ends and the manifest presets: each
# slider alone may be clean while the sum of their morphs is not.
COMBINED: dict[str, dict[str, float]] = {
    "weight+1 hips+1": {"weight": 1.0, "hips": 1.0},
    "weight+1 chest+1": {"weight": 1.0, "chest": 1.0},
    "weight-1 muscle+1 shoulders+1": {"weight": -1.0, "muscle": 1.0, "shoulders": 1.0},
    "weight+1 waist+1 hips-1": {"weight": 1.0, "waist": 1.0, "hips": -1.0},
}
# Joints whose swing picks a clip's "peak" frame (most likely to open gaps).
PEAK_JOINTS = (
    "spine_04",
    "spine_05",
    "neck_01",
    "head",
    "clavicle_l",
    "clavicle_r",
    "upperarm_l",
    "upperarm_r",
    "lowerarm_l",
    "lowerarm_r",
    "thigh_l",
    "thigh_r",
)
CLIP_RATE = 15.0
CREW_NECKS = ("outfit.OA_Crewneckt", "outfit.OA_Sweater", "outfit.OA_Hoodie")


class FitAuditError(RuntimeError):
    """The archive cannot be audited (missing manifest, unreadable GLB)."""


# --- GLB reading ----------------------------------------------------------------------------


@dataclass(frozen=True)
class Skeleton:
    """Every node of a GLB with its rest local transform (glTF matrix rule)."""

    names: tuple[str, ...]
    parents: I64
    translations: F64
    rotations: F64
    scales: F64

    @property
    def index(self) -> dict[str, int]:
        return {name: i for i, name in enumerate(self.names)}

    def world(self, translations: F64 | None = None, rotations: F64 | None = None) -> F64:
        """World matrices `(N, 4, 4)` for these (or the rest) local transforms."""
        local = compose_transforms(
            self.translations if translations is None else translations,
            self.rotations if rotations is None else rotations,
            self.scales,
        )
        return forward_kinematics(local, self.parents)


@dataclass
class Skinned:
    """The skinned triangle meshes of a GLB merged into one (all on one skin)."""

    positions: F64
    normals: F64 | None
    triangles: I64
    joints: I64  # (V, 4) skin slots
    weights: F64  # (V, 4)
    slots: tuple[str, ...]  # node name of each skin slot
    inverse_binds: F64  # (S, 4, 4)
    morphs: dict[str, F64]
    attributes: dict[str, F64]
    material: I64  # material slot per vertex (index into `materials`)
    materials: tuple[str, ...]


@dataclass
class Asset:
    path: Path
    skeleton: Skeleton
    mesh: Skinned
    extras: dict[str, Any]


def read_skeleton(document: Mapping[str, Any]) -> Skeleton:
    nodes = document.get("nodes", [])
    parents = np.full(len(nodes), -1, dtype=np.int64)
    for i, node in enumerate(nodes):
        for child in node.get("children", []):
            parents[child] = i
    return Skeleton(
        names=tuple(str(node.get("name", f"node{i}")) for i, node in enumerate(nodes)),
        parents=parents,
        translations=np.array([n.get("translation", [0, 0, 0]) for n in nodes], dtype=float),
        rotations=np.array([n.get("rotation", [0, 0, 0, 1]) for n in nodes], dtype=float),
        scales=np.array([n.get("scale", [1, 1, 1]) for n in nodes], dtype=float),
    )


def read_asset(
    path: Path,
    *,
    meshes: Iterable[str] | None = None,
    materials: Iterable[str] | None = None,
    attributes: Sequence[str] = (),
    morphs: bool = True,
) -> Asset:
    """Skinned meshes of a converter GLB (all, or the named meshes and materials), with
    their morph targets unless `morphs` is false (decoding them is the slow part).

    Mesh nodes carry no transforms in the converter's output, so positions are in the
    scene frame, like the skeleton's world matrices."""
    if not path.is_file():
        raise FitAuditError(f"missing {path}")
    document, binary = read_glb(path.read_bytes())
    wanted_meshes = set(meshes) if meshes is not None else None
    wanted_materials = set(materials) if materials is not None else None
    skeleton = read_skeleton(document)
    material_names = [m.get("name", "") for m in document.get("materials", [])]

    skin_index: int | None = None
    parts: dict[str, list[Any]] = {
        k: [] for k in ("pos", "nrm", "tri", "jnt", "wgt", "mat", "morph", *attributes)
    }
    morph_names: list[str] = []
    offset = 0
    for node in document.get("nodes", []):
        if "mesh" not in node or "skin" not in node:
            continue
        mesh = document["meshes"][node["mesh"]]
        if wanted_meshes is not None and mesh.get("name") not in wanted_meshes:
            continue
        if skin_index is not None and node["skin"] != skin_index:
            raise FitAuditError(f"{path}: meshes on more than one skin")
        skin_index = node["skin"]
        names = list((mesh.get("extras") or {}).get("targetNames", [])) if morphs else []
        for primitive in mesh["primitives"]:
            if primitive.get("mode", 4) != 4:
                continue
            material = material_names[primitive["material"]] if "material" in primitive else ""
            if wanted_materials is not None and material not in wanted_materials:
                continue
            attrs = primitive["attributes"]
            positions = accessor_values(document, binary, attrs["POSITION"])
            count = len(positions)
            parts["pos"].append(positions)
            parts["nrm"].append(
                accessor_values(document, binary, attrs["NORMAL"]) if "NORMAL" in attrs else None
            )
            if "indices" in primitive:
                indices = accessor_array(document, binary, primitive["indices"]).reshape(-1)
            else:
                indices = np.arange(count)
            parts["tri"].append(indices.astype(np.int64).reshape(-1, 3) + offset)
            parts["jnt"].append(
                accessor_array(document, binary, attrs["JOINTS_0"]).astype(np.int64)
            )
            parts["wgt"].append(accessor_values(document, binary, attrs["WEIGHTS_0"]))
            parts["mat"].append((material, count))
            deltas: dict[str, F64] = {}
            for name, target in zip(names, primitive.get("targets", []), strict=False):
                if "POSITION" in target:
                    deltas[name] = accessor_values(document, binary, target["POSITION"])
            parts["morph"].append((deltas, count))
            for name in names:
                if name not in morph_names:
                    morph_names.append(name)
            for name in attributes:
                values = accessor_values(document, binary, attrs[name]) if name in attrs else None
                parts[name].append(values if values is not None else np.full((count, 1), np.nan))
            offset += count
    if skin_index is None or not parts["pos"]:
        raise FitAuditError(f"{path}: no skinned triangle mesh")

    skin = document["skins"][skin_index]
    inverse = accessor_values(document, binary, skin["inverseBindMatrices"]).reshape(-1, 4, 4)
    total = offset
    morph_arrays: dict[str, F64] = {}
    for name in morph_names:
        stacked = np.zeros((total, 3))
        start = 0
        for deltas, count in parts["morph"]:
            if name in deltas:
                stacked[start : start + count] = deltas[name]
            start += count
        morph_arrays[name] = stacked
    unique_materials = tuple(dict.fromkeys(name for name, _ in parts["mat"]))
    material_of = np.concatenate(
        [np.full(count, unique_materials.index(name)) for name, count in parts["mat"]]
    )
    normals = None if any(n is None for n in parts["nrm"]) else np.concatenate(parts["nrm"])
    return Asset(
        path=path,
        skeleton=skeleton,
        mesh=Skinned(
            positions=np.concatenate(parts["pos"]),
            normals=normals,
            triangles=np.concatenate(parts["tri"]),
            joints=np.concatenate(parts["jnt"]),
            weights=np.concatenate(parts["wgt"]),
            slots=tuple(skeleton.names[j] for j in skin["joints"]),
            inverse_binds=np.transpose(inverse, (0, 2, 1)),
            morphs=morph_arrays,
            attributes={name: np.concatenate(parts[name]) for name in attributes},
            material=material_of.astype(np.int64),
            materials=unique_materials,
        ),
        extras=_scene_extras(document),
    )


def _scene_extras(document: Mapping[str, Any]) -> dict[str, Any]:
    for scene in document.get("scenes", []):
        mh = (scene.get("extras") or {}).get("mh")
        if isinstance(mh, dict):
            return mh
    return dict(((document.get("asset") or {}).get("extras") or {}).get("mh") or {})


def decode_bitset(text: str, count: int) -> Bool:
    """Base64 bitset (bit v of byte v >> 3, least significant bit first) as flags."""
    import base64

    data = np.frombuffer(base64.b64decode(text), dtype=np.uint8)
    bits = np.unpackbits(data, bitorder="little")
    flags = np.zeros(count, dtype=bool)
    flags[: min(count, len(bits))] = bits[:count].astype(bool)
    return flags


# --- pure geometry ---------------------------------------------------------------------


def slider_morph_weights(values: Mapping[str, float]) -> dict[str, float]:
    """Morph weights of the slider ends (`body_<id>_min/max`) for values in -1..1."""
    weights: dict[str, float] = {}
    for slider, value in values.items():
        v = float(np.clip(value, -1.0, 1.0))
        if v < 0:
            weights[f"body_{slider}_min"] = -v
        elif v > 0:
            weights[f"body_{slider}_max"] = v
    return weights


def apply_morphs(base: F64, morphs: Mapping[str, F64], weights: Mapping[str, float]) -> F64:
    """Base positions plus the weighted relative morph deltas (missing names are zero)."""
    out = np.array(base, dtype=np.float64, copy=True)
    for name, weight in weights.items():
        if weight != 0 and name in morphs:
            out += weight * morphs[name]
    return out


def blend_matrices(joints: I64, weights: F64, matrices: F64) -> F64:
    """Per-vertex skin matrices `(V, 4, 4)`: weight-normalized blend of the slots'."""
    total = weights.sum(axis=1, keepdims=True)
    w = weights / np.where(total > 0, total, 1.0)
    out = np.zeros((len(joints), 4, 4))
    for k in range(joints.shape[1]):
        out += w[:, k, None, None] * matrices[joints[:, k]]
    return out


def linear_blend_skin(points: F64, joints: I64, weights: F64, matrices: F64) -> F64:
    """Linear blend skinning of `points` with per-slot skin matrices `(S, 4, 4)`."""
    total = weights.sum(axis=1, keepdims=True)
    w = weights / np.where(total > 0, total, 1.0)
    out = np.zeros_like(points, dtype=np.float64)
    for k in range(joints.shape[1]):
        m = matrices[joints[:, k]]
        moved = np.einsum("vij,vj->vi", m[:, :3, :3], points) + m[:, :3, 3]
        out += w[:, k, None] * moved
    return out


def face_normals(vertices: F64, triangles: I64) -> F64:
    a, b, c = (vertices[triangles[:, k]] for k in range(3))
    normals = np.cross(b - a, c - a)
    length = np.linalg.norm(normals, axis=1, keepdims=True)
    return normals / np.where(length > 0, length, 1.0)


def welded_normals(vertices: F64, triangles: I64, weld: I64 | None = None) -> F64:
    """Vertex normals, averaged over vertices split at UV seams when `weld` gives each
    vertex its welded id (e.g. the DNA position index)."""
    if weld is None:
        return vertex_normals(vertices, triangles)
    _, first, inverse = np.unique(weld, return_index=True, return_inverse=True)
    normals = vertex_normals(vertices[first], inverse[triangles])
    return normals[inverse]


@dataclass(frozen=True)
class Nearest:
    """Closest triangle of each query point and the offset from the closest point."""

    triangle: I64
    distance: F64
    offset: F64  # point - closest point
    normal: F64  # unit normal of the closest triangle (its winding)

    @property
    def along(self) -> F64:
        """Offset along the triangle normal (signed)."""
        return np.einsum("ij,ij->i", self.offset, self.normal)

    @property
    def square(self) -> F64:
        """1 when the offset is along the normal (the point faces the triangle), towards
        0 when the closest point is an open edge the point lies beyond."""
        return np.abs(self.along) / np.maximum(self.distance, 1e-12)


def nearest(
    points: F64, vertices: F64, triangles: I64, candidates: int = NEAR_CANDIDATES
) -> Nearest:
    if len(points) == 0:
        empty = np.zeros((0, 3))
        return Nearest(np.zeros(0, dtype=np.int64), np.zeros(0), empty, empty)
    triangle, bary, distance = closest_triangles(points, vertices, triangles, candidates)
    corners = vertices[triangles[triangle]]
    closest = np.einsum("ik,ikj->ij", bary, corners)
    normal = face_normals(vertices, triangles[triangle])
    return Nearest(triangle, distance, points - closest, normal)


def signed_distance(
    points: F64, vertices: F64, triangles: I64, *, outward: float = 1.0
) -> tuple[F64, F64, I64]:
    """Signed distance of points to an oriented surface (positive outside: on the side
    the triangle winding, times `outward`, points to), plus the `square` measure and
    the closest triangle."""
    found = nearest(points, vertices, triangles)
    sign = np.sign(found.along * outward)
    return sign * found.distance, found.square, found.triangle


def winding_sign(vertices: F64, triangles: I64, normals: F64 | None) -> float:
    """+1 when triangle winding agrees with the stored vertex normals, -1 when it is
    the reverse (no stored normals: +1)."""
    if normals is None:
        return 1.0
    faces = face_normals(vertices, triangles)
    stored = normals[triangles].sum(axis=1)
    return 1.0 if np.einsum("ij,ij->", faces, stored) >= 0 else -1.0


def ray_hits(
    origins: F64,
    directions: F64,
    vertices: F64,
    triangles: I64,
    *,
    reach: float | F64 = RAY_REACH,
    step: float = RAY_STEP,
    neighbours: int = RAY_NEIGHBOURS,
    tree: cKDTree | None = None,
) -> Bool:
    """Whether each ray `origin + t * direction`, 0 < t <= reach (one for all rays or
    one per ray), hits a triangle.

    Candidates are the triangles whose centroids are nearest to samples along the ray
    (enough for meshes whose triangles are small next to `step`)."""
    hits = np.zeros(len(origins), dtype=bool)
    if len(origins) == 0 or len(triangles) == 0:
        return hits
    if tree is None:
        tree = cKDTree(vertices[triangles].mean(axis=1))
    k = min(neighbours, len(triangles))
    reaches = np.broadcast_to(np.asarray(reach, dtype=np.float64), (len(origins),))
    samples = np.arange(0.0, float(reaches.max()) + 1e-12, step)
    chunk = max(1, 65536 // (len(samples) * k))
    for start in range(0, len(origins), chunk):
        o = origins[start : start + chunk]
        d = directions[start : start + chunk]
        limit = reaches[start : start + chunk, None]
        near = [tree.query(o + d * s, k=k)[1].reshape(len(o), k) for s in samples]
        tri = triangles[np.concatenate(near, axis=1)]  # (R, C, 3)
        v0, v1, v2 = vertices[tri[..., 0]], vertices[tri[..., 1]], vertices[tri[..., 2]]
        e1, e2 = v1 - v0, v2 - v0
        dd = np.broadcast_to(d[:, None, :], e1.shape)
        p = np.cross(dd, e2)
        det = np.einsum("rck,rck->rc", e1, p)
        ok = np.abs(det) > 1e-14
        inv = 1.0 / np.where(ok, det, 1.0)
        tvec = o[:, None, :] - v0
        u = np.einsum("rck,rck->rc", tvec, p) * inv
        q = np.cross(tvec, e1)
        v = np.einsum("rck,rck->rc", dd, q) * inv
        t = np.einsum("rck,rck->rc", e2, q) * inv
        hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 1e-6) & (t <= limit)
        hits[start : start + chunk] = hit.any(axis=1)
    return hits


def skin_through(
    points: F64,
    normals: F64,
    garment: F64,
    triangles: I64,
    *,
    threshold: float = SKIN_THROUGH,
    partners: I64 | None = None,
    garment_rest: F64 | None = None,
    winding: float = 1.0,
    skin: tuple[F64, I64] | None = None,
) -> F64:
    """How far each skin point stands outside the garment that covers it (m), 0 where
    it does not (inside, not covered, or covered by an outer layer along its normal).

    `normals` are the skin's outward unit normals. The cloth's outside is the side its
    winding (times `winding`) faces; the skin must face the same way and lie on that
    side. Skin facing an inner layer (thick cloth, normals towards the body) or the
    back of a shoe wall it sits behind is inside. With `partners` (garment vertex paired
    with each point at neutral) and `garment_rest`, only closest triangles near the
    partner count. With `skin` (the points' own mesh), a point whose inward ray meets
    that skin before the cloth is not through it: the cloth lies under another part of
    the body (the sole under a toe, whose top is meant to show)."""
    depth = np.zeros(len(points))
    if len(points) == 0:
        return depth
    found = nearest(points, garment, triangles)
    cosine = np.einsum("ij,ij->i", found.normal, normals) * winding
    along = found.along * winding
    outward = np.einsum("ij,ij->i", found.offset, normals) / np.maximum(found.distance, 1e-12)
    candidate = (
        (cosine >= PARALLEL)
        & (outward >= OUTWARD)
        & (found.distance < COVER_REACH)
        & (found.square >= SQUARE)
        & (along > threshold)
    )
    if partners is not None and garment_rest is not None:
        corner = garment_rest[triangles[found.triangle, 0]]
        candidate &= np.linalg.norm(corner - garment_rest[partners], axis=1) < TRACK_REACH
    rows = np.flatnonzero(candidate)
    covered = ray_hits(points[rows], normals[rows], garment, triangles)
    rows = rows[~covered]
    if skin is not None and len(rows):
        inward = -normals[rows]
        behind = ray_hits(
            points[rows] + inward * 1e-4,
            inward,
            skin[0],
            skin[1],
            reach=found.distance[rows] + BETWEEN_MARGIN,
        )
        rows = rows[~behind]
    depth[rows] = along[rows]
    return depth


def fit_over_head(garment: F64, head: F64, head_normals: F64) -> F64:
    """Port of `fitGarmentOverHead` (garments.ts): garment points near the head move
    along the blended head normal until they clear the head skin by HEAD_CLEARANCE.
    Everything is in the body's bind frame (slider morphs applied)."""
    out = garment.copy()
    lo, hi = head.min(axis=0) - HEAD_REACH, head.max(axis=0) + HEAD_REACH
    rows = np.flatnonzero(np.all((garment >= lo) & (garment <= hi), axis=1))
    if len(rows) == 0:
        return out
    tree = cKDTree(head)
    distance, index = tree.query(garment[rows], k=HEAD_NEIGHBOURS, distance_upper_bound=HEAD_REACH)
    distance = distance.reshape(len(rows), -1)
    index = index.reshape(len(rows), -1)
    found = np.isfinite(distance[:, 0])
    rows, distance, index = rows[found], distance[found], index[found]
    valid = np.isfinite(distance)
    index = np.where(valid, index, 0)
    first = index[:, 0]
    out_along = np.einsum("ij,ij->i", garment[rows] - head[first], head_normals[first])
    want = np.zeros(len(head))
    np.maximum.at(want, first, HEAD_CLEARANCE - out_along)
    w = np.where(valid, 1.0 / np.maximum(distance, 1e-5), 0.0)
    total = w.sum(axis=1)
    push = (w * want[index]).sum(axis=1) / total
    direction = np.einsum("rk,rkj->rj", w, head_normals[index])
    length = np.linalg.norm(direction, axis=1)
    t = np.clip((HEAD_REACH - distance[:, 0]) / (HEAD_REACH / 2), 0.0, 1.0)
    shift = np.maximum(want[first], push) * t * t * (3 - 2 * t)
    move = (shift > 0) & (length > 0)
    out[rows[move]] += direction[move] / length[move, None] * shift[move, None]
    return out


# --- statistics -----------------------------------------------------------------------------


def depth_stats(
    depths_m: F64, regions: Sequence[str] | None = None, top: int = 6
) -> dict[str, Any]:
    """Count, max and 95th percentile (mm) of positive depths, and the commonest regions."""
    hit = np.flatnonzero(depths_m > 0)
    stats: dict[str, Any] = {"count": len(hit)}
    if len(hit):
        mm = depths_m[hit] * 1000.0
        stats["max_mm"] = round(float(mm.max()), 2)
        stats["p95_mm"] = round(float(np.percentile(mm, 95)), 2)
        if regions is not None:
            counts = Counter(regions[i] for i in hit)
            stats["regions"] = dict(counts.most_common(top))
    return stats


def dominant_joint(joints: I64, weights: F64, slots: Sequence[str]) -> list[str]:
    best = joints[np.arange(len(joints)), np.argmax(weights, axis=1)]
    return [slots[j] for j in best]


# --- archive model -------------------------------------------------------------------------


@dataclass
class Body:
    gender: str
    asset: Asset
    regions: list[str]  # dominant skin joint per vertex
    nodes: I64  # body node per skin slot
    weld: I64  # DNA position per vertex (UV-split vertices share it)
    outward: float  # winding sign
    seam_loop: I64 | None  # body vertex per neck seam boundary slot
    joint_deltas: dict[str, dict[str, list[float]]]

    def slider_translations(self, morph_weights: Mapping[str, float]) -> F64:
        sk = self.asset.skeleton
        out = sk.translations.copy()
        index = sk.index
        for end, weight in morph_weights.items():
            for bone, delta in self.joint_deltas.get(end, {}).items():
                if bone in index:
                    out[index[bone]] += weight * np.asarray(delta, dtype=float)
        return out


def load_body(archive_web: Path, entry: Mapping[str, Any]) -> Body:
    asset = read_asset(archive_web / entry["glb"], attributes=("_DNA_POSITION",))
    mesh = asset.mesh
    weld = np.round(mesh.attributes["_DNA_POSITION"][:, 0]).astype(np.int64)
    first = _first_vertex(weld)
    boundary = [int(p) for p in asset.extras.get("neck_seam", {}).get("boundary", [])]
    loop = (
        np.array([first[p] for p in boundary], dtype=np.int64)
        if boundary and all(p in first for p in boundary)
        else None
    )
    return Body(
        gender=str(entry["gender"]),
        asset=asset,
        regions=dominant_joint(mesh.joints, mesh.weights, mesh.slots),
        nodes=slot_nodes(mesh.slots, asset.skeleton, asset.skeleton.index),
        weld=weld,
        outward=winding_sign(mesh.positions, mesh.triangles, mesh.normals),
        seam_loop=loop,
        joint_deltas=dict(asset.extras.get("body_joint_deltas", {})),
    )


@dataclass(frozen=True)
class SeamRings:
    """A head's neck seam (`extras.mh.neck_seam`) as `bindNeckSeam` (assembly.ts) reads
    it: head vertex per boundary slot, and per seam vertex its falloff and the two
    nearest boundary slots it follows (by rest distance)."""

    boundary: I64
    vertices: I64
    weights: F64
    slot_a: I64
    slot_b: I64
    blend: F64
    on_boundary: Bool


@dataclass
class Head:
    id: str
    gender: str
    asset: Asset  # the "head" primitive only
    weld: I64
    outward: float
    seam: SeamRings | None
    regions: list[str]


def _first_vertex(weld: I64) -> dict[int, int]:
    _, first = np.unique(weld, return_index=True)
    return {int(weld[v]): int(v) for v in first}


# `seamFalloff` (assembly.ts): the seam's offset holds in full up to SEAM_HOLD from the
# boundary and fades out by SEAM_FADE (metres, rest).
SEAM_HOLD = 0.03
SEAM_FADE = 0.09


def seam_falloff(
    positions: F64, boundary: F64, ring_vertices: I64, ring_weights: F64
) -> tuple[I64, F64]:
    """Head vertices the seam moves and their weights, as `seamFalloff` picks them: the
    converter's rings and every vertex within SEAM_FADE of the boundary, the larger
    weight where both name a vertex."""
    weight = np.zeros(len(positions))
    weight[ring_vertices] = ring_weights
    d = cKDTree(boundary).query(positions)[0]
    t = np.clip((d - SEAM_HOLD) / (SEAM_FADE - SEAM_HOLD), 0.0, 1.0)
    fade = np.where(d < SEAM_FADE, 1.0 - t * t * (3.0 - 2.0 * t), 0.0)
    weight = np.maximum(weight, fade)
    moved = np.union1d(ring_vertices, np.flatnonzero(d < SEAM_FADE)).astype(np.int64)
    return moved, weight[moved]


def seam_rings(positions: F64, weld: I64, seam: Mapping[str, Any]) -> SeamRings | None:
    boundary = [int(p) for p in seam.get("boundary", [])]
    first = _first_vertex(weld)
    if not boundary or any(p not in first for p in boundary):
        return None
    loop = np.array([first[p] for p in boundary], dtype=np.int64)
    vertices, weights = seam_falloff(
        positions,
        positions[loop],
        np.asarray(seam.get("vertices", []), dtype=np.int64),
        np.asarray(seam.get("weights", []), dtype=np.float64),
    )
    slot_of = {p: s for s, p in enumerate(boundary)}
    slots = np.array([slot_of.get(int(weld[v]), -1) for v in vertices], dtype=np.int64)
    on = slots >= 0
    d = np.linalg.norm(positions[vertices][:, None, :] - positions[loop][None, :, :], axis=2)
    order = np.argsort(d, axis=1)[:, :2]
    da = np.take_along_axis(d, order[:, :1], axis=1)[:, 0]
    db = np.take_along_axis(d, order[:, 1:2], axis=1)[:, 0]
    blend = np.where(da + db > 0, da / np.maximum(da + db, 1e-12), 0.0)
    slot_a = np.where(on, slots, order[:, 0])
    slot_b = np.where(on, slots, order[:, 1])
    return SeamRings(loop, vertices, weights, slot_a, slot_b, np.where(on, 0.0, blend), on)


def load_head(archive_web: Path, entry: Mapping[str, Any]) -> Head:
    asset = read_asset(
        archive_web / entry["head"],
        materials={"head"},
        attributes=("_DNA_POSITION",),
        morphs=False,
    )
    mesh = asset.mesh
    weld = np.round(mesh.attributes["_DNA_POSITION"][:, 0]).astype(np.int64)
    return Head(
        id=str(entry["id"]),
        gender=str(entry.get("gender", "")),
        asset=asset,
        weld=weld,
        outward=winding_sign(mesh.positions, mesh.triangles, mesh.normals),
        seam=seam_rings(mesh.positions, weld, asset.extras.get("neck_seam", {})),
        regions=[f"head:{name}" for name in dominant_joint(mesh.joints, mesh.weights, mesh.slots)],
    )


def slot_nodes(slots: Sequence[str], skeleton: Skeleton, body_index: Mapping[str, int]) -> I64:
    """Body node per skin slot: the node of the slot's name, else of its nearest ancestor
    (in `skeleton`) the body has, like `bindGarment`; -1 when there is none."""
    index = skeleton.index
    out = np.full(len(slots), -1, dtype=np.int64)
    for s, name in enumerate(slots):
        node = index.get(name, -1)
        while node >= 0 and skeleton.names[node] not in body_index:
            node = int(skeleton.parents[node])
        if node >= 0:
            out[s] = body_index[skeleton.names[node]]
    return out


@dataclass
class BodyState:
    """A body at one slider state and pose. `skin` moves bind-frame (morphed) points to
    the pose: per body node, posed world @ inverse(slider rest world), the body being
    rebound at the slider joint positions; its last entry is the identity, for slots
    that map to no node (-1)."""

    name: str
    sliders: dict[str, float]
    morph_weights: dict[str, float]
    rest_world: F64  # body nodes at the slider joint positions, rest rotations
    posed_world: F64
    skin: F64
    pose: str = "rest"

    @property
    def posed(self) -> bool:
        return self.posed_world is not self.rest_world


def body_state(
    body: Body,
    name: str,
    sliders: Mapping[str, float],
    rotations: F64 | None = None,
    pose: str = "rest",
) -> BodyState:
    weights = slider_morph_weights(sliders)
    translations = body.slider_translations(weights)
    rest = body.asset.skeleton.world(translations)
    posed = rest if rotations is None else body.asset.skeleton.world(translations, rotations)
    skin = np.concatenate([posed @ np.linalg.inv(rest), np.eye(4)[None]])
    return BodyState(name, dict(sliders), weights, rest, posed, skin, pose)


@dataclass
class HeadRig:
    """A head attached to a body (`attachHead`, assembly.ts): each head skin slot
    follows the body joint of its name, or hangs under the nearest ancestor the body
    has with its own rest offset; the head keeps its inverse binds."""

    head: Head
    body: Body
    anchors: I64  # body node per head slot, -1 when it has none
    relative: F64  # (S, 4, 4) head rest transform of the slot relative to its anchor
    fallback: F64  # (S, 4, 4) head rest world, for slots without an anchor
    pairing: I64 | None  # body seam vertex per head boundary slot

    def slot_matrices(self, world: F64) -> F64:
        out = self.fallback.copy()
        anchored = self.anchors >= 0
        out[anchored] = world[self.anchors[anchored]] @ self.relative[anchored]
        return out @ self.head.asset.mesh.inverse_binds


def rig_head(head: Head, body: Body) -> HeadRig:
    skeleton = head.asset.skeleton
    rest_world = skeleton.world()
    body_index = body.asset.skeleton.index
    head_index = skeleton.index
    slots = head.asset.mesh.slots
    anchors = np.full(len(slots), -1, dtype=np.int64)
    relative = np.tile(np.eye(4), (len(slots), 1, 1))
    fallback = np.tile(np.eye(4), (len(slots), 1, 1))
    for s, joint in enumerate(slots):
        own = head_index[joint]
        fallback[s] = rest_world[own]
        node = own
        while node >= 0 and skeleton.names[node] not in body_index:
            node = int(skeleton.parents[node])
        if node >= 0:
            anchors[s] = body_index[skeleton.names[node]]
            relative[s] = np.linalg.inv(rest_world[node]) @ rest_world[own]
    rig = HeadRig(head, body, anchors, relative, fallback, None)
    rings = head.seam
    body_loop = body.seam_loop
    if rings is not None and body_loop is not None and len(body_loop) == len(rings.boundary):
        # Pair the loops where they sit at rest (head as loaded on the neutral body).
        mesh = head.asset.mesh
        loop = rings.boundary
        neutral = rig.slot_matrices(body.asset.skeleton.world())
        placed = linear_blend_skin(
            mesh.positions[loop], mesh.joints[loop], mesh.weights[loop], neutral
        )
        rig.pairing = body_loop[align_loops(placed, body.asset.mesh.positions[body_loop])]
    return rig


def place_head(rig: HeadRig, state: BodyState) -> tuple[F64, F64]:
    """Head skin in the body frame at this state: (rest positions with the neck seam
    snapped onto the body, posed positions). Rest is the frame garments are fitted in."""
    mesh = rig.head.asset.mesh
    rest_matrices = rig.slot_matrices(state.rest_world)
    rest = linear_blend_skin(mesh.positions, mesh.joints, mesh.weights, rest_matrices)
    snapped = snap_seam(rig, rest, state)
    if not state.posed:
        return snapped, snapped
    posed_matrices = rig.slot_matrices(state.posed_world)
    posed = linear_blend_skin(mesh.positions, mesh.joints, mesh.weights, posed_matrices)
    rings = rig.head.seam
    if rings is not None and rig.pairing is not None:
        # Snapped vertices: their snapped rest position, carried by their own skin.
        moved = rings.vertices
        j, w = mesh.joints[moved], mesh.weights[moved]
        local = np.einsum(
            "vij,vj->vi",
            np.linalg.inv(blend_matrices(j, w, rest_matrices)),
            np.c_[snapped[moved], np.ones(len(moved))],
        )
        posed[moved] = np.einsum("vij,vj->vi", blend_matrices(j, w, posed_matrices), local)[:, :3]
    return snapped, posed


def align_loops(a: F64, b: F64) -> I64:
    """Index into `b` for every point of loop `a` (same length, cyclic order, either
    direction) minimizing the summed squared distance."""
    n = len(a)
    best, best_map = np.inf, np.arange(n)
    for direction in (1, -1):
        order = np.arange(n) * direction
        for shift in range(n):
            mapping = (shift + order) % n
            cost = float(np.sum((a - b[mapping]) ** 2))
            if cost < best:
                best, best_map = cost, mapping
    return best_map


def snap_seam(rig: HeadRig, rest: F64, state: BodyState) -> F64:
    """Approximation of `snapNeckSeam` (assembly.ts) in the body frame: head boundary
    vertices move onto their paired body boundary vertices (sliders applied), ring
    vertices by the blend of their two boundary slots' offsets times their falloff."""
    rings = rig.head.seam
    if rings is None or rig.pairing is None:
        return rest
    bmesh = rig.body.asset.mesh
    target = apply_morphs(
        bmesh.positions[rig.pairing],
        {k: v[rig.pairing] for k, v in bmesh.morphs.items()},
        state.morph_weights,
    )
    offsets = target - rest[rings.boundary]
    t = rings.blend[:, None]
    shift = (1 - t) * offsets[rings.slot_a] + t * offsets[rings.slot_b]
    weight = np.where(rings.on_boundary, 1.0, rings.weights)[:, None]
    out = rest.copy()
    out[rings.vertices] = rest[rings.vertices] + weight * shift
    return out


# --- clips ------------------------------------------------------------------------------


@dataclass(frozen=True)
class Clip:
    id: str
    role: str
    duration: float
    tracks: dict[str, tuple[F64, F64]]  # node name -> (times, quaternions xyzw)

    def rotations(self, skeleton: Skeleton, time_s: float) -> F64:
        """Local rotations of `skeleton` at `time_s`: the clip's where it has a track,
        rest elsewhere (positions stay where the sliders put them)."""
        out = skeleton.rotations.copy()
        index = skeleton.index
        for name, (times, values) in self.tracks.items():
            if name in index:
                out[index[name]] = sample_quaternion(times, values, time_s)
        return out


def sample_quaternion(times: F64, values: F64, at: float) -> F64:
    """Normalized per-component linear interpolation (sign-aligned neighbours)."""
    if len(times) == 1 or at <= times[0]:
        return values[0] / np.linalg.norm(values[0])
    if at >= times[-1]:
        return values[-1] / np.linalg.norm(values[-1])
    k = int(np.searchsorted(times, at) - 1)
    t = (at - times[k]) / max(times[k + 1] - times[k], 1e-12)
    a, b = values[k], values[k + 1]
    if np.dot(a, b) < 0:
        b = -b
    q = (1 - t) * a + t * b
    return q / np.linalg.norm(q)


def read_clip(path: Path, clip_id: str, role: str) -> Clip:
    document, binary = read_glb(path.read_bytes())
    animation = (document.get("animations") or [None])[0]
    if animation is None:
        raise FitAuditError(f"{path} has no animation")
    names = [node.get("name") for node in document.get("nodes", [])]
    tracks: dict[str, tuple[F64, F64]] = {}
    end = 0.0
    for channel in animation["channels"]:
        if channel["target"].get("path") != "rotation":
            continue
        sampler = animation["samplers"][channel["sampler"]]
        times = accessor_values(document, binary, sampler["input"]).reshape(-1)
        values = accessor_values(document, binary, sampler["output"]).reshape(-1, 4)
        tracks[str(names[channel["target"]["node"]])] = (times, values)
        end = max(end, float(times[-1]))
    return Clip(clip_id, role, end, tracks)


def clip_frames(clip: Clip, skeleton: Skeleton) -> list[tuple[str, float]]:
    """Two frames of a clip: its middle and its peak (largest swing of the PEAK_JOINTS
    away from the clip's mean pose)."""
    times = np.arange(0.0, clip.duration + 1e-9, 1.0 / CLIP_RATE)
    joints = [j for j in PEAK_JOINTS if j in clip.tracks]
    if not joints or len(times) < 2:
        return [("mid", clip.duration / 2)]
    swing = np.zeros(len(times))
    for joint in joints:
        q = np.array([sample_quaternion(*clip.tracks[joint], t) for t in times])
        q *= np.sign(q @ q[0])[:, None] + (q @ q[0] == 0)[:, None]
        mean = q.mean(axis=0)
        mean /= np.linalg.norm(mean)
        swing += np.degrees(2 * np.arccos(np.clip(np.abs(q @ mean), 0.0, 1.0)))
    peak = float(times[int(np.argmax(swing))])
    return [("mid", round(clip.duration / 2, 3)), ("peak", round(peak, 3))]


# --- outfits ----------------------------------------------------------------------------


@dataclass(frozen=True)
class Layers:
    """Stacked garment vertex pairs found at neutral: `outer` lies over `inner` along
    the skin normal at `anchor` (the body vertex nearest the inner one)."""

    inner: I64
    outer: I64
    anchor: I64


def body_part(joint: str) -> str:
    """Coarse body part of a skeleton joint: torso, arm_l/r, leg_l/r."""
    side = joint[-2:] if joint.endswith(("_l", "_r")) else ""
    arm = ("upperarm", "lowerarm", "hand", "thumb", "index", "middle", "ring", "pinky")
    if side and joint.startswith(arm):
        return f"arm{side}"
    if side and joint.startswith(("thigh", "calf", "foot", "ball")):
        return f"leg{side}"
    return "torso"


def stacked_layers(
    garment: F64,
    body: F64,
    body_normals: F64,
    parts: Sequence[str] | None = None,
    reach: float = LAYER_REACH,
) -> Layers:
    """Pairs within `reach`, stacked along the skin normal, on one body part (`parts`
    per garment vertex): panels of different parts meeting at a seam (a sleeve and the
    torso at the armpit) slide past each other in a pose and are not layers."""
    pairs = cKDTree(garment).query_pairs(reach, output_type="ndarray")
    if parts is not None and len(pairs):
        part = np.asarray(parts)
        pairs = pairs[part[pairs[:, 0]] == part[pairs[:, 1]]]
    _, anchor = cKDTree(body).query(garment)
    if len(pairs) == 0:
        empty = np.zeros(0, dtype=np.int64)
        return Layers(empty, empty, empty)
    a, b = pairs[:, 0], pairs[:, 1]
    direction = body_normals[anchor[a]] + body_normals[anchor[b]]
    direction /= np.maximum(np.linalg.norm(direction, axis=1, keepdims=True), 1e-12)
    offset = garment[b] - garment[a]
    along = np.einsum("ij,ij->i", offset, direction)
    stacked = (np.abs(along) >= SQUARE * np.linalg.norm(offset, axis=1)) & (np.abs(along) > 0.0005)
    inner = np.where(along > 0, a, b)[stacked]
    outer = np.where(along > 0, b, a)[stacked]
    return Layers(inner, outer, anchor[inner])


def layers_crossed(points: F64, body_normals: F64, layers: Layers) -> F64:
    """Per garment vertex, how far (m) it stands out past a layer that lay over it at
    neutral (along the skin normal now), 0 where the order holds."""
    out = np.zeros(len(points))
    if len(layers.inner) == 0:
        return out
    gap = np.einsum(
        "ij,ij->i", points[layers.outer] - points[layers.inner], body_normals[layers.anchor]
    )
    np.maximum.at(out, layers.inner, np.where(-gap > LAYER_CROSS, -gap, 0.0))
    return out


@dataclass
class Garment:
    id: str
    gender: str
    category: str
    asset: Asset
    nodes: I64  # body node per garment skin slot (-1: none)
    hidden: Bool  # body vertices body_hide discards
    drawn: Bool  # body vertices on a triangle that is still drawn
    body_triangle_hidden: Bool
    layers: Layers
    winding: float  # +1 when triangle winding faces the way the stored normals do

    @property
    def mesh(self) -> Skinned:
        return self.asset.mesh


def load_garment(archive_web: Path, entry: Mapping[str, Any], gender: str, body: Body) -> Garment:
    asset = read_asset(archive_web / entry["files"][gender])
    bmesh = body.asset.mesh
    count = len(bmesh.positions)
    text = asset.extras.get("body_hide")
    hidden = decode_bitset(text, count) if isinstance(text, str) else np.zeros(count, dtype=bool)
    triangle_hidden = hidden[bmesh.triangles].all(axis=1)
    drawn = np.zeros(count, dtype=bool)
    drawn[bmesh.triangles[~triangle_hidden].reshape(-1)] = True
    normals = welded_normals(bmesh.positions, bmesh.triangles, body.weld) * body.outward
    gmesh = asset.mesh
    dominant = gmesh.joints[np.arange(len(gmesh.joints)), np.argmax(gmesh.weights, axis=1)]
    parts = [body_part(gmesh.slots[j]) for j in dominant]
    return Garment(
        id=str(entry["id"]),
        gender=gender,
        category=str(entry.get("category", "")),
        asset=asset,
        nodes=slot_nodes(asset.mesh.slots, asset.skeleton, body.asset.skeleton.index),
        hidden=hidden,
        drawn=drawn,
        body_triangle_hidden=triangle_hidden,
        layers=stacked_layers(asset.mesh.positions, bmesh.positions, normals, parts),
        winding=winding_sign(gmesh.positions, gmesh.triangles, gmesh.normals),
    )


@dataclass
class Posed:
    """Body and garment positions and the body's outward normals in one state."""

    body: F64
    body_normals: F64
    garment: F64
    body_rest: F64  # bind frame (slider morphs applied)
    garment_rest: F64


def pose_pair(body: Body, garment: Garment, state: BodyState) -> Posed:
    bmesh, gmesh = body.asset.mesh, garment.mesh
    body_rest = apply_morphs(bmesh.positions, bmesh.morphs, state.morph_weights)
    garment_rest = apply_morphs(gmesh.positions, gmesh.morphs, state.morph_weights)
    if state.posed:
        body_points = linear_blend_skin(
            body_rest, body.nodes[bmesh.joints], bmesh.weights, state.skin
        )
        garment_points = linear_blend_skin(
            garment_rest, garment.nodes[gmesh.joints], gmesh.weights, state.skin
        )
    else:
        body_points, garment_points = body_rest, garment_rest
    normals = welded_normals(body_points, bmesh.triangles, body.weld) * body.outward
    return Posed(body_points, normals, garment_points, body_rest, garment_rest)


def _near_box(points: F64, box_points: F64, margin: float) -> I64:
    lo, hi = box_points.min(axis=0) - margin, box_points.max(axis=0) + margin
    return np.flatnonzero(np.all((points >= lo) & (points <= hi), axis=1))


def covered(points: F64, normals: F64, garment: F64, triangles: I64) -> tuple[Bool, I64]:
    """Skin points the cloth runs over (inside or outside it): the closest garment
    point faces the point, the cloth lies along the skin and the offset is along the
    skin normal. Hems, cuffs, collar rims and hands near the clothes do not count, nor
    skin more than COVER_OUT outside the cloth. Also returns each point's partner: a
    corner of its closest garment triangle."""
    found = nearest(points, garment, triangles)
    signed = np.einsum("ij,ij->i", found.normal, normals)
    cosine = np.abs(signed)
    along = found.along * np.sign(signed)
    outward = np.abs(np.einsum("ij,ij->i", found.offset, normals)) / np.maximum(
        found.distance, 1e-12
    )
    mask = (
        (found.distance < COVER_REACH)
        & (found.square >= SQUARE)
        & (cosine >= PARALLEL)
        & ((outward >= OUTWARD) | (found.distance < 1e-5))
        & (along <= COVER_OUT)
    )
    return mask, triangles[found.triangle, 0]


@dataclass
class Pairing:
    """Neutral rest pairing of one garment with the body: the body vertices it covers
    with the garment vertex each is paired with, and the body vertex nearest each
    garment vertex."""

    under: Bool
    under_partner: I64
    body_partner: I64


def pair_garment(body: Body, garment: Garment, neutral: Posed) -> Pairing:
    count = len(neutral.body)
    under = np.zeros(count, dtype=bool)
    partner = np.zeros(count, dtype=np.int64)
    rows = _near_box(neutral.body, neutral.garment, COVER_REACH)
    under[rows], partner[rows] = covered(
        neutral.body[rows], neutral.body_normals[rows], neutral.garment, garment.mesh.triangles
    )
    _, body_partner = cKDTree(neutral.body).query(neutral.garment)
    return Pairing(under, partner, np.asarray(body_partner, dtype=np.int64))


def audit_body(body: Body, garment: Garment, posed: Posed, pairing: Pairing) -> dict[str, Any]:
    """Body measures of one case: skin-through only on the body vertices the garment
    covers at neutral, both depth measures only near the neutral partners."""
    gmesh, bmesh = garment.mesh, body.asset.mesh
    rows = np.flatnonzero(pairing.under & garment.drawn)
    depth = np.zeros(len(posed.body))
    depth[rows] = skin_through(
        posed.body[rows],
        posed.body_normals[rows],
        posed.garment,
        gmesh.triangles,
        partners=pairing.under_partner[rows],
        garment_rest=gmesh.positions,
        winding=garment.winding,
        skin=(posed.body, bmesh.triangles),
    )
    signed, square, triangle = signed_distance(
        posed.garment, posed.body, bmesh.triangles, outward=body.outward
    )
    corner = bmesh.positions[bmesh.triangles[triangle, 0]]
    tracked = np.linalg.norm(corner - bmesh.positions[pairing.body_partner], axis=1) < TRACK_REACH
    sunk = np.where(
        (signed < -CLOTH_SUNK) & (square >= SQUARE) & (np.abs(signed) < COVER_REACH) & tracked,
        -signed,
        0.0,
    )
    over_hidden = garment.body_triangle_hidden[triangle]
    # Sunk cloth under drawn skin shows only when no other cloth lies over that skin.
    exposed = np.flatnonzero((sunk > 0) & ~over_hidden)
    if len(exposed):
        normal = face_normals(posed.body, bmesh.triangles[triangle[exposed]]) * body.outward
        skin = posed.garment[exposed] + normal * sunk[exposed, None]
        over = ray_hits(skin + normal * 1e-4, normal, posed.garment, gmesh.triangles)
        over_hidden = over_hidden.copy()
        over_hidden[exposed[over]] = True
    garment_regions = [body.regions[bmesh.triangles[t, 0]] for t in triangle]
    crossed = layers_crossed(posed.garment, posed.body_normals, garment.layers)
    anchor = np.zeros(len(posed.garment), dtype=np.int64)
    anchor[garment.layers.inner] = garment.layers.anchor
    return {
        "skin_through": depth_stats(depth, body.regions),
        "cloth_sunk_visible": depth_stats(np.where(over_hidden, 0.0, sunk), garment_regions),
        "cloth_sunk_hidden": depth_stats(np.where(over_hidden, sunk, 0.0)),
        "layers_crossed": depth_stats(crossed, [body.regions[v] for v in anchor]),
        "holes": body_holes(body, garment, posed),
    }


def body_holes(body: Body, garment: Garment, posed: Posed) -> dict[str, Any]:
    """Hidden body triangles the background shows through: the ray along their
    outward normal from the centroid meets neither the garment nor the body within
    HOLE_REACH (the converter hides skin when rays around the normal all meet one of
    them), and no cloth lies just under them either (that is a dent, counted by
    `cloth_sunk_hidden`). Triangles with cloth squarely over them are taken as covered
    without casting."""
    rows = np.flatnonzero(garment.body_triangle_hidden)
    stats: dict[str, Any] = {"count": 0, "of": len(rows)}
    if len(rows) == 0:
        return stats
    triangles = body.asset.mesh.triangles
    tri = triangles[rows]
    centroids = posed.body[tri].mean(axis=1)
    normals = face_normals(posed.body, tri) * body.outward
    found = nearest(centroids, posed.garment, garment.mesh.triangles)
    cosine = np.abs(np.einsum("ij,ij->i", found.normal, normals))
    ahead = -np.einsum("ij,ij->i", found.offset, normals) / np.maximum(found.distance, 1e-12)
    over = (
        (found.distance < HOLE_REACH)
        & (found.square >= SQUARE)
        & (cosine >= PARALLEL)
        & (ahead >= OUTWARD)
    )
    test = np.flatnonzero(~over)
    gtri = garment.mesh.triangles
    seeing = test.copy()
    for points, mesh, sign, reach in (
        (posed.garment, gtri, 1.0, HOLE_REACH),  # cloth over it: covered
        (posed.body, triangles, 1.0, HOLE_REACH),  # the body in front: occluded
        (posed.garment, gtri, -1.0, RAY_REACH),  # cloth sunk just under it: a dent
    ):
        if len(seeing) == 0:
            break
        direction = normals[seeing] * sign
        hit = ray_hits(centroids[seeing] + direction * 1e-4, direction, points, mesh, reach=reach)
        seeing = seeing[~hit]
    open_rows = rows[seeing]
    stats["count"] = len(open_rows)
    if len(open_rows):
        corner = triangles[open_rows, 0]
        stats["regions"] = dict(Counter(body.regions[v] for v in corner).most_common(6))
    return stats


def skin_to_head(
    garment: F64,
    joints: I64,
    weights: F64,
    head: F64,
    head_joints: I64,
    head_weights: F64,
    body: F64,
) -> tuple[I64, F64]:
    """Port of `skinGarmentToHead` (garments.ts): garment vertices nearer the head skin
    than the body skin take the inverse-distance blend of their nearest head vertices'
    skin, faded in over HEAD_BAND. Joints are body nodes on both sides (head slots
    mapped to their anchors); bind frame. Returns the new (joints, weights), top 4."""
    joints, weights = joints.copy(), weights.copy()
    lo, hi = head.min(axis=0), head.max(axis=0)
    rows = np.flatnonzero(np.all((garment >= lo - HEAD_REACH) & (garment <= hi + HEAD_REACH), 1))
    near_body = body[np.all((body >= lo - 2 * HEAD_REACH) & (body <= hi + 2 * HEAD_REACH), 1)]
    if len(rows) == 0:
        return joints, weights
    to_body = np.full(len(rows), HEAD_REACH)
    if len(near_body):
        found, _ = cKDTree(near_body).query(garment[rows], distance_upper_bound=HEAD_REACH)
        to_body = np.where(np.isfinite(found), found, HEAD_REACH)
    distance, index = cKDTree(head).query(garment[rows], k=HEAD_NEIGHBOURS)
    t = np.clip((to_body - distance[:, 0]) / HEAD_BAND, 0.0, 1.0)
    blend = t * t * (3 - 2 * t)
    for r in np.flatnonzero(t > 0):
        v = rows[r]
        mix: dict[int, float] = {}
        total = 0.0
        for d, h in zip(distance[r], index[r], strict=True):
            if d >= to_body[r]:
                break
            inverse = 1.0 / max(float(d), 1e-5)
            for j, w in zip(head_joints[h], head_weights[h], strict=True):
                if w > 0 and j >= 0:
                    mix[int(j)] = mix.get(int(j), 0.0) + inverse * float(w)
                    total += inverse * float(w)
        if total <= 0:
            continue
        own_total = float(np.maximum(weights[v], 0).sum())
        mixed: dict[int, float] = {}
        for j, w in zip(joints[v], weights[v], strict=True):
            if w > 0 and own_total > 0:
                mixed[int(j)] = mixed.get(int(j), 0.0) + (1 - blend[r]) * float(w) / own_total
        for j, w in mix.items():
            mixed[j] = mixed.get(j, 0.0) + blend[r] * w / total
        top = sorted(mixed.items(), key=lambda kv: -kv[1])[: joints.shape[1]]
        top_total = sum(w for _, w in top)
        if top_total <= 0:
            continue
        joints[v] = [j for j, _ in top] + [0] * (joints.shape[1] - len(top))
        weights[v] = [w / top_total for _, w in top] + [0.0] * (joints.shape[1] - len(top))
    return joints, weights


@dataclass
class HeadFit:
    """What wearing a garment on one face settles at neutral: the head vertices it
    covers, and the garment skin after `skinGarmentToHead` (body nodes)."""

    under: Bool
    partner: I64  # garment vertex paired with each head vertex
    joints: I64
    weights: F64


def head_fit(rig: HeadRig, garment: Garment, neutral: BodyState, posed: Posed) -> HeadFit | None:
    """None when the garment does not come near the head."""
    rest, _ = place_head(rig, neutral)
    if len(_near_box(posed.garment_rest, rest, HEAD_REACH)) == 0:
        return None
    hmesh, gmesh = rig.head.asset.mesh, garment.mesh
    normals = welded_normals(rest, hmesh.triangles, rig.head.weld) * rig.head.outward
    joints, weights = skin_to_head(
        posed.garment_rest,
        garment.nodes[gmesh.joints],
        gmesh.weights,
        rest,
        rig.anchors[hmesh.joints],
        hmesh.weights,
        posed.body_rest,
    )
    fitted = fit_over_head(posed.garment_rest, rest, normals)
    under = np.zeros(len(rest), dtype=bool)
    partner = np.zeros(len(rest), dtype=np.int64)
    rows = _near_box(rest, fitted, COVER_REACH)
    under[rows], partner[rows] = covered(rest[rows], normals[rows], fitted, gmesh.triangles)
    return HeadFit(under, partner, joints, weights)


def audit_head(
    rig: HeadRig, garment: Garment, state: BodyState, posed: Posed, fit: HeadFit
) -> dict[str, Any]:
    """Head skin through the garment after the runtime's collar fit and re-skin."""
    head = rig.head
    rest, head_posed = place_head(rig, state)
    hmesh = head.asset.mesh
    rest_normals = welded_normals(rest, hmesh.triangles, head.weld) * head.outward
    fitted = fit_over_head(posed.garment_rest, rest, rest_normals)
    if state.posed:
        garment_points = linear_blend_skin(fitted, fit.joints, fit.weights, state.skin)
        head_points = head_posed
        head_normals = welded_normals(head_points, hmesh.triangles, head.weld) * head.outward
    else:
        garment_points, head_points, head_normals = fitted, rest, rest_normals
    rows = np.flatnonzero(fit.under)
    depth = np.zeros(len(head_points))
    depth[rows] = skin_through(
        head_points[rows],
        head_normals[rows],
        garment_points,
        garment.mesh.triangles,
        partners=fit.partner[rows],
        garment_rest=garment.mesh.positions,
        winding=garment.winding,
        skin=(head_points, hmesh.triangles),
    )
    return depth_stats(depth, head.regions)


def outfit_states(entry: Mapping[str, Any]) -> list[tuple[str, dict[str, float]]]:
    """Neutral, every slider end, the manifest presets and COMBINED."""
    sliders = [s["id"] for s in entry.get("sliders", [])] or list(SLIDERS)
    states: list[tuple[str, dict[str, float]]] = [("neutral", {})]
    for slider in sliders:
        for end in (-1.0, 1.0):
            states.append((f"{slider}{end:+.0f}", {slider: end}))
    for name, values in (entry.get("presets") or {}).items():
        nonzero = {k: float(v) for k, v in values.items() if float(v) != 0.0}
        if nonzero:
            states.append((f"preset:{name}", nonzero))
    for name, values in COMBINED.items():
        if all(k in sliders for k in values):
            states.append((name, dict(values)))
    return states


@dataclass
class GenderContext:
    """What every outfit of one gender is measured against."""

    body: Body
    entry: dict[str, Any]
    heads: list[HeadRig]
    poses: list[tuple[str, F64]]


_CONTEXTS: dict[tuple[str, str, tuple[str, ...], bool], GenderContext] = {}


def gender_context(archive_web: Path, gender: str, options: Options) -> GenderContext:
    """Loaded once per process (workers reuse it across outfits)."""
    key = (str(archive_web), gender, tuple(options.faces), options.pose)
    if key in _CONTEXTS:
        return _CONTEXTS[key]
    manifest, hidden = read_manifest(archive_web)
    entry = next(b for b in manifest.get("bodies", []) if b["gender"] == gender)
    body = load_body(archive_web, entry)
    heads = [
        rig_head(load_head(archive_web, f), body)
        for f in manifest.get("faces", [])
        if f["id"] not in hidden and f.get("gender") == gender and _matches(f["id"], options.faces)
    ]
    poses: list[tuple[str, F64]] = []
    if options.pose:
        for role, clip_entry in pose_clips(manifest, hidden):
            clip = read_clip(archive_web / clip_entry["file"], clip_entry["id"], role)
            for label, at in clip_frames(clip, body.asset.skeleton):
                name = f"{role}:{clip.id.split('.')[-1]}@{label}{at:g}s"
                poses.append((name, clip.rotations(body.asset.skeleton, at)))
    context = GenderContext(body, entry, heads, poses)
    _CONTEXTS[key] = context
    return context


def pose_clips(manifest: Mapping[str, Any], hidden: set[str]) -> list[tuple[str, dict[str, Any]]]:
    """The first visible body clip (by id) of each role, idle and talk."""
    clips = [
        a
        for a in manifest.get("animations", [])
        if a.get("kind") == "body" and a["id"] not in hidden and a["file"].endswith(".glb")
    ]
    chosen: list[tuple[str, dict[str, Any]]] = []
    for role in ("idle", "talk"):
        pool = sorted((a for a in clips if role in a.get("tags", [])), key=lambda a: a["id"])
        if pool:
            chosen.append((role, pool[0]))
    return chosen


def audit_outfit(
    archive_web: Path, gender: str, outfit_id: str, options: Options
) -> tuple[list[dict[str, Any]], float]:
    """Every case of one outfit on one gender; returns (cases, seconds)."""
    started = time.perf_counter()
    context = gender_context(archive_web, gender, options)
    manifest, _ = read_manifest(archive_web)
    entry = next(o for o in manifest["outfits"] if o["id"] == outfit_id)
    body = context.body
    garment = load_garment(archive_web, entry, gender, body)
    neutral = body_state(body, "neutral", {})
    neutral_posed = pose_pair(body, garment, neutral)
    pairing = pair_garment(body, garment, neutral_posed)
    fits = [(rig, head_fit(rig, garment, neutral, neutral_posed)) for rig in context.heads]
    fits = [(rig, fit) for rig, fit in fits if fit is not None]
    cases: list[dict[str, Any]] = []
    for state_name, sliders in outfit_states(context.entry):
        variants: list[tuple[str, F64 | None]] = [("rest", None)]
        if options.posed_states == "all" or state_name == "neutral":
            variants += list(context.poses)
        for pose_name, rotations in variants:
            state = body_state(body, state_name, sliders, rotations, pose_name)
            posed = pose_pair(body, garment, state)
            case: dict[str, Any] = {
                "outfit": garment.id,
                "gender": gender,
                "category": garment.category,
                "state": state_name,
                "pose": pose_name,
                **audit_body(body, garment, posed, pairing),
            }
            heads = {rig.head.id: audit_head(rig, garment, state, posed, fit) for rig, fit in fits}
            if heads:
                case["head"] = heads
            cases.append(case)
    return cases, time.perf_counter() - started


# --- grooms -------------------------------------------------------------------------------


@dataclass
class Cards:
    id: str
    slot: str
    compat: str
    fitted_to: str
    positions: F64
    triangles: I64
    bind_positions: I64
    bind_weights: F64
    bind_offset: F64
    card: I64  # card (connected component) per vertex
    roots: I64  # root vertex per card


def load_cards(archive_web: Path, entry: Mapping[str, Any]) -> Cards:
    path = archive_web / entry["glb"]
    attributes = ("_BIND_POSITIONS", "_BIND_WEIGHTS", "_BIND_OFFSET")
    try:
        asset = read_asset(path, meshes={"cards_lod0"}, attributes=attributes, morphs=False)
    except FitAuditError:
        asset = read_asset(path, attributes=attributes, morphs=False)
    mesh = asset.mesh
    offset = mesh.attributes["_BIND_OFFSET"]
    card = components(len(mesh.positions), mesh.triangles)
    lift = np.linalg.norm(np.nan_to_num(offset, nan=np.inf), axis=1)
    order = np.lexsort((lift, card))
    first = np.r_[True, card[order][1:] != card[order][:-1]]
    roots = np.full(int(card.max()) + 1, -1, dtype=np.int64)
    roots[card[order][first]] = order[first]
    return Cards(
        id=str(entry["id"]),
        slot=str(entry.get("slot", "")),
        compat=str(entry.get("compat", "unisex")),
        fitted_to=str(asset.extras.get("fitted_to", "")),
        positions=mesh.positions,
        triangles=mesh.triangles,
        bind_positions=np.round(np.nan_to_num(mesh.attributes["_BIND_POSITIONS"], nan=-1)).astype(
            np.int64
        ),
        bind_weights=mesh.attributes["_BIND_WEIGHTS"],
        bind_offset=offset,
        card=card,
        roots=roots[roots >= 0],
    )


def head_table(head: Head) -> F64:
    """Rest position of every DNA position index of the head primitive (NaN where it has
    no vertex), like `headPositionTable` (grooms.ts)."""
    first = _first_vertex(head.weld)
    table = np.full((max(first) + 1, 3), np.nan)
    for p, v in first.items():
        table[p] = head.asset.mesh.positions[v]
    return table


def refit_cards(cards: Cards, table: F64) -> tuple[F64, int]:
    """`refitPositions` (grooms.ts): sum(w * head[p]) + offset; vertices whose binding
    points at positions the head lacks keep their loaded position."""
    index = cards.bind_positions
    valid = np.all((index >= 0) & (index < len(table)), axis=1)
    safe = np.where(valid[:, None], index, 0)
    corners = table[safe]  # (V, 3, 3)
    valid &= ~np.isnan(corners).any(axis=(1, 2))
    valid &= ~np.isnan(cards.bind_weights).any(axis=1) & ~np.isnan(cards.bind_offset).any(axis=1)
    fitted = np.einsum("vk,vkj->vj", np.nan_to_num(cards.bind_weights), np.nan_to_num(corners))
    out = np.where(valid[:, None], fitted + np.nan_to_num(cards.bind_offset), cards.positions)
    return out, int((~valid).sum())


def head_direction_regions(points: F64, head: Head) -> list[str]:
    """Coarse place on the head of each point: top / front / back / left / right / low,
    by the dominant axis of its offset from the skull centre (the mean of the head
    vertices in the top 12 cm)."""
    positions = head.asset.mesh.positions
    centre = positions[positions[:, 1] > positions[:, 1].max() - 0.12].mean(axis=0)
    d = points - centre
    axis = np.argmax(np.abs(d), axis=1)
    sign = d[np.arange(len(d)), axis] > 0
    names = (("right", "left"), ("low", "top"), ("back", "front"))
    return [names[a][int(s)] for a, s in zip(axis, sign, strict=True)]


@dataclass(frozen=True)
class CardDepth:
    """Cards refitted to one head: signed distance of every vertex to the head (inf when
    farther than CARD_REACH from it) and the `square` measure of its closest point."""

    points: F64
    signed: F64
    square: F64
    missed: int


def card_depth(cards: Cards, head: Head) -> CardDepth:
    points, missed = refit_cards(cards, head_table(head))
    mesh = head.asset.mesh
    near, _ = cKDTree(mesh.positions).query(points, k=1, distance_upper_bound=CARD_REACH)
    rows = np.flatnonzero(np.isfinite(near))
    signed = np.full(len(points), np.inf)
    square = np.zeros(len(points))
    s, q, _ = signed_distance(points[rows], mesh.positions, mesh.triangles, outward=head.outward)
    signed[rows], square[rows] = s, q
    return CardDepth(points, signed, square, missed)


def audit_cards(cards: Cards, head: Head, reference: CardDepth | None = None) -> dict[str, Any]:
    """Cards inside the head and roots off or in it on one face. With the `reference`
    (the cards on the face they were fitted to), `sunk_beyond_reference` counts the
    vertices this face pushes deeper than the reference does (by over CARD_INSIDE):
    root ends tucked into the skin by design do not count there."""
    depth = card_depth(cards, head)
    signed, square = depth.signed, depth.square
    inside = np.where((signed < -CARD_INSIDE) & (square >= SQUARE), -signed, 0.0)
    hit = inside > 0
    regions = ["?"] * len(signed)
    labels = head_direction_regions(depth.points[hit], head)
    for i, label in zip(np.flatnonzero(hit), labels, strict=True):
        regions[i] = label
    stats = depth_stats(inside, regions)
    stats["cards"] = len(np.unique(cards.card[hit]))
    result: dict[str, Any] = {"inside": stats}
    if reference is not None:
        base = np.where(
            (reference.signed < 0) & np.isfinite(reference.signed), -reference.signed, 0.0
        )
        extra = np.where(inside - base > CARD_INSIDE, inside - base, 0.0)
        beyond = depth_stats(extra, regions)
        beyond["cards"] = len(np.unique(cards.card[extra > 0]))
        result["sunk_beyond_reference"] = beyond
    root_signed = signed[cards.roots]
    root_far = np.where(np.isfinite(root_signed), root_signed, CARD_REACH)
    floating = root_far > ROOT_FLOAT
    sunk = (root_signed < -CARD_INSIDE) & (square[cards.roots] >= SQUARE)
    result["root_float"] = {
        "cards": int(floating.sum()),
        "of": len(cards.roots),
        "max_mm": round(float(root_far.max() * 1000), 2) if len(root_far) else 0.0,
    }
    result["root_sunk"] = depth_stats(np.where(sunk, -root_signed, 0.0))
    result["unbound_vertices"] = depth.missed
    return result


def face_measures(head: Head) -> dict[str, float]:
    """Skull width (x extent of the top 12 cm) and neck length (head joint height over
    the seam loop), in the head's bind space, metres."""
    positions = head.asset.mesh.positions
    top = positions[:, 1].max()
    skull = positions[positions[:, 1] > top - 0.12]
    world = head.asset.skeleton.world()
    index = head.asset.skeleton.index
    head_y = world[index["head"], 1, 3] if "head" in index else top - 0.1
    seam_y = (
        positions[head.seam.boundary, 1].mean() if head.seam is not None else positions[:, 1].min()
    )
    return {
        "skull_width": float(np.ptp(skull[:, 0])),
        "neck_length": float(head_y - seam_y),
    }


def pick_faces(heads: Sequence[Head], extra: Iterable[str] = ()) -> list[Head]:
    """The extremes of skull width and neck length, plus the named faces."""
    if not heads:
        return []
    measures = [face_measures(head) for head in heads]
    picked: list[Head] = []
    for key in ("skull_width", "neck_length"):
        values = [m[key] for m in measures]
        for i in (int(np.argmin(values)), int(np.argmax(values))):
            if heads[i] not in picked:
                picked.append(heads[i])
    wanted = set(extra)
    for head in heads:
        named = head.id in wanted or head.id.removeprefix("face.") in wanted
        if named and head not in picked:
            picked.append(head)
    return picked


# --- the run ----------------------------------------------------------------------------------


@dataclass
class Options:
    outfits: list[str] = field(default_factory=list)
    grooms: list[str] = field(default_factory=list)
    faces: list[str] = field(default_factory=list)
    only: str | None = None  # "outfits" or "grooms"
    pose: bool = True
    posed_states: str = "neutral"  # "neutral" or "all"
    jobs: int = 1


def _matches(entry_id: str, wanted: Sequence[str]) -> bool:
    if not wanted:
        return True
    short = entry_id.split(".")[-1]
    return entry_id in wanted or short in wanted


def read_manifest(archive_web: Path) -> tuple[dict[str, Any], set[str]]:
    path = archive_web / "manifest.json"
    if not path.is_file():
        raise FitAuditError(f"no manifest at {path}")
    manifest = json.loads(path.read_text(encoding="utf-8"))
    hidden: set[str] = set()
    curation = archive_web / CURATION_FILE
    if curation.is_file():
        data = json.loads(curation.read_text(encoding="utf-8"))
        hidden = {str(i) for i in data.get("hidden", []) if isinstance(i, str)}
    return manifest, hidden


def _compatible(compat: str, gender: str) -> bool:
    return compat in ("unisex", gender)


def run_outfits(
    archive_web: Path,
    manifest: Mapping[str, Any],
    hidden: set[str],
    options: Options,
    log: Callable[[str], None],
) -> list[dict[str, Any]]:
    genders = [b["gender"] for b in manifest.get("bodies", [])]
    tasks = [
        (gender, entry["id"])
        for gender in genders
        for entry in manifest.get("outfits", [])
        if entry["id"] not in hidden
        and _matches(entry["id"], options.outfits)
        and gender in entry.get("files", {})
        and _compatible(entry.get("compat", "unisex"), gender)
    ]
    results: dict[tuple[str, str], list[dict[str, Any]]] = {}

    def done(task: tuple[str, str], cases: list[dict[str, Any]], seconds: float) -> None:
        results[task] = cases
        log(f"  {task[1]} {task[0]}: {len(cases)} cases, {seconds:.1f} s")

    if options.jobs > 1 and len(tasks) > 1:
        with ProcessPoolExecutor(max_workers=options.jobs) as pool:
            futures = {
                pool.submit(audit_outfit, archive_web, gender, outfit, options): (gender, outfit)
                for gender, outfit in tasks
            }
            for future in as_completed(futures):
                done(futures[future], *future.result())
    else:
        for gender, outfit in tasks:
            done((gender, outfit), *audit_outfit(archive_web, gender, outfit, options))
    return [case for task in tasks for case in results[task]]


def run_grooms(
    archive_web: Path,
    manifest: Mapping[str, Any],
    hidden: set[str],
    options: Options,
    log: Callable[[str], None],
) -> list[dict[str, Any]]:
    faces = [f for f in manifest.get("faces", []) if f["id"] not in hidden]
    heads = {f["id"]: load_head(archive_web, f) for f in faces}
    by_gender: dict[str, list[Head]] = {}
    for head in heads.values():
        by_gender.setdefault(head.gender, []).append(head)
    cases: list[dict[str, Any]] = []
    for entry in manifest.get("grooms", []):
        if entry["id"] in hidden or not _matches(entry["id"], options.grooms):
            continue
        if not entry.get("glb"):
            log(f"  {entry['id']}: painted on the skin (no cards), skipped")
            continue
        started = time.perf_counter()
        cards = load_cards(archive_web, entry)
        reference_head = heads.get(f"face.{cards.fitted_to}")
        reference = card_depth(cards, reference_head) if reference_head else None
        chosen: list[Head] = []
        for gender in ("female", "male"):
            if not _compatible(cards.compat, gender):
                continue
            pool = by_gender.get(gender, [])
            if options.faces:
                chosen += [h for h in pool if _matches(h.id, options.faces)]
            else:
                chosen += pick_faces(pool)
        if reference_head is not None and reference_head not in chosen:
            chosen.append(reference_head)
        for head in chosen:
            cases.append(
                {
                    "groom": cards.id,
                    "slot": cards.slot,
                    "face": head.id,
                    "reference": head is reference_head,
                    "fitted_to": cards.fitted_to,
                    **audit_cards(cards, head, reference),
                }
            )
        log(f"  {cards.id}: {len(chosen)} faces, {time.perf_counter() - started:.1f} s")
    return cases


VISIBLE = ("skin_through", "cloth_sunk_visible", "layers_crossed", "holes")


def worst_head(case: Mapping[str, Any]) -> tuple[str, dict[str, Any]] | None:
    heads = case.get("head") or {}
    return max(heads.items(), key=lambda kv: kv[1]["count"], default=None)


def outfit_score(case: Mapping[str, Any]) -> tuple[int, float]:
    """Visible defect size: skin through (body and the worst face), cloth sunk over
    drawn skin, crossed layers and holes, then the deepest of them (mm)."""
    count = sum(case[key]["count"] for key in VISIBLE)
    depth = max(case[key].get("max_mm", 0.0) for key in VISIBLE)
    head = worst_head(case)
    if head is not None:
        count += head[1]["count"]
        depth = max(depth, head[1].get("max_mm", 0.0))
    return count, depth


def groom_score(case: Mapping[str, Any]) -> tuple[int, float]:
    """Cards with vertices inside the head, then the deepest (mm)."""
    return case["inside"]["cards"], case["inside"].get("max_mm", 0.0)


def _cell(stats: Mapping[str, Any]) -> str:
    if not stats["count"]:
        return "0"
    depth = f"/{stats['max_mm']}mm" if "max_mm" in stats else ""
    return f"{stats['count']}{depth}"


def summary(report: Mapping[str, Any], top: int = 10) -> list[str]:
    lines: list[str] = []
    outfits = sorted(report.get("outfits", []), key=outfit_score, reverse=True)
    if outfits:
        lines.append(
            f"worst {top} outfit cases (of {len(outfits)}; count/max depth: skin through,"
            " cloth sunk over drawn skin, layers crossed, holes, worst head):"
        )
        for case in outfits[:top]:
            head = worst_head(case)
            head_text = (
                f" head {_cell(head[1])} {head[0].removeprefix('face.')}"
                if head and head[1]["count"]
                else ""
            )
            regions = Counter[str]()
            for key in VISIBLE:
                regions.update(case[key].get("regions") or {})
            if head and head[1]["count"]:
                regions.update(head[1].get("regions") or {})
            where = ", ".join(name for name, _ in regions.most_common(3))
            lines.append(
                f"  {case['outfit'].removeprefix('outfit.'):<20} {case['gender']:<6}"
                f" {case['state']:<24} {case['pose']:<26}"
                f" skin {_cell(case['skin_through'])} sunk {_cell(case['cloth_sunk_visible'])}"
                f" layers {_cell(case['layers_crossed'])} holes {case['holes']['count']}"
                f"{head_text}  [{where}]"
            )
        collar = [
            c
            for c in report["outfits"]
            if c["outfit"] in CREW_NECKS and c.get("head") and c["pose"] == "rest"
        ]
        if collar:
            lines.append("crew-neck collars, head skin through (count/max mm), rest pose:")
            for case in collar:
                if case["state"] not in ("neutral", "weight-1", "shoulders-1"):
                    continue
                cells = ", ".join(
                    f"{face.removeprefix('face.')} {_cell(v)}"
                    for face, v in sorted(case["head"].items(), key=lambda kv: -kv[1]["count"])
                    if v["count"]
                )
                lines.append(
                    f"  {case['outfit'].removeprefix('outfit.')} {case['gender']}"
                    f" {case['state']}: {cells or 'clean'}"
                )
    grooms = sorted(report.get("grooms", []), key=groom_score, reverse=True)
    if grooms:
        lines.append(
            f"worst {top} groom cases (of {len(grooms)}; cards with vertices inside the head):"
        )
        for case in grooms[:top]:
            inside = case["inside"]
            beyond = case.get("sunk_beyond_reference")
            beyond_text = (
                f", deeper than on {case['fitted_to']}: {_cell(beyond)}"
                if beyond is not None and not case["reference"]
                else " (reference face)"
                if case["reference"]
                else ""
            )
            where = ", ".join(list(inside.get("regions") or {})[:3])
            lines.append(
                f"  {case['groom'].removeprefix('groom.'):<30}"
                f" {case['face'].removeprefix('face.'):<10}"
                f" {inside['cards']:>4}/{case['root_float']['of']} cards,"
                f" {_cell(inside)} vtx (p95 {inside.get('p95_mm', 0)}){beyond_text};"
                f" roots off >5mm {case['root_float']['cards']}  [{where}]"
            )
        refits = [c for c in grooms if c.get("sunk_beyond_reference") and not c["reference"]]
        refits.sort(key=lambda c: c["sunk_beyond_reference"]["count"], reverse=True)
        if refits:
            lines.append(
                f"worst {top} groom refits (vertices sunk deeper than on the face fitted to):"
            )
            for case in refits[:top]:
                beyond = case["sunk_beyond_reference"]
                where = ", ".join(list(beyond.get("regions") or {})[:3])
                lines.append(
                    f"  {case['groom'].removeprefix('groom.'):<30}"
                    f" {case['face'].removeprefix('face.'):<10} {_cell(beyond)}"
                    f" (p95 {beyond.get('p95_mm', 0)}), {beyond['cards']} cards,"
                    f" vs {case['fitted_to']}  [{where}]"
                )
    return lines


def audit(archive: Path, options: Options, log: Callable[[str], None] = print) -> dict[str, Any]:
    web = archive / "web"
    manifest, hidden = read_manifest(web)
    started = time.perf_counter()
    report: dict[str, Any] = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "archive": str(archive),
        "manifest_generated": manifest.get("generatedAt"),
        "thresholds_mm": {
            "skin_through": SKIN_THROUGH * 1000,
            "cloth_sunk": CLOTH_SUNK * 1000,
            "cover_reach": COVER_REACH * 1000,
            "track_reach": TRACK_REACH * 1000,
            "cover_out": COVER_OUT * 1000,
            "ray_reach": RAY_REACH * 1000,
            "layer_reach": LAYER_REACH * 1000,
            "layer_cross": LAYER_CROSS * 1000,
            "card_inside": CARD_INSIDE * 1000,
            "root_float": ROOT_FLOAT * 1000,
            "square": SQUARE,
            "parallel": PARALLEL,
            "outward": OUTWARD,
        },
    }
    if options.only in (None, "outfits"):
        log("outfits:")
        report["outfits"] = run_outfits(web, manifest, hidden, options, log)
    if options.only in (None, "grooms"):
        log("grooms:")
        report["grooms"] = run_grooms(web, manifest, hidden, options, log)
    report["seconds"] = round(time.perf_counter() - started, 1)
    return report


def add_parser(sub: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    parser = sub.add_parser(
        COMMAND,
        help="measure skin through clothes and hair cards in or off heads (read-only)",
    )
    parser.add_argument("--archive", type=Path, default=None, help="MetaHumanArchive root")
    parser.add_argument("--outfit", action="append", default=[], help="outfit id (repeatable)")
    parser.add_argument("--groom", action="append", default=[], help="groom id (repeatable)")
    parser.add_argument("--face", action="append", default=[], help="only these faces (repeatable)")
    parser.add_argument("--only", choices=("outfits", "grooms"), help="audit one side only")
    parser.add_argument("--no-pose", action="store_true", help="rest pose only")
    parser.add_argument(
        "--posed-states",
        choices=("neutral", "all"),
        default="neutral",
        help="body states the clip frames are measured at (default: neutral)",
    )
    parser.add_argument(
        "--out", type=Path, default=None, help=f"report path (default <archive>/{REPORT_FILE})"
    )
    parser.add_argument("--top", type=int, default=10, help="cases listed in the summary")
    parser.add_argument(
        "--jobs",
        type=int,
        default=min(4, os.cpu_count() or 1),
        help="worker processes for the outfits (default: up to 4)",
    )


def run(args: argparse.Namespace) -> int:
    from asset_pipeline.mh.convert import archive_root

    archive = args.archive or archive_root()
    only = args.only
    if args.outfit and not args.groom and only is None:
        only = "outfits"
    if args.groom and not args.outfit and only is None:
        only = "grooms"
    options = Options(
        outfits=list(args.outfit),
        grooms=list(args.groom),
        faces=list(args.face),
        only=only,
        pose=not args.no_pose,
        posed_states=args.posed_states,
        jobs=max(1, args.jobs),
    )
    try:
        report = audit(archive, options)
    except FitAuditError as exc:
        print(f"error: {exc}")
        return 1
    out = args.out or archive / REPORT_FILE
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8")
    print("\n".join(summary(report, args.top)))
    print(f"report: {out} ({report['seconds']} s)")
    return 0
