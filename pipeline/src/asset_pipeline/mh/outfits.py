"""Outfit garments: Unreal outfit exports refitted onto the web body.

Input (`raw/outfits/<gender>/`): `body/` holds Unreal's outfit-base body for that gender and
every `WI_<item>/` unit an outfit built on it (`OutfitBase_<gender>_Outfits.glb`,
`outfit.json` with the material instances, `textures/*.png`). Output: `outfits/<name>/
<gender>.glb` plus KTX2 maps (contract: docs/specs/2026-10-20-metahuman-web-assets.md,
"Outfit GLBs").

The outfit-base body has the web body's topology and UVs but other proportions (the
female one is about 4.5 % taller), so garments are re-expressed in the web body's bind
space rather than copied:

1. Correspondence. The base body's vertices are a permutation of `bodies/<gender>/body.glb`'s,
   found by UV (exact to float precision).
2. Caps. Unreal closes garment openings (neck, cuffs, waist, hems) with triangle fans the
   body runs through, and leaves small discs inside limbs; both are dropped. Fans lying on
   the garment (patches, pocket corners, eyelets) stay.
3. Transfer. Every garment vertex gets a row of body-vertex weights: the barycentrics of its
   closest base-body point near the skin, blended with distance into a Gaussian average
   over nearby body vertices (width grows with the distance), so loose cloth stays smooth
   where the closest point jumps (crotch, armpits, hood). The same row moves the garment by
   the body displacement (web minus base body), transfers the web body's skin weights (top
   4) and its slider morphs, so a garment follows the skin it covers.
4. Clearance. Vertices that end up closer than 2 mm to the skin are pushed out along the
   skin normal (tight bands sit slightly inside the body in Unreal, which hides the body).
   Cloth with thickness has an inner layer about 2 mm under the outer one, and both are
   often inside the clearance: every vertex takes the largest push over the skin around
   it (`stack_push`), so the layers move together instead of meeting on one surface, where
   the two-sided inner side showed through the outer as dark blotches. Each slider morph
   gets the same check at its end (body and garment morphed), since a loose vertex
   averages the deltas of a wide skin patch and can sink further than the skin right
   under it (a collar over the neck and back at weight -1).
5. `body_hide`. Body vertices that cannot see out: thirteen rays around the skin normal
   (up to 60 degrees) all run into the garment or the body within 10 cm, and the vertex
   is not near an exposed garment opening (collars, cuffs, hems). A closed shoe (one that
   already hides most of the toes) hides all of them: a foot longer than the shoe's toe box
   otherwise shows its toe tips through the cap, and they can see out.

Materials follow the graph of Unreal's `M_fabric_simpler` (read from the engine plugin's
asset): the GLB keeps the parameters and texture slots by their Unreal names in `extras.mh.
materials`, plus a plain glTF PBR approximation (normal map; the "AO" map is an ORM map).
Only the maps the material's static switches sample are written; tiling maps go to
`outfits/shared/`, named by content so items and genders share them. No TANGENT: like the
heads and bodies, the runtime derives the tangent frame from UV derivatives.

Materials on other (custom) masters stay "plain" glTF PBR. When the export also wrote a
baked GLB for the mesh (`<mesh>.baked.glb`, every material input rendered to textures on
UV0), its base colour, normal and occlusion + metallic/roughness (packed as one ORM map)
become the plain material's maps. That bake only covers UV 0..1, so a Khaos material painted
on UDIM tiles past 1001 is rebuilt from its raw tiles instead and its part's UVs move into an
atlas of the tiles it uses (`outfit_udim`, one 2048-px cell per tile).
"""

import base64
import hashlib
import io
import json
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path
from typing import Any, Literal

import numpy as np
from numpy.typing import NDArray
from PIL import Image
from scipy.sparse import coo_matrix, csr_matrix
from scipy.spatial import cKDTree

from asset_pipeline.mh.compat import COMPAT_FILE, curated_compat
from asset_pipeline.mh.geometry import closest_triangles, vertex_normals
from asset_pipeline.mh.glb import (
    ARRAY_BUFFER,
    ELEMENT_ARRAY_BUFFER,
    QUANTIZATION,
    GlbBuilder,
    accessor_array,
    accessor_values,
    quantize_snorm16,
    quantize_unorm16,
    quantize_weights,
    read_glb,
    view_bytes,
)
from asset_pipeline.mh.gltf import MAX_INFLUENCES, merge_influences
from asset_pipeline.mh.ktx import Ktx2Settings, encode_ktx2
from asset_pipeline.mh.outfit_udim import RECIPE as UDIM_RECIPE
from asset_pipeline.mh.outfit_udim import (
    AtlasLayout,
    is_khaos,
    is_udim_material,
    khaos_atlas,
    plan_atlas,
    remap_uvs,
    triangle_tiles,
)
from asset_pipeline.mh.textures import (
    AMBIGUOUS_CONVENTION,
    flip_green,
    linear_to_srgb,
    normal_convention,
    srgb_to_linear,
)

F64 = NDArray[np.float64]
I64 = NDArray[np.int64]
Bool = NDArray[np.bool_]

OUTFITS_VERSION = "outfit-v6"  # v6: cloth layers keep their order when pushed out
TEXTURE_RECIPE = "outfit-v1"  # part of every map's content name; bump to re-encode all maps
GENERATOR = "ai-sims mh-convert (outfits)"
GENDERS = ("female", "male")
WORLD_GRID = "WorldGridMaterial"  # Unreal's missing-material placeholder
# Unreal's fabric template default for colour 2 (sleeves, ribbing, stitches); instances
# that never set it would ship bright blue trims.
TEMPLATE_BLUE = "#378bff"

# Caps: fans of at least this many triangles around a hub at the rim's centre.
CAP_MIN_FAN = 16  # buttons, rivets and patch corners use smaller fans
CAP_MIN_RADIUS = 0.015  # metres
CAP_MAX_HUB_OFFSET = 0.4  # of the rim radius
CAP_MAX_ALIGNMENT = 0.4  # median |skin normal . disc normal| of a cap the body runs through
CAP_CROSS_MIN_RADIUS = 0.025  # metres: cuffs, ankles, hems and waists
CAP_MIN_BODY_VERTICES = 8
CAP_INSIDE_DEPTH = 0.01  # metres: fans this deep inside the body are leftovers
CAP_LEVEL = 0.7  # |disc normal . up| of a collar cap over the neck seam
CAP_SEAM_REACH = 0.05  # metres beyond the rim radius to the neck seam
CAP_SEAM_MIN_RADIUS = 0.04  # collar caps span the neck opening
WELD_DECIMALS = 6  # positions rounded to 1 µm when welding split vertices

# Transfer kernel.
KERNEL_NEIGHBOURS = 32
KERNEL_SIGMA_MIN = 0.006  # metres
KERNEL_SIGMA_SCALE = 0.5  # sigma grows by this times the distance to the skin
EXACT_RADIUS = 0.02  # closest-point weights fade out over this distance
CLEARANCE = 0.002  # metres between skin and garment after the fit
PUSH_DEPTH_LIMIT = 0.02  # deeper vertices are inner layers or leftovers: not pushed
LAYER_REACH = 0.006  # metres over the skin: vertices this close move out as one layer stack
MORPH_EPSILON = 1e-4  # metres: transferred morphs smaller than this are left out
FACE_ON_SHARE = 0.9  # |signed| / distance of an offset taken as along the skin normal

# body_hide.
HIDE_DISTANCE = 0.10  # metres along each visibility ray
HIDE_RAY_RINGS = ((35.0, 6), (60.0, 6))  # (tilt from the skin normal, rays) besides the normal
OPEN_MARGIN = 0.025  # metres kept visible around an exposed garment opening...
OPEN_GAP_FACTOR = 1.0  # ...plus this times the opening's distance from the skin
OPEN_NEIGHBOURS = 8
LAYER_THICKNESS = 0.006  # metres: hem folds and ribs closer than this are one layer

# Textures.
COVERAGE_LEVEL = 63  # 8-bit level a mask texel must exceed to count as covered
MIN_COVERAGE = 1e-4  # share of texels a mask needs before its colour is a parameter
ITEM_TEXTURE_SIZE = 2048
TILE_TEXTURE_SIZE = 1024
NORMAL = Ktx2Settings("linear", rdo=1.5)
DATA = Ktx2Settings("linear", rdo=2.0)
DATA_SRGB = Ktx2Settings("srgb", rdo=2.0)
COLOR = Ktx2Settings("srgb", rdo=1.0)
STITCH = Ktx2Settings("linear", rdo=None)
TILE_NORMAL = Ktx2Settings("linear", rdo=1.5, wrap=True)
TILE_DATA = Ktx2Settings("linear", rdo=2.0, wrap=True)
TILE_SRGB = Ktx2Settings("srgb", rdo=1.0, wrap=True)

# Flat maps by asset name: black_masks is not exported, and the techwear outfit's "black"
# map comes out of the export solid white (as a stitch mask that would turn the whole
# jacket into its stitch colour, against its colour masks).
KNOWN_CONSTANTS: dict[str, tuple[float, float, float, float]] = {
    "black_masks": (0.0, 0.0, 0.0, 0.0),
    "black": (0.0, 0.0, 0.0, 1.0),
    "Black": (0.0, 0.0, 0.0, 1.0),
}

FABRIC = "M_fabric_simpler"
FABRIC_MASTERS = (FABRIC, "M_fabric_simpler_fuzz_option")
JEANS = "M_jeans_nrm_custom_master"

Role = Literal["normal", "data", "color", "stitch"]


class OutfitError(ValueError):
    """An outfit unit cannot be converted."""


# ---------------------------------------------------------------------------- units


def _is_unit(folder: Path, gender: str) -> bool:
    return (
        folder.is_dir()
        and folder.name.startswith("WI_")
        and not folder.name.endswith(".partial")
        and (folder / "done.json").is_file()
        and (folder / "outfit.json").is_file()
        and (folder / f"OutfitBase_{gender}_Outfits.glb").is_file()
    )


@dataclass(frozen=True)
class OutfitUnit:
    gender: str
    folder: Path
    info: dict[str, Any]

    @classmethod
    def load(cls, folder: Path, gender: str) -> "OutfitUnit":
        info = json.loads((folder / "outfit.json").read_text(encoding="utf-8"))
        return cls(gender, folder, info)

    @property
    def name(self) -> str:
        return self.folder.name.removeprefix("WI_")

    @property
    def glb(self) -> Path:
        return self.folder / f"OutfitBase_{self.gender}_Outfits.glb"

    @property
    def done(self) -> Path:
        return self.folder / "done.json"

    def hashes(self) -> dict[str, str]:
        """sha256 of every exported texture by file name (from done.json)."""
        done = json.loads(self.done.read_text(encoding="utf-8"))
        return {
            Path(str(entry["path"])).name: str(entry["sha256"])
            for entry in done.get("files", [])
            if str(entry.get("path", "")).startswith("textures/")
        }

    def materials(self) -> dict[str, dict[str, Any]]:
        """Material instances by object name (`MI_...`, the GLB's material names)."""
        return {
            path.rsplit(".", 1)[-1]: material
            for path, material in self.info.get("materials", {}).items()
        }


def list_outfit_units(archive: Path) -> list[OutfitUnit]:
    units = []
    for gender in GENDERS:
        root = archive / "raw" / "outfits" / gender
        if not root.is_dir():
            continue
        units += [OutfitUnit.load(f, gender) for f in sorted(root.iterdir()) if _is_unit(f, gender)]
    return units


def base_body_path(archive: Path, gender: str) -> Path:
    return archive / "raw" / "outfits" / gender / "body" / f"SKM_OutfitBase_{gender}_BodyMesh.glb"


# ---------------------------------------------------------------------------- body


def _primitive(
    document: dict[str, Any], binary: bytes, primitive: dict[str, Any]
) -> dict[str, Any]:
    attributes = primitive["attributes"]
    out: dict[str, Any] = {
        "positions": accessor_values(document, binary, attributes["POSITION"]),
        "triangles": accessor_array(document, binary, primitive["indices"])
        .reshape(-1, 3)
        .astype(np.int64),
    }
    for key, name in (("NORMAL", "normals"), ("TEXCOORD_0", "uvs")):
        if key in attributes:
            out[name] = accessor_values(document, binary, attributes[key])
    joints = [k for k in sorted(attributes) if k.startswith("JOINTS_")]
    if joints:
        out["joints"] = np.concatenate(
            [accessor_array(document, binary, attributes[k]) for k in joints], axis=1
        ).astype(np.int64)
        out["weights"] = np.concatenate(
            [
                accessor_values(document, binary, attributes[k.replace("JOINTS", "WEIGHTS")])
                for k in joints
            ],
            axis=1,
        )
    return out


@dataclass(frozen=True, eq=False)
class Skeleton:
    """The web body's skin joints (in skin order) with their bind-pose node transforms."""

    names: tuple[str, ...]
    parents: I64  # (J,), -1 for roots
    translations: F64  # (J, 3) local
    rotations: F64  # (J, 4) local (x, y, z, w)
    scales: F64  # (J, 3)
    inverse_binds: F64  # (J, 4, 4) row-major


@dataclass(frozen=True, eq=False)
class BodyFit:
    """The web body (bind space) and Unreal's outfit-base body in its vertex order."""

    gender: str
    positions: F64  # (V, 3)
    normals: F64  # (V, 3)
    triangles: I64  # (T, 3)
    base_positions: F64  # (V, 3)
    joints: I64  # (V, 4)
    weights: F64  # (V, 4)
    morphs: dict[str, F64]  # name -> (V, 3)
    skeleton: Skeleton
    boundary: Bool  # (V,) vertices on the body's open edges (the neck seam)
    match_error: float  # largest UV distance of the correspondence

    @property
    def displacement(self) -> F64:
        return self.positions - self.base_positions

    @cached_property
    def base_normals(self) -> F64:
        return vertex_normals(self.base_positions, self.triangles)

    @cached_property
    def base_tree(self) -> cKDTree:
        return cKDTree(self.base_positions)

    @classmethod
    def load(cls, body_glb: Path, base_glb: Path, gender: str) -> "BodyFit":
        document, binary = read_glb(body_glb.read_bytes())
        mesh = document["meshes"][0]
        if len(mesh["primitives"]) != 1:
            raise OutfitError(f"{body_glb.name}: expected one body primitive")
        primitive = mesh["primitives"][0]
        body = _primitive(document, binary, primitive)
        names = mesh.get("extras", {}).get("targetNames", [])
        morphs = {
            name: accessor_values(document, binary, target["POSITION"])
            for name, target in zip(names, primitive.get("targets", []), strict=True)
        }
        offset = (
            document["scenes"][0]
            .get("extras", {})
            .get("mh", {})
            .get("uv_tile_offset", {})
            .get("body", [0, 0])
        )
        skeleton = _skeleton(document, binary)
        base_document, base_binary = read_glb(base_glb.read_bytes())
        base = _primitive(base_document, base_binary, base_document["meshes"][0]["primitives"][0])
        if len(base["positions"]) != len(body["positions"]):
            raise OutfitError(
                f"{base_glb.name} has {len(base['positions'])} vertices, the web body "
                f"{len(body['positions'])}"
            )
        order, error = match_by_uv(body["uvs"] - np.asarray(offset, dtype=np.float64), base["uvs"])
        base_positions = np.empty_like(body["positions"])
        base_positions[order] = base["positions"]
        displacement = np.linalg.norm(body["positions"] - base_positions, axis=1)
        if np.median(displacement) > 0.15:
            raise OutfitError(f"{base_glb.name}: bodies differ by {np.median(displacement):.2f} m")
        boundary = open_edge_vertices(body["positions"], body["triangles"])
        return cls(
            gender=gender,
            positions=body["positions"],
            normals=_unit(body["normals"]),
            triangles=body["triangles"],
            base_positions=base_positions,
            joints=body["joints"][:, :MAX_INFLUENCES],
            weights=body["weights"][:, :MAX_INFLUENCES],
            morphs=morphs,
            skeleton=skeleton,
            boundary=boundary,
            match_error=error,
        )


def _skeleton(document: dict[str, Any], binary: bytes) -> Skeleton:
    skin = document["skins"][0]
    joints = list(skin["joints"])
    nodes = document["nodes"]
    parent_of_node = {
        child: index for index, node in enumerate(nodes) for child in node.get("children", [])
    }
    position = {node: i for i, node in enumerate(joints)}
    parents = np.array(
        [position.get(parent_of_node.get(node, -1), -1) for node in joints], dtype=np.int64
    )
    translations = np.array([nodes[n].get("translation", [0, 0, 0]) for n in joints], dtype=float)
    rotations = np.array([nodes[n].get("rotation", [0, 0, 0, 1]) for n in joints], dtype=float)
    scales = np.array([nodes[n].get("scale", [1, 1, 1]) for n in joints], dtype=float)
    matrices = accessor_values(document, binary, skin["inverseBindMatrices"]).reshape(-1, 4, 4)
    inverse_binds = np.transpose(matrices, (0, 2, 1))  # glTF stores column-major
    return Skeleton(
        names=tuple(str(nodes[n].get("name", f"joint{n}")) for n in joints),
        parents=parents,
        translations=translations,
        rotations=rotations,
        scales=scales,
        inverse_binds=inverse_binds,
    )


def match_by_uv(reference_uvs: F64, other_uvs: F64, tolerance: float = 1e-4) -> tuple[I64, float]:
    """Index into `reference_uvs` for every `other_uvs` row (a bijection), and the largest
    UV distance. Raises when the layouts do not correspond one to one."""
    distance, order = cKDTree(reference_uvs).query(other_uvs)
    if distance.max() > tolerance:
        raise OutfitError(f"UV layouts differ (up to {distance.max():.2e})")
    if len(np.unique(order)) != len(order):
        raise OutfitError("UV correspondence is not one to one")
    return order.astype(np.int64), float(distance.max())


def _unit(vectors: F64) -> F64:
    length = np.linalg.norm(vectors, axis=-1, keepdims=True)
    return vectors / np.where(length > 1e-12, length, 1.0)


# ---------------------------------------------------------------------------- garment


@dataclass
class GarmentPart:
    material: str  # Unreal material instance name (the GLB's material name)
    positions: F64
    normals: F64
    uvs: F64
    triangles: I64


@dataclass
class Garment:
    parts: list[GarmentPart]
    dropped_primitives: list[str] = field(default_factory=list)
    caps: int = 0
    cap_triangles: int = 0


def open_edge_vertices(positions: F64, triangles: I64) -> Bool:
    """Vertices on edges used by one triangle once split vertices are welded."""
    welded = weld(positions)
    tri = welded[triangles]
    edges = np.sort(np.concatenate([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]]), axis=1)
    unique, counts = np.unique(edges, axis=0, return_counts=True)
    open_welded = np.zeros(int(welded.max(initial=-1)) + 1, dtype=bool)
    open_welded[unique[counts == 1].ravel()] = True
    return open_welded[welded]


def weld(positions: F64) -> I64:
    """Welded vertex id of every vertex (split vertices at UV/normal seams share one)."""
    _, inverse = np.unique(np.round(positions, WELD_DECIMALS), axis=0, return_inverse=True)
    return inverse.reshape(-1).astype(np.int64)


def find_caps(positions: F64, triangles: I64, body: "BodyFit | None" = None) -> tuple[Bool, int]:
    """Triangles of the fans Unreal closes garment openings with, and the number of fans.

    A cap is a full fan of at least CAP_MIN_FAN triangles around a hub vertex whose rim is
    one closed loop, every rim edge shared with exactly one triangle outside the fan, the
    hub near the rim's centre (a dome pole sticks out of its rim instead). Without a body
    the rim must be at least CAP_MIN_RADIUS across; with the outfit-base `body` the body
    must run through the fan instead (`_body_crosses`), so flat fans lying on the
    garment's surface (patches, pocket corners) stay."""
    welded = weld(positions)
    tri = welded[triangles]
    count = int(welded.max(initial=-1)) + 1
    valence = np.bincount(tri.ravel(), minlength=count)
    edges = np.sort(np.concatenate([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]]), axis=1)
    keys = edges[:, 0] * count + edges[:, 1]
    unique, edge_count = np.unique(keys, return_counts=True)
    use = dict(zip(unique.tolist(), edge_count.tolist(), strict=True))
    welded_positions = np.zeros((count, 3))
    welded_positions[welded] = positions
    drop = np.zeros(len(triangles), dtype=bool)
    fans = 0
    candidates: list[tuple[int, I64, float]] = []
    order = np.argsort(tri.ravel(), kind="stable")
    sorted_vertices = tri.ravel()[order]
    for hub in np.flatnonzero(valence >= CAP_MIN_FAN):
        start, stop = np.searchsorted(sorted_vertices, [hub, hub + 1])
        fan = np.unique(order[start:stop] // 3)
        rim_edges = []
        for t in fan:
            others = [v for v in tri[t] if v != hub]
            if len(others) != 2:
                break
            rim_edges.append(tuple(sorted(others)))
        else:
            rim = np.unique(np.array(rim_edges).ravel())
            degree = np.bincount(
                np.searchsorted(rim, np.array(rim_edges).ravel()), minlength=len(rim)
            )
            if len(rim) != len(fan) or np.any(degree != 2):
                continue
            if any(use.get(a * count + b, 0) != 2 for a, b in rim_edges):
                continue
            if not _single_loop(rim_edges):
                continue
            ring = welded_positions[rim]
            centre = ring.mean(axis=0)
            radius = float(np.linalg.norm(ring - centre, axis=1).mean())
            offset = float(np.linalg.norm(welded_positions[hub] - centre))
            if offset > CAP_MAX_HUB_OFFSET * radius:
                continue
            if body is None and radius < CAP_MIN_RADIUS:
                continue
            candidates.append((int(hub), fan, radius))
    if body is not None and candidates:
        candidates = [
            c for c in candidates if _body_crosses(welded_positions, tri, c[0], c[1], c[2], body)
        ]
    for _, fan, _ in candidates:
        drop[fan] = True
        fans += 1
    return drop, fans


def _body_crosses(
    positions: F64, triangles: I64, hub: int, fan: I64, radius: float, body: "BodyFit"
) -> bool:
    """True when the fan closes an opening the outfit-base body runs through, rather than
    lying on the garment like a patch. Any of:

    - the hub is over 1 cm inside the body away from the neck seam (Unreal also leaves
      small discs inside limbs);
    - the rim is at least 2.5 cm across and the skin within that radius of the hub is
      mostly at right angles to the disc (a limb or the torso through a cuff, hem or waist);
    - the disc is level, at least 4 cm across and over the body's neck seam (the head runs
      through collars)."""
    corners = positions[triangles[fan]]
    disc = np.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0]).sum(axis=0)
    length = float(np.linalg.norm(disc))
    if length < 1e-12:
        return False
    disc /= length
    centre = positions[hub][None]
    _, signed, triangle, _, _ = _signed_distance(
        centre, body.base_positions, body.base_normals, body.triangles
    )
    # Above the open neck the closest skin is the seam and "inside" means nothing.
    at_seam = bool(body.boundary[body.triangles[triangle[0]]].any())
    if not at_seam and float(signed[0]) < -CAP_INSIDE_DEPTH:
        return True
    if radius < CAP_CROSS_MIN_RADIUS:
        return False
    near = body.base_tree.query_ball_point(positions[hub], radius)
    if len(near) >= CAP_MIN_BODY_VERTICES:
        alignment = np.abs(body.base_normals[near] @ disc)
        if float(np.median(alignment)) < CAP_MAX_ALIGNMENT:
            return True
    if radius >= CAP_SEAM_MIN_RADIUS and abs(float(disc[1])) > CAP_LEVEL and body.boundary.any():
        seam = body.base_positions[body.boundary]
        if float(np.linalg.norm(seam - centre, axis=1).min()) < radius + CAP_SEAM_REACH:
            return True
    return False


def _single_loop(edges: Sequence[tuple[int, int]]) -> bool:
    neighbours: dict[int, list[int]] = {}
    for a, b in edges:
        neighbours.setdefault(a, []).append(b)
        neighbours.setdefault(b, []).append(a)
    start = edges[0][0]
    previous, current, steps = -1, start, 0
    while True:
        following = [v for v in neighbours[current] if v != previous]
        if not following:
            return False
        previous, current = current, following[0]
        steps += 1
        if current == start:
            return steps == len(neighbours)
        if steps > len(neighbours):
            return False


def _repair_normals(normals: F64, positions: F64, triangles: I64) -> F64:
    """Unit normals; zero-length ones (Unreal exports a few) take the geometric normal."""
    length = np.linalg.norm(normals, axis=1)
    broken = length < 0.5
    if broken.any():
        geometric = vertex_normals(positions, triangles)
        normals = normals.copy()
        normals[broken] = geometric[broken]
        still = np.linalg.norm(normals, axis=1) < 0.5
        normals[still] = [0.0, 1.0, 0.0]
    return _unit(normals)


def load_garment(path: Path, body: "BodyFit | None" = None) -> Garment:
    """The garment's primitives merged per material, without caps or unused vertices.
    Primitives with Unreal's missing-material placeholder are dropped."""
    document, binary = read_glb(path.read_bytes())
    materials = [m.get("name", f"material{i}") for i, m in enumerate(document.get("materials", []))]
    grouped: dict[str, list[dict[str, Any]]] = {}
    dropped = []
    for primitive in document["meshes"][0]["primitives"]:
        name = materials[primitive["material"]] if "material" in primitive else "default"
        data = _primitive(document, binary, primitive)
        if name == WORLD_GRID:
            dropped.append(f"{name} ({len(data['positions'])} vertices)")
            continue
        grouped.setdefault(name, []).append(data)
    garment = Garment(parts=[], dropped_primitives=dropped)
    for name, pieces in grouped.items():
        offsets = np.cumsum([0] + [len(p["positions"]) for p in pieces])
        positions = np.concatenate([p["positions"] for p in pieces])
        triangles = np.concatenate(
            [p["triangles"] + o for p, o in zip(pieces, offsets, strict=False)]
        )
        normals = np.concatenate([p.get("normals", np.zeros_like(p["positions"])) for p in pieces])
        uvs = np.concatenate([p.get("uvs", np.zeros((len(p["positions"]), 2))) for p in pieces])
        drop, fans = find_caps(positions, triangles, body)
        garment.caps += fans
        garment.cap_triangles += int(drop.sum())
        triangles = triangles[~drop]
        used = np.unique(triangles)
        remap = np.full(len(positions), -1, dtype=np.int64)
        remap[used] = np.arange(len(used))
        kept_positions, kept_triangles = positions[used], remap[triangles]
        garment.parts.append(
            GarmentPart(
                material=name,
                positions=kept_positions,
                normals=_repair_normals(normals[used], kept_positions, kept_triangles),
                uvs=uvs[used],
                triangles=kept_triangles,
            )
        )
    if not garment.parts:
        raise OutfitError(f"{path.name}: no garment geometry")
    return garment


def pack_udim_parts(
    unit: "OutfitUnit", garment: Garment, log: Callable[[str], None] = lambda _: None
) -> dict[str, AtlasLayout]:
    """Move the UVs of every UDIM part (a Khaos material whose triangles use tiles past
    1001) into an atlas of those tiles, splitting vertices shared by two tiles; returns the
    atlas layout by material. Other parts are left as they are."""
    materials = unit.materials()
    textures = unit.info.get("textures", {})
    layouts: dict[str, AtlasLayout] = {}
    for part in garment.parts:
        material = materials.get(part.material)
        if material is None or not is_khaos(material) or not is_udim_material(material, textures):
            continue
        tiles = sorted(set(triangle_tiles(part.uvs, part.triangles).tolist()))
        if tiles == [1001]:
            continue  # the baked GLB covers it
        layout = plan_atlas(tiles)
        remapped = remap_uvs(part.uvs, part.triangles, layout)
        part.positions = part.positions[remapped.source]
        part.normals = part.normals[remapped.source]
        part.uvs = remapped.uvs
        part.triangles = remapped.triangles
        layouts[part.material] = layout
        log(
            f"        udim {part.material}: tiles {tiles} -> {layout.width}x{layout.height} "
            f"atlas ({layout.cell} px cells), {remapped.split} vertices split"
        )
    return layouts


# ---------------------------------------------------------------------------- transfer


@dataclass(frozen=True, eq=False)
class Transfer:
    """Body-vertex weights of every garment vertex (rows sum to 1) and its relation to the
    base body: closest-point distance and signed distance along the skin normal."""

    matrix: csr_matrix  # (N, V)
    distance: F64
    signed: F64


def smoothstep(x: F64) -> F64:
    t = np.clip(x, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _signed_distance(
    points: F64, surface: F64, normals: F64, triangles: I64
) -> tuple[F64, F64, I64, F64, F64]:
    """(distance, signed distance, triangle, barycentrics, interpolated unit normal)."""
    triangle, bary, distance = closest_triangles(points, surface, triangles, candidates=16)
    corners = triangles[triangle]
    closest = np.einsum("nk,nkj->nj", bary, surface[corners])
    normal = _unit(np.einsum("nk,nkj->nj", bary, normals[corners]))
    signed = np.einsum("ij,ij->i", points - closest, normal)
    return distance, signed, triangle, bary, normal


def build_transfer(points: F64, body: BodyFit) -> Transfer:
    """Rows of body-vertex weights for garment `points` in the base body's space."""
    distance, signed, triangle, bary, _ = _signed_distance(
        points, body.base_positions, body.base_normals, body.triangles
    )
    count = len(points)
    k = min(KERNEL_NEIGHBOURS, len(body.base_positions))
    radii, neighbours = body.base_tree.query(points, k=k)
    radii = radii.reshape(count, k)
    neighbours = neighbours.reshape(count, k)
    sigma = np.maximum(KERNEL_SIGMA_MIN, KERNEL_SIGMA_SCALE * distance)[:, None]
    kernel = np.exp(-(radii**2 - radii[:, :1] ** 2) / (2.0 * sigma**2))
    kernel /= kernel.sum(axis=1, keepdims=True)
    exact = smoothstep(1.0 - distance / EXACT_RADIUS)[:, None]
    rows = np.concatenate([np.repeat(np.arange(count), 3), np.repeat(np.arange(count), k)])
    cols = np.concatenate([body.triangles[triangle].ravel(), neighbours.ravel()])
    values = np.concatenate([(exact * bary).ravel(), ((1.0 - exact) * kernel).ravel()])
    matrix = coo_matrix((values, (rows, cols)), shape=(count, len(body.base_positions))).tocsr()
    matrix.sum_duplicates()
    return Transfer(matrix=matrix, distance=distance, signed=signed)


def rotate_between(vectors: F64, before: F64, after: F64) -> F64:
    """Rotate `vectors` (N, 3) by the smallest rotation taking unit `before` to `after`."""
    axis = np.cross(before, after)
    sine = np.linalg.norm(axis, axis=1, keepdims=True)
    cosine = np.einsum("ij,ij->i", before, after)[:, None]
    k = axis / np.where(sine > 1e-12, sine, 1.0)
    rotated = (
        vectors * cosine
        + np.cross(k, vectors) * sine
        + k * np.einsum("ij,ij->i", k, vectors)[:, None] * (1.0 - cosine)
    )
    return np.where(sine > 1e-12, rotated, vectors)


@dataclass
class FittedPart:
    material: str
    positions: F64
    normals: F64
    uvs: F64
    triangles: I64
    joints: I64  # (N, 4) into the body skeleton
    weights: F64  # (N, 4)
    morphs: dict[str, F64]


@dataclass
class Fit:
    parts: list[FittedPart]
    stats: dict[str, Any]


def _blend_skin(matrix: csr_matrix, body: BodyFit) -> tuple[I64, F64]:
    joint_count = len(body.skeleton.names)
    rows = np.repeat(np.arange(len(body.joints)), body.joints.shape[1])
    dense = coo_matrix(
        (body.weights.ravel(), (rows, body.joints.ravel())),
        shape=(len(body.joints), joint_count),
    ).tocsr()
    blended = (matrix @ dense).tocsr()
    blended.eliminate_zeros()
    lengths = np.diff(blended.indptr)
    width = int(lengths.max(initial=1))
    rows = np.repeat(np.arange(blended.shape[0]), lengths)
    rank = np.arange(blended.nnz) - np.repeat(blended.indptr[:-1], lengths)
    joints = np.zeros((blended.shape[0], width), dtype=np.int32)
    weights = np.zeros((blended.shape[0], width), dtype=np.float32)
    joints[rows, rank] = blended.indices
    weights[rows, rank] = blended.data
    identity = np.arange(joint_count, dtype=np.int32)
    merged_joints, merged_weights, _ = merge_influences(
        joints, weights, identity, limit=MAX_INFLUENCES
    )
    return merged_joints.astype(np.int64), merged_weights.astype(np.float64)


def _closest_points(surface: F64, triangles: I64, triangle: I64, bary: F64) -> F64:
    return np.einsum("nk,nkj->nj", bary, surface[triangles[triangle]])


def stack_push(over: F64, need: F64, movable: Bool, reach: float = LAYER_REACH) -> F64:
    """How far to push every vertex out: the largest positive `need` among the `movable`
    vertices whose skin points (`over`, the closest point on the skin) lie within `reach`
    of its own; zero for the others.

    Pushing each vertex by its own need moves every layer of a garment with thickness to
    the same clearance surface: the inner layer meets the outer one (or ends up in front
    of it) and its two-sided inside shows through. Vertices stacked over the same skin take
    one push, so the gaps between layers hold."""
    push = np.zeros(len(need))
    sources = np.flatnonzero(movable & (need > 0.0))
    if not len(sources):
        return push
    targets = np.flatnonzero(movable)
    pairs = cKDTree(over[targets]).sparse_distance_matrix(
        cKDTree(over[sources]), reach, output_type="ndarray"
    )
    np.maximum.at(push, targets[pairs["i"]], need[sources[pairs["j"]]])
    push[sources] = np.maximum(push[sources], need[sources])
    return push


def fit_garment(garment: Garment, body: BodyFit) -> Fit:
    """Re-express the garment in the web body's bind space (positions, normals, skin,
    slider morphs); see the module docstring."""
    points = np.concatenate([p.positions for p in garment.parts])
    transfer = build_transfer(points, body)
    moved = points + transfer.matrix @ body.displacement
    _, signed, triangle, bary, normal = _signed_distance(
        moved, body.positions, body.normals, body.triangles
    )
    near_seam = body.boundary[body.triangles[triangle]].any(axis=1)
    over = _closest_points(body.positions, body.triangles, triangle, bary)
    movable = (transfer.signed > -PUSH_DEPTH_LIMIT) & ~near_seam
    amount = stack_push(over, CLEARANCE - signed, movable)
    push = amount > 0.0
    moved[push] += amount[push][:, None] * normal[push]
    joints, weights = _blend_skin(transfer.matrix, body)
    morphs = {name: transfer.matrix @ delta for name, delta in body.morphs.items()}
    morphs, cleared = clear_morphs(moved, morphs, body, outside=push | (signed > 0.0))
    parts = []
    start = 0
    for part in garment.parts:
        stop = start + len(part.positions)
        before = vertex_normals(part.positions, part.triangles)
        after = vertex_normals(moved[start:stop], part.triangles)
        normals = _unit(rotate_between(part.normals, before, after))
        parts.append(
            FittedPart(
                material=part.material,
                positions=moved[start:stop],
                normals=normals,
                uvs=part.uvs,
                triangles=part.triangles,
                joints=joints[start:stop],
                weights=weights[start:stop],
                morphs={name: delta[start:stop] for name, delta in morphs.items()},
            )
        )
        start = stop
    shift = np.linalg.norm(moved - points, axis=1)
    stats = {
        "vertices": len(points),
        "triangles": int(sum(len(p.triangles) for p in garment.parts)),
        "caps_removed": garment.caps,
        "dropped_primitives": garment.dropped_primitives,
        "shift_mm": {"median": _mm(np.median(shift)), "max": _mm(shift.max())},
        "skin_distance_mm": {
            "median": _mm(np.median(transfer.distance)),
            "p95": _mm(np.percentile(transfer.distance, 95)),
        },
        "pushed_out": int(push.sum()),
        "morph_cleared": cleared,
        "inside_after_fit": int(
            np.sum((signed < -0.001) & (transfer.signed > -PUSH_DEPTH_LIMIT) & ~push)
        ),
        "uv_match_error": body.match_error,
    }
    return Fit(parts=parts, stats=stats)


def clear_morphs(
    positions: F64, morphs: Mapping[str, F64], body: BodyFit, *, outside: Bool
) -> tuple[dict[str, F64], dict[str, int]]:
    """Keep the garment outside the skin at every slider end.

    A garment vertex's morph is the weighted mean of the body deltas around it, over a
    wider patch the looser the cloth. At a slider end it can therefore move further in
    than the skin right under it, and the body shows through. Each morph is checked at its
    end: vertices `outside` the skin at rest that end closer than CLEARANCE to the morphed
    skin are pushed back out along its normal, layers stacked over the same skin by one
    amount (`stack_push`). Returns the morphs and the vertices fixed per morph.
    """
    cleared: dict[str, F64] = {}
    counts: dict[str, int] = {}
    for name, delta in morphs.items():
        skin = body.positions + body.morphs[name]
        normals = vertex_normals(skin, body.triangles)
        distance, signed, triangle, bary, normal = _signed_distance(
            positions + delta, skin, normals, body.triangles
        )
        # By the neck seam the closest point may lie on the open edge, where the signed
        # distance means nothing; trust it there only when the offset is along the normal
        # (collars sit right over that edge and sink most).
        near_seam = body.boundary[body.triangles[triangle]].any(axis=1)
        on_face = np.abs(signed) >= FACE_ON_SHARE * distance
        over = _closest_points(skin, body.triangles, triangle, bary)
        amount = stack_push(over, CLEARANCE - signed, outside & (~near_seam | on_face))
        fix = amount > 0.0
        fixed = delta.copy()
        fixed[fix] += amount[fix][:, None] * normal[fix]
        cleared[name] = fixed
        counts[name] = int(fix.sum())
    return cleared, counts


def _mm(value: float) -> float:
    return round(float(value) * 1000.0, 2)


# ---------------------------------------------------------------------------- body_hide


class RayCaster:
    """Ray/triangle queries against a mesh: candidates from a KD-tree of triangle centroids
    sampled along each ray in steps, rays retired at their first hit."""

    def __init__(self, vertices: F64, triangles: I64, *, step: float = 0.01) -> None:
        self.a, self.b, self.c = (vertices[triangles[:, k]] for k in range(3))
        centroids = (self.a + self.b + self.c) / 3.0
        radius = np.max(
            np.stack([np.linalg.norm(x - centroids, axis=1) for x in (self.a, self.b, self.c)]),
            axis=0,
        )
        limit = float(np.percentile(radius, 99.5)) if len(radius) else 0.0
        self.big = np.flatnonzero(radius > limit)
        self.step = step
        self.reach = step * 0.5 + float(radius[radius <= limit].max(initial=0.0))
        self.tree = cKDTree(centroids)
        self.count = len(triangles)

    def blocked(
        self, origins: F64, directions: F64, max_t: F64 | float, *, min_t: float = 0.0
    ) -> Bool:
        """True for every ray that hits a triangle at a distance in (min_t, max_t]."""
        n = len(origins)
        limit = np.broadcast_to(np.asarray(max_t, dtype=np.float64), (n,))
        hit = np.zeros(n, dtype=bool)
        if n == 0 or self.count == 0:
            return hit
        steps = int(np.ceil(float(limit.max()) / self.step)) + 1
        k = min(48, self.count)
        for s in range(steps):
            active = np.flatnonzero(~hit & (limit > s * self.step - self.step))
            if len(active) == 0:
                break
            t = np.minimum((s + 0.5) * self.step, limit[active])
            samples = origins[active] + directions[active] * t[:, None]
            _, index = self.tree.query(samples, k=k, distance_upper_bound=self.reach)
            index = index.reshape(len(active), k)
            rows, cols = np.nonzero(index < self.count)
            rays, tris = active[rows], index[rows, cols]
            if len(self.big):
                rays = np.concatenate([rays, np.repeat(active, len(self.big))])
                tris = np.concatenate([tris, np.tile(self.big, len(active))])
            for begin in range(0, len(rays), 2_000_000):
                r = rays[begin : begin + 2_000_000]
                q = tris[begin : begin + 2_000_000]
                distance = _moller_trumbore(
                    origins[r], directions[r], self.a[q], self.b[q], self.c[q]
                )
                ok = (distance > min_t) & (distance <= limit[r])
                hit[r[ok]] = True
        return hit


def _moller_trumbore(origin: F64, direction: F64, a: F64, b: F64, c: F64) -> F64:
    e1, e2 = b - a, c - a
    p = np.cross(direction, e2)
    det = np.einsum("ij,ij->i", e1, p)
    valid = np.abs(det) > 1e-12
    inverse = np.where(valid, 1.0 / np.where(valid, det, 1.0), 0.0)
    s = origin - a
    u = np.einsum("ij,ij->i", s, p) * inverse
    q = np.cross(s, e1)
    v = np.einsum("ij,ij->i", direction, q) * inverse
    t = np.einsum("ij,ij->i", e2, q) * inverse
    # A small tolerance so rays through a shared edge or vertex hit one of its triangles.
    inside = valid & (u >= -1e-9) & (v >= -1e-9) & (u + v <= 1.0 + 1e-9)
    return np.where(inside, t, np.inf)


def _tilted(normals: F64, degrees: float, count: int) -> list[F64]:
    """`count` unit directions tilted by `degrees` from each normal, evenly around it."""
    helper = np.where(np.abs(normals[:, 1:2]) < 0.9, [[0.0, 1.0, 0.0]], [[1.0, 0.0, 0.0]])
    u = _unit(np.cross(normals, helper))
    v = np.cross(normals, u)
    tilt = np.radians(degrees)
    out = []
    for k in range(count):
        angle = 2.0 * np.pi * k / count
        side = np.cos(angle) * u + np.sin(angle) * v
        out.append(_unit(np.cos(tilt) * normals + np.sin(tilt) * side))
    return out


def opening_vertices(
    vertices: F64, triangles: I64, body: BodyFit, garment: RayCaster
) -> tuple[F64, F64]:
    """Positions of the garment's exposed opening edges and their distance from the skin.

    Open edges are edges of one triangle after welding split vertices. An open edge is not
    an exposed opening when the garment lies between it and the skin (pocket or collar
    edges lying on the garment) or outside it (a shirt hem over the waistband)."""
    welded = weld(vertices)
    tri = welded[triangles]
    count = int(welded.max(initial=-1)) + 1
    edges = np.sort(np.concatenate([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]]), axis=1)
    unique, counts = np.unique(edges, axis=0, return_counts=True)
    rim = np.unique(unique[counts == 1].ravel())
    if len(rim) == 0:
        return np.zeros((0, 3)), np.zeros(0)
    representative = np.zeros(count, dtype=np.int64)
    representative[welded] = np.arange(len(vertices))
    points = vertices[representative[rim]]
    _, signed, _, _, normal = _signed_distance(points, body.positions, body.normals, body.triangles)
    gap = np.maximum(signed, 0.0)
    # Folded hems and ribs put the garment's own other layer a few millimetres outside the
    # edge, so only garment further out than LAYER_THICKNESS covers an opening from outside.
    inside = garment.blocked(points, -normal, np.maximum(gap - 0.0005, 0.0), min_t=0.0005)
    outside = garment.blocked(points, normal, HIDE_DISTANCE, min_t=LAYER_THICKNESS)
    exposed = ~inside & ~outside
    return points[exposed], gap[exposed]


def _visibility_directions(normals: F64) -> list[F64]:
    directions = [normals]
    for degrees, count in HIDE_RAY_RINGS:
        directions += _tilted(normals, degrees, count)
    return directions


def body_hide(fit: Fit, body: BodyFit) -> tuple[Bool, dict[str, Any]]:
    """Body vertices the garment covers closely enough to hide (see the module docstring)."""
    vertices = np.concatenate([p.positions for p in fit.parts])
    offsets = np.cumsum([0] + [len(p.positions) for p in fit.parts])
    triangles = np.concatenate([p.triangles + o for p, o in zip(fit.parts, offsets, strict=False)])
    _, _, garment_distance = closest_triangles(body.positions, vertices, triangles, candidates=12)
    candidates = np.flatnonzero(garment_distance < HIDE_DISTANCE)
    hidden = np.zeros(len(body.positions), dtype=bool)
    if len(candidates) == 0:
        return hidden, {"hidden": 0, "candidates": 0, "covered": 0, "opening_vertices": 0}
    garment = RayCaster(vertices, triangles)
    # The body occludes too: a ray that runs into the skin (armpit, crotch) cannot see out.
    scene = RayCaster(
        np.concatenate([vertices, body.positions]),
        np.concatenate([triangles, body.triangles + len(vertices)]),
    )
    normals = body.normals[candidates]
    origins = body.positions[candidates] + normals * 0.001
    covered = np.ones(len(candidates), dtype=bool)
    for direction in _visibility_directions(normals):
        todo = np.flatnonzero(covered)
        if len(todo) == 0:
            break
        seen = scene.blocked(origins[todo], direction[todo], HIDE_DISTANCE, min_t=0.001)
        covered[todo[~seen]] = False
    openings, gaps = opening_vertices(vertices, triangles, body, garment)
    near_opening = np.zeros(len(candidates), dtype=bool)
    if len(openings):
        k = min(OPEN_NEIGHBOURS, len(openings))
        distance, index = cKDTree(openings).query(body.positions[candidates], k=k)
        distance = distance.reshape(len(candidates), k)
        index = index.reshape(len(candidates), k)
        margin = OPEN_MARGIN + OPEN_GAP_FACTOR * gaps[index]
        near_opening = np.any(distance < margin, axis=1)
    hidden[candidates[covered & ~near_opening]] = True
    stats = {
        "hidden": int(hidden.sum()),
        "candidates": len(candidates),
        "covered": int(covered.sum()),
        "opening_vertices": len(openings),
    }
    return hidden, stats


def encode_bitset(mask: Bool) -> str:
    """Base64 bitset, bit v of byte v >> 3, least significant bit first."""
    return base64.b64encode(np.packbits(mask.astype(np.uint8), bitorder="little").tobytes()).decode(
        "ascii"
    )


REGION_RULES = (
    ("feet", re.compile(r"^(foot|ball|.*toe)", re.I)),
    ("calves", re.compile(r"^calf", re.I)),
    ("thighs", re.compile(r"^thigh", re.I)),
    ("hips", re.compile(r"^pelvis", re.I)),
    ("hands", re.compile(r"^(hand|thumb|index|middle|ring|pinky)", re.I)),
    ("forearms", re.compile(r"^lowerarm", re.I)),
    ("upperArms", re.compile(r"^upperarm", re.I)),
    ("neck", re.compile(r"^(neck|head)", re.I)),
    ("torso", re.compile(r"^(spine|clavicle)", re.I)),
)
REGION_HIDE_SHARE = 0.6
CLOSED_TOE_SHARE = 0.4  # share of the toes a shoe hides by itself to count as closed
TOE_JOINT = re.compile(r"^(ball|.*toe)", re.I)


def body_regions(body: BodyFit) -> list[str | None]:
    """Coarse region of every body vertex, from its strongest joint."""
    names = body.skeleton.names
    strongest = body.joints[np.arange(len(body.joints)), np.argmax(body.weights, axis=1)]
    lookup: dict[int, str | None] = {}
    for joint in np.unique(strongest):
        name = names[int(joint)]
        lookup[int(joint)] = next(
            (region for region, rule in REGION_RULES if rule.search(name)), None
        )
    return [lookup[int(j)] for j in strongest]


def toe_vertices(body: BodyFit) -> Bool:
    """Body vertices whose strongest joint is a toe (or the ball of the foot)."""
    strongest = body.joints[np.arange(len(body.joints)), np.argmax(body.weights, axis=1)]
    toes = np.array([bool(TOE_JOINT.search(name)) for name in body.skeleton.names])
    return toes[strongest]


def hide_closed_toes(hidden: Bool, body: BodyFit) -> tuple[Bool, bool]:
    """Hide every toe vertex when the garment already hides most of them (a closed shoe);
    sandals and bare feet keep their toes. Returns the mask and whether it grew."""
    toes = toe_vertices(body)
    if not toes.any() or hidden[toes].mean() < CLOSED_TOE_SHARE:
        return hidden, False
    return hidden | toes, True


def region_coverage(hidden: Bool, regions: Sequence[str | None]) -> dict[str, float]:
    totals: dict[str, int] = {}
    covered: dict[str, int] = {}
    for flag, region in zip(hidden.tolist(), regions, strict=True):
        if region is None:
            continue
        totals[region] = totals.get(region, 0) + 1
        covered[region] = covered.get(region, 0) + int(flag)
    return {region: round(covered[region] / totals[region], 3) for region in sorted(totals)}


CATEGORY_OVERRIDES = {"DefaultGarment": "full"}


def outfit_category(name: str, coverage: Mapping[str, float]) -> str:
    """top | bottom | shoes | full from what the garment covers (overrides by name): both
    torso and legs well covered is `full`, else the best covered of torso, legs and feet."""
    if name in CATEGORY_OVERRIDES:
        return CATEGORY_OVERRIDES[name]
    torso = max(coverage.get("torso", 0.0), coverage.get("upperArms", 0.0))
    legs = max(coverage.get("thighs", 0.0), coverage.get("hips", 0.0), coverage.get("calves", 0.0))
    feet = coverage.get("feet", 0.0)
    if torso >= 0.4 and legs >= 0.4:
        return "full"
    scores = {"top": torso, "bottom": legs, "shoes": feet}
    return max(scores, key=scores.__getitem__)


# ---------------------------------------------------------------------------- materials


def parse_color(text: object) -> list[float] | None:
    """`(R=0.1,G=0.2,B=0.3,A=1.0)` -> [r, g, b, a] (Unreal linear colour)."""
    if not isinstance(text, str):
        return None
    values = dict(re.findall(r"([RGBA])=(-?[0-9.eE+-]+)", text))
    if not {"R", "G", "B"} <= values.keys():
        return None
    return [float(values["R"]), float(values["G"]), float(values["B"]), float(values.get("A", 1.0))]


def hex_from_linear(color: Sequence[float]) -> str:
    rgb = linear_to_srgb(np.asarray(color[:3], dtype=np.float32))
    return "#" + "".join(f"{int(v):02x}" for v in rgb)


def replace_template_colors(vectors: dict[str, list[float]]) -> list[str]:
    """Colour 2 left at the template blue takes colour 1 (a single-colour garment, as
    the creator shows it); returns the names it replaced."""
    first = vectors.get("diffuse_color_1")
    second = vectors.get("diffuse_color_2")
    if first is None or second is None or hex_from_linear(second) != TEMPLATE_BLUE:
        return []
    vectors["diffuse_color_2"] = list(first)
    return ["diffuse_color_2"]


def master_of(material: Mapping[str, Any]) -> str:
    parents = material.get("parents") or []
    return str(parents[-1]).rsplit(".", 1)[-1] if parents else "?"


def material_key(instance: str, item: str) -> str:
    """Short, gender-independent material name: `MI_WI_OA_techwearOutfit_M_techwear_
    bodyShapeH_MH_Jacket` -> `techwear_MH_Jacket`."""
    key = instance
    for prefix in (f"MI_WI_{item}_", f"MI_{item}_", "MI_"):
        if key.startswith(prefix):
            key = key.removeprefix(prefix)
            break
    key = re.sub(r"^M_", "", key)
    key = re.sub(r"bodyShape[A-Z]+_", "", key)
    return re.sub(r"[^A-Za-z0-9_]", "_", key) or "material"


def _switch(switches: Mapping[str, Any], name: str, default: bool = False) -> bool:
    value = switches.get(name, default)
    return bool(value) if isinstance(value, bool) else default


def fabric_slots(material: Mapping[str, Any]) -> dict[str, tuple[Role, bool]]:
    """Texture slots M_fabric_simpler samples with these static switches: {slot: (role,
    tiling)}. Read from the decoded master graph (see the mapping table in the report)."""
    s = material.get("static_switches", {})
    scalars = material.get("scalars", {})
    slots: dict[str, tuple[Role, bool]] = {
        "normalmap": ("normal", False),
        "AO": ("data", False),
        "Masks": ("data", False),
        "CustomStitch": ("stitch", False),
    }

    def detail_color(prefix: str, switch: str) -> bool:
        overlay = float(scalars.get(f"{prefix}detailColor_txOverlay", 0.0))
        mult = float(scalars.get(f"{prefix}detailColor_txMult", 0.0))
        return _switch(s, switch) or overlay < 1.0 or mult > 0.0

    if detail_color("", "DoDetailColor"):
        slots["DetailTex_Color"] = ("color", True)
    if not _switch(s, "DoSculptDetail"):
        slots["DetailTex_Variation"] = ("data", True)
    if _switch(s, "DoMacroVariation"):
        slots["MacroTex_Variation"] = ("data", True)
    if _switch(s, "DoDetailNormal"):
        slots["detailTex_normal"] = ("normal", True)
    if _switch(s, "MaterialB option"):
        if detail_color("B_", "B_DoDetailColor"):
            slots["B_DetailTex_Color"] = ("color", True)
        if not _switch(s, "B_DoSculptDetail"):
            slots["B_DetailTex_Variation"] = ("data", True)
        if _switch(s, "B_DoMacroVariation"):
            slots["B_MacroTex_Variation"] = ("data", True)
        if _switch(s, "B_DoDetailNormal"):
            slots["B_detailTex_normal"] = ("normal", True)
    if _switch(s, "DoWrinkles"):
        slots["Wrinkle_normal"] = ("normal", True)
    if _switch(s, "DoPill"):
        slots["Pill_n_map"] = ("normal", True)
        slots["Pilling_A"] = ("data", True)
    if _switch(s, "DoMaterialC") and _switch(s, "C_UsePearlyColor"):
        slots["distort_matC_pearly"] = ("color", True)
    return slots


JEANS_SLOTS: dict[str, tuple[Role, bool]] = {
    "Diffuse": ("color", False),
    "Mask": ("data", False),
    "Normals": ("normal", False),
    "AO": ("data", False),
    "memory_fold_n": ("normal", True),
    "detail_diffuse": ("data", True),
    "detail_normal": ("normal", True),
    "tileable_fuzz_n": ("normal", True),
    "tileable_weave_2": ("normal", True),
}


@dataclass(frozen=True, eq=False)
class TextureSource:
    path: Path  # the file, or a name for `pixels` (its stem names the output)
    srgb: bool
    sha256: str
    size: int
    pixels: NDArray[np.uint8] | None = None  # decoded already (maps taken from a GLB)


def _texture_source(
    unit: OutfitUnit, reference: str, hashes: Mapping[str, str]
) -> TextureSource | None:
    info = unit.info.get("textures", {}).get(reference)
    if not isinstance(info, dict) or "file" not in info:
        return None
    path = unit.folder / "textures" / str(info["file"])
    if not path.is_file():
        return None
    size = info.get("size", [0])
    return TextureSource(
        path=path,
        srgb=bool(info.get("srgb", False)),
        sha256=hashes.get(path.name, ""),
        size=int(size[0]) if isinstance(size, list) and size else 0,
    )


def _load_pixels(path: Path) -> NDArray[np.uint8]:
    Image.MAX_IMAGE_PIXELS = None
    with Image.open(path) as image:
        if image.mode in ("L", "I;16", "I", "F", "P", "1"):
            return np.asarray(image.convert("L"))
        if image.mode in ("LA",):
            return np.asarray(image.convert("RGBA"))
        mode = "RGBA" if "A" in image.getbands() else "RGB"
        return np.asarray(image.convert(mode))


def _resize(pixels: NDArray[np.uint8], size: int, role: Role, srgb: bool) -> NDArray[np.uint8]:
    """Area-filter a square map down to `size` (colour in linear light, normals as unit
    vectors, stitch masks by maximum so thin seams keep their strength)."""
    height = pixels.shape[0]
    if height <= size:
        return pixels
    channels = pixels[..., None] if pixels.ndim == 2 else pixels
    if role == "stitch" and height % size == 0:
        factor = height // size
        shaped = channels.reshape(size, factor, size, factor, channels.shape[2])
        out = shaped.max(axis=(1, 3))
        return out[..., 0] if pixels.ndim == 2 else out
    values = channels.astype(np.float32) / 255.0
    if role == "normal":
        values[..., :3] = values[..., :3] * 2.0 - 1.0
    elif srgb:
        values[..., :3] = srgb_to_linear(channels[..., :3])
    resized = np.stack(
        [
            np.asarray(Image.fromarray(values[..., c]).resize((size, size), Image.Resampling.BOX))
            for c in range(values.shape[2])
        ],
        axis=-1,
    )
    if role == "normal":
        xyz = _unit(resized[..., :3].astype(np.float64))
        resized[..., :3] = (xyz * 0.5 + 0.5).astype(np.float32)
        out = np.round(np.clip(resized, 0, 1) * 255.0).astype(np.uint8)
    elif srgb:
        out = np.empty(resized.shape, dtype=np.uint8)
        out[..., :3] = linear_to_srgb(resized[..., :3])
        if resized.shape[2] == 4:
            out[..., 3] = np.round(np.clip(resized[..., 3], 0, 1) * 255.0).astype(np.uint8)
    else:
        out = np.round(np.clip(resized, 0, 1) * 255.0).astype(np.uint8)
    return out[..., 0] if pixels.ndim == 2 else out


def _average(pixels: NDArray[np.uint8], srgb: bool) -> list[float]:
    """Mean RGB in the values the material samples (sRGB maps decoded to linear)."""
    channels = pixels if pixels.ndim == 3 else pixels[..., None]
    flat = channels.reshape(-1, channels.shape[2])[:, :3]
    values = srgb_to_linear(flat) if srgb else flat.astype(np.float32) / 255.0
    mean = values.astype(np.float64).mean(axis=0)
    if mean.size == 1:
        mean = np.repeat(mean, 3)
    return [round(float(v), 6) for v in mean]


def _settings(role: Role, srgb: bool, tile: bool) -> Ktx2Settings:
    if role == "normal":
        return TILE_NORMAL if tile else NORMAL
    if role == "stitch":
        return STITCH
    if role == "color" or srgb:
        if tile:
            return TILE_SRGB
        return COLOR if role == "color" else DATA_SRGB
    return TILE_DATA if tile else DATA


@dataclass
class TextureWriter:
    """Writes outfit maps as content-addressed KTX2 files (shared across items/genders)."""

    web_root: Path
    log: Callable[[str], None] = lambda _: None
    written: dict[Path, int] = field(default_factory=dict)

    def write(
        self, source: TextureSource, role: Role, tile: bool, item: str, cap: int | None = None
    ) -> dict[str, Any]:
        """`cap`: largest side kept (default: the tile or item map size; a UDIM atlas keeps
        one item-size cell per tile)."""
        size_cap = cap or (TILE_TEXTURE_SIZE if tile else ITEM_TEXTURE_SIZE)
        srgb = source.srgb and role != "normal"
        settings = _settings(role, srgb, tile)
        origin = source.sha256 or source.path.name
        recipe = f"{TEXTURE_RECIPE}|{origin}|{role}|{size_cap}|{settings.key}"
        digest = hashlib.sha256(recipe.encode()).hexdigest()[:10]
        stem = re.sub(r"[^A-Za-z0-9_.-]", "_", source.path.stem)
        folder = self.web_root / "outfits" / ("shared" if tile else item)
        output = folder / f"{stem}-{digest}.ktx2"
        info: dict[str, Any] = {"srgb": srgb, "tiling": tile}
        pixels = source.pixels if source.pixels is not None else _load_pixels(source.path)
        flat = pixels.reshape(-1, 1 if pixels.ndim == 2 else pixels.shape[2])
        if flat.min(axis=0).tolist() == flat.max(axis=0).tolist():
            value = flat[0].astype(np.float32) / 255.0
            if srgb:
                value[:3] = srgb_to_linear(flat[0][:3])
            channels = value.tolist() if len(value) > 1 else [float(value[0])] * 3
            return {"constant": [round(float(c), 6) for c in channels]}
        coverage = (flat > COVERAGE_LEVEL).mean(axis=0)
        pixels = _resize(pixels, size_cap, role, srgb)
        if role == "normal":
            rgb = pixels[..., :3] if pixels.ndim == 3 else np.repeat(pixels[..., None], 3, axis=2)
            convention, margin = normal_convention(rgb)
            if convention == "directx" or margin < AMBIGUOUS_CONVENTION:
                rgb = flip_green(rgb)
            pixels = rgb
            info["source_convention"] = convention
        elif pixels.ndim == 3 and pixels.shape[2] == 4 and int(pixels[..., 3].min()) == 255:
            pixels = pixels[..., :3]
        if role in ("color", "data") and tile:
            # MF_AvgColorReplace divides detail colour maps by their average (mip 14).
            info["average"] = _average(pixels, srgb)
        if not output.is_file():
            encode_ktx2(np.ascontiguousarray(pixels), output, settings)
            self.log(f"        texture {output.relative_to(self.web_root).as_posix()}")
        self.written[output] = output.stat().st_size
        info["file"] = output.relative_to(self.web_root).as_posix()
        info["size"] = int(pixels.shape[0])
        if pixels.shape[1] != pixels.shape[0]:
            info["width"] = int(pixels.shape[1])
        if role != "normal":
            # Share of texels above 1/4 per channel (source resolution), for parameter use.
            info["coverage"] = [round(float(c), 5) for c in coverage]
        return info


def _scalars(material: Mapping[str, Any]) -> dict[str, float]:
    return {
        str(k): float(v)
        for k, v in material.get("scalars", {}).items()
        if isinstance(v, int | float) and not isinstance(v, bool)
    }


def _vectors(material: Mapping[str, Any]) -> dict[str, list[float]]:
    out = {}
    for k, v in material.get("vectors", {}).items():
        color = parse_color(v)
        if color is not None:
            out[str(k)] = [round(c, 6) for c in color]
    return out


def _switches(material: Mapping[str, Any]) -> dict[str, bool]:
    return {
        str(k).strip(): bool(v)
        for k, v in material.get("static_switches", {}).items()
        if isinstance(v, bool)
    }


def _baked_glb(unit: OutfitUnit) -> Path | None:
    """The baked twin of the unit's garment GLB, when the export wrote one."""
    entry = unit.info.get("meshes", {}).get(unit.glb.stem)
    name = entry.get("baked_glb") if isinstance(entry, dict) else None
    path = unit.folder / str(name) if name else None
    return path if path is not None and path.is_file() else None


def baked_maps(unit: OutfitUnit, instance: str) -> dict[Role, TextureSource]:
    """Maps Unreal baked for one material instance: colour (sRGB), normal, and an ORM map
    packed from the occlusion (R) and metallic/roughness (G, B) textures. Empty when the
    unit has no baked GLB or it has no material of that name."""
    path = _baked_glb(unit)
    if path is None:
        return {}
    document, binary = read_glb(path.read_bytes())
    material = next((m for m in document.get("materials", []) if m.get("name") == instance), None)
    if material is None:
        return {}
    pbr = material.get("pbrMetallicRoughness", {})

    def image(slot: Mapping[str, Any] | None) -> tuple[str, bytes] | None:
        if not slot or "index" not in slot:
            return None
        source = document["images"][document["textures"][slot["index"]]["source"]]
        if "bufferView" not in source:
            return None
        return str(source.get("name", instance)), view_bytes(document, binary, source["bufferView"])

    def decode(data: bytes, mode: str) -> NDArray[np.uint8]:
        Image.MAX_IMAGE_PIXELS = None
        with Image.open(io.BytesIO(data)) as opened:
            return np.asarray(opened.convert(mode))

    def source(name: str, data: bytes, pixels: NDArray[np.uint8], srgb: bool) -> TextureSource:
        digest = hashlib.sha256(data).hexdigest()
        return TextureSource(path.parent / f"{name}.png", srgb, digest, pixels.shape[0], pixels)

    maps: dict[Role, TextureSource] = {}
    color = image(pbr.get("baseColorTexture"))
    if color:
        maps["color"] = source(*color, decode(color[1], "RGB"), srgb=True)
    normal = image(material.get("normalTexture"))
    if normal:
        maps["normal"] = source(*normal, decode(normal[1], "RGB"), srgb=False)
    rough = image(pbr.get("metallicRoughnessTexture"))
    occlusion = image(material.get("occlusionTexture"))
    if not rough and occlusion:
        # Metallic and roughness baked to constants (factors, see baked_factors): the ORM
        # map carries the occlusion, with G and B at 1 so the factors pass through.
        packed = decode(occlusion[1], "RGB").copy()
        packed[..., 1:] = 255
        maps["data"] = source(f"{instance}_ORM", occlusion[1], packed, srgb=False)
    if rough:
        packed = decode(rough[1], "RGB").copy()
        if occlusion:
            occlusion_red = decode(occlusion[1], "RGB")[..., 0]
            if occlusion_red.shape == packed.shape[:2]:
                packed[..., 0] = occlusion_red
            else:
                packed[..., 0] = 255
        else:
            packed[..., 0] = 255
        data = rough[1] + (occlusion[1] if occlusion else b"")
        maps["data"] = source(f"{instance}_ORM", data, packed, srgb=False)
    return maps


GLTF_FACTORS: dict[str, Any] = {
    "baseColorFactor": [1.0, 1.0, 1.0, 1.0],
    "metallicFactor": 1.0,
    "roughnessFactor": 1.0,
}


def baked_factors(unit: OutfitUnit, instance: str) -> dict[str, Any]:
    """The baked material's own PBR factors (glTF defaults where it leaves them out). Unreal
    writes properties that bake to a constant as factors only: e.g. metallic 0 and
    roughness 0.5 with no metallicRoughnessTexture."""
    path = _baked_glb(unit)
    factors = json.loads(json.dumps(GLTF_FACTORS))
    if path is None:
        return factors
    document, _ = read_glb(path.read_bytes())
    material = next((m for m in document.get("materials", []) if m.get("name") == instance), None)
    pbr = (material or {}).get("pbrMetallicRoughness", {})
    for name in factors:
        if name in pbr:
            value = pbr[name]
            factors[name] = [float(v) for v in value] if isinstance(value, list) else float(value)
    return factors


@dataclass
class MaterialResult:
    key: str
    extras: dict[str, Any]
    gltf: dict[str, Any]  # glTF material without texture indices
    textures: dict[str, str]  # glTF role -> file (normal, orm, color)
    params: list[dict[str, Any]]


def convert_material(
    unit: OutfitUnit,
    instance: str,
    writer: TextureWriter,
    hashes: Mapping[str, str],
    atlas: AtlasLayout | None = None,
) -> MaterialResult:
    """extras.mh.materials entry, glTF approximation and manifest params of one part.
    `atlas`: the UDIM tiles the part's UVs were moved into (see `pack_udim_parts`)."""
    materials = unit.materials()
    material = materials.get(instance)
    key = material_key(instance, unit.folder.name.removeprefix("WI_"))
    if material is None:
        extras = {
            "shader": "plain",
            "ue": instance,
            "note": "material instance missing from the export (no parameters, no maps)",
        }
        gltf = {
            "name": key,
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.5, 0.5, 0.5, 1.0],
                "metallicFactor": 0.0,
                "roughnessFactor": 0.8,
            },
            "doubleSided": True,
        }
        return MaterialResult(key, extras, gltf, {}, [])
    master = master_of(material)
    if master in FABRIC_MASTERS:
        slots, shader = fabric_slots(material), "mh-fabric-v1"
    elif master == JEANS:
        slots, shader = dict(JEANS_SLOTS), "mh-jeans-v1"
    else:
        slots, shader = {}, "plain"
    textures: dict[str, Any] = {}
    udim: dict[str, Any] | None = None
    if shader == "plain" and atlas is not None and is_khaos(material):
        # UDIM tiles past 1001: the bake holds tile 1001 only (see outfit_udim).
        built, missing = khaos_atlas(
            unit.folder, material, unit.info.get("textures", {}), atlas, hashes, writer.log
        )
        udim = {**atlas.as_dict(), "recipe": UDIM_RECIPE, "missing_tiles": missing}
        cap = max(atlas.width, atlas.height)
        for role, atlas_map in built.items():
            source = TextureSource(
                unit.folder / f"{key}_udim_{role}.png",
                srgb=role == "color",
                sha256=atlas_map.sha256,
                size=atlas_map.pixels.shape[0],
                pixels=atlas_map.pixels,
            )
            textures[f"udim_{role}"] = writer.write(source, role, False, unit.name, cap=cap)
    baked_glb = _baked_glb(unit) if shader == "plain" and udim is None else None
    baked = baked_maps(unit, instance) if baked_glb else {}
    for role, baked_source in baked.items():
        textures[f"baked_{role}"] = writer.write(baked_source, role, False, unit.name)
    for slot, (role, tile) in slots.items():
        reference = material.get("textures", {}).get(slot)
        if not reference:
            continue
        name = str(reference).rsplit(".", 1)[-1]
        if name in KNOWN_CONSTANTS:
            # Flat engine/Fab maps by name (the techwear "black" map exports as white).
            textures[slot] = {"constant": list(KNOWN_CONSTANTS[name])}
            continue
        source = _texture_source(unit, str(reference), hashes)
        if source is None:
            textures[slot] = {"missing": name}
            continue
        textures[slot] = writer.write(source, role, tile, unit.name)
    scalars, vectors, switches = _scalars(material), _vectors(material), _switches(material)
    replaced = replace_template_colors(vectors)
    extras = {
        "shader": shader,
        "ue": instance,
        "master": master,
        "parents": [str(p).rsplit(".", 1)[-1] for p in material.get("parents", [])],
        "uv": 0,
        "textures": textures,
        "scalars": scalars,
        "vectors": vectors,
        "switches": switches,
        **({"template_colors": replaced} if replaced else {}),
    }
    base = vectors.get("diffuse_color_1", [0.5, 0.5, 0.5, 1.0])
    pbr: dict[str, Any] = {
        "baseColorFactor": [*base[:3], 1.0],
        "metallicFactor": 1.0 if textures.get("AO", {}).get("file") else 0.0,
        "roughnessFactor": min(1.0, scalars.get("RoughnessMap_MultValue", 1.0)),
    }
    gltf_textures: dict[str, str] = {}
    normal = textures.get("normalmap") or textures.get("Normals") or {}
    if normal.get("file"):
        gltf_textures["normal"] = normal["file"]
    orm = textures.get("AO") or {}
    if orm.get("file"):
        gltf_textures["orm"] = orm["file"]
    prefix = "udim" if udim is not None else "baked" if baked and baked_glb is not None else None
    if udim is not None:
        extras["udim"] = udim
    elif prefix == "baked" and baked_glb is not None:
        extras["baked"] = baked_glb.name
    if prefix is not None:
        # The atlas maps hold the final values; a bake keeps its own factors, which scale
        # its maps (glTF) and are all there is for properties that baked to a constant.
        factors = baked_factors(unit, instance) if prefix == "baked" else GLTF_FACTORS
        pbr.update(json.loads(json.dumps(factors)))
        for role, gltf_role, factor in (
            ("color", "color", "baseColorFactor"),
            ("normal", "normal", None),
            ("data", "orm", None),
        ):
            info = textures.get(f"{prefix}_{role}") or {}
            if info.get("file"):
                gltf_textures[gltf_role] = info["file"]
            elif factor and info.get("constant"):
                scale = pbr[factor]
                pbr[factor] = [
                    *(c * s for c, s in zip(info["constant"][:3], scale, strict=False)),
                    scale[3],
                ]
        if "orm" not in gltf_textures:
            orm_constant = (textures.get(f"{prefix}_data") or {}).get("constant")
            if orm_constant:
                pbr["roughnessFactor"] = float(orm_constant[1]) * float(pbr["roughnessFactor"])
                pbr["metallicFactor"] = float(orm_constant[2]) * float(pbr["metallicFactor"])
    if shader == "mh-jeans-v1":
        color = textures.get("Diffuse") or {}
        if color.get("file"):
            gltf_textures["color"] = color["file"]
            pbr["baseColorFactor"] = [1.0, 1.0, 1.0, 1.0]
        pbr["roughnessFactor"] = min(1.0, scalars.get("roughness", 0.9))
        pbr["metallicFactor"] = 0.0
    gltf = {"name": key, "pbrMetallicRoughness": pbr, "doubleSided": True}
    if "normal" in gltf_textures and not normal.get("file"):
        gltf["normalTexture"] = {"scale": 1.0}
    if normal.get("file"):
        gltf["normalTexture"] = {
            "scale": float(scalars.get("normal_strength", scalars.get("normal gain", 1.0)))
        }
    params = []
    if shader == "mh-fabric-v1":
        shown = visible_colors(switches, textures)
        params = [
            {"name": name, "type": "color", "default": hex_from_linear(vectors[name])}
            for name in ("diffuse_color_1", "diffuse_color_2", "B_diffuse_color_1", "C_color")
            if name in shown and name in vectors
        ]
    return MaterialResult(key, extras, gltf, gltf_textures, params)


def _channel_share(texture: Mapping[str, Any] | None, channel: int) -> float:
    """Share of texels in `channel` a map covers (constants: all or nothing)."""
    if not texture:
        return 0.0
    if "constant" in texture:
        values = texture["constant"]
        return 1.0 if channel < len(values) and float(values[channel]) > 0.25 else 0.0
    coverage = texture.get("coverage") or []
    if channel < len(coverage):
        return float(coverage[channel])
    # A three-channel map read as RGBA has opaque alpha; one channel covers all of RGB.
    return 1.0 if channel == 3 else float(coverage[0]) if coverage else 0.0


def visible_colors(switches: Mapping[str, bool], textures: Mapping[str, Any]) -> set[str]:
    """Fabric colour parameters that show anywhere on the garment, per the master graph:
    colour 2 through the stitch mask or (without the stitch switch) Masks.G, region B's
    own colour through Masks.B, region C's through the AO map's alpha."""
    masks = textures.get("Masks")
    stitch = _channel_share(textures.get("CustomStitch"), 0) > MIN_COVERAGE
    shown = {"diffuse_color_1"}
    color_var = _channel_share(masks, 1) > MIN_COVERAGE
    if stitch or (color_var and not switches.get("CustomStitchtx_diffuse_color_2")):
        shown.add("diffuse_color_2")
    if (
        switches.get("MaterialB option")
        and not switches.get("B_UseAColor")
        and _channel_share(masks, 2) > MIN_COVERAGE
    ):
        shown.add("B_diffuse_color_1")
    if (
        switches.get("DoMaterialC")
        and not switches.get("C_UseAColor")
        and _channel_share(textures.get("AO"), 3) > MIN_COVERAGE
    ):
        shown.add("C_color")
    return shown


# ---------------------------------------------------------------------------- GLB


def write_outfit_glb(
    output: Path,
    web_root: Path,
    fit: Fit,
    body: BodyFit,
    materials: Mapping[str, MaterialResult],
    extras: dict[str, Any],
) -> dict[str, Any]:
    """The fitted garment as a skinned GLB in the body's bind space. `materials` is keyed
    by the parts' Unreal material instance names; maps are referenced by relative URI."""
    builder = GlbBuilder(GENERATOR, compress=True)
    builder.use_extension(QUANTIZATION)
    skeleton = body.skeleton
    used: set[int] = set()
    for part in fit.parts:
        used.update(np.unique(part.joints[part.weights > 0]).tolist())
    joint_list = sorted(used)
    kept: set[int] = set()
    for joint in joint_list:
        while joint >= 0 and joint not in kept:
            kept.add(joint)
            joint = int(skeleton.parents[joint])
    nodes_order = sorted(kept)
    node_of = {joint: index for index, joint in enumerate(nodes_order)}
    for joint in nodes_order:
        node: dict[str, Any] = {
            "name": skeleton.names[joint],
            "translation": skeleton.translations[joint].tolist(),
            "rotation": skeleton.rotations[joint].tolist(),
        }
        if not np.allclose(skeleton.scales[joint], 1.0):
            node["scale"] = skeleton.scales[joint].tolist()
        children = [node_of[c] for c in nodes_order if int(skeleton.parents[c]) == joint]
        if children:
            node["children"] = children
        builder.add_node(node)
    roots = [node_of[j] for j in nodes_order if int(skeleton.parents[j]) < 0]
    remap = np.full(len(skeleton.names), -1, dtype=np.int64)
    remap[joint_list] = np.arange(len(joint_list))
    skin = builder.add_skin(
        {
            "name": "outfit_skin",
            "joints": [node_of[j] for j in joint_list],
            "inverseBindMatrices": builder.add_matrices(skeleton.inverse_binds[joint_list]),
            "skeleton": roots[0],
        }
    )
    sampler = builder.add_sampler()
    images: dict[str, int] = {}

    def texture(file: str) -> int:
        if file not in images:
            uri = _relative_uri(output, web_root / file)
            images[file] = builder.add_basisu_texture(builder.add_image(uri), sampler)
        return images[file]

    material_index: dict[str, int] = {}
    for instance, result in materials.items():
        gltf = json.loads(json.dumps(result.gltf))
        if "normal" in result.textures:
            gltf.setdefault("normalTexture", {})["index"] = texture(result.textures["normal"])
        if "orm" in result.textures:
            index = texture(result.textures["orm"])
            gltf["occlusionTexture"] = {"index": index}
            gltf["pbrMetallicRoughness"]["metallicRoughnessTexture"] = {"index": index}
        if "color" in result.textures:
            gltf["pbrMetallicRoughness"]["baseColorTexture"] = {
                "index": texture(result.textures["color"])
            }
        material_index[instance] = builder.add_material(gltf)
    names = sorted(
        {
            n
            for part in fit.parts
            for n, d in part.morphs.items()
            if np.abs(d).max() > MORPH_EPSILON
        },
        key=lambda n: list(fit.parts[0].morphs).index(n),
    )
    primitives = []
    for part in fit.parts:
        count = len(part.positions)
        attributes: dict[str, int] = {
            "POSITION": builder.add_accessor(
                part.positions.astype(np.float32), target=ARRAY_BUFFER, bounds=True
            ),
            "NORMAL": builder.add_accessor(
                quantize_snorm16(part.normals), target=ARRAY_BUFFER, normalized=True
            ),
            # Unused influence slots point at joint 0 (weight 0); never past the skin.
            "JOINTS_0": builder.add_accessor(
                np.where(part.weights > 0, remap[part.joints], 0).astype(
                    np.uint8 if len(joint_list) <= 255 else np.uint16
                ),
                target=ARRAY_BUFFER,
            ),
            "WEIGHTS_0": builder.add_accessor(
                quantize_weights(part.weights), target=ARRAY_BUFFER, normalized=True
            ),
        }
        if part.uvs.min() >= 0.0 and part.uvs.max() <= 1.0:
            attributes["TEXCOORD_0"] = builder.add_accessor(
                quantize_unorm16(part.uvs), target=ARRAY_BUFFER, normalized=True
            )
        else:
            attributes["TEXCOORD_0"] = builder.add_accessor(
                part.uvs.astype(np.float32), target=ARRAY_BUFFER
            )
        targets = []
        for name in names:
            delta = part.morphs[name]
            if np.abs(delta).max() > MORPH_EPSILON:
                accessor = builder.add_accessor(
                    quantize_snorm16(delta), target=ARRAY_BUFFER, bounds=True, normalized=True
                )
            else:
                accessor = builder.add_zero_accessor(count, 3, bounds=True)
            targets.append({"POSITION": accessor})
        primitive: dict[str, Any] = {
            "attributes": attributes,
            "indices": builder.add_accessor(
                part.triangles.astype(np.uint16 if count <= 65535 else np.uint32).ravel(),
                target=ELEMENT_ARRAY_BUFFER,
            ),
            "material": material_index[part.material],
        }
        if targets:
            primitive["targets"] = targets
        primitives.append(primitive)
    mesh: dict[str, Any] = {"name": "outfit", "primitives": primitives}
    if names:
        mesh["weights"] = [0.0] * len(names)
        mesh["extras"] = {"targetNames": names}
    mesh_node = builder.add_node({"name": "outfit", "mesh": builder.add_mesh(mesh), "skin": skin})
    builder.add_scene([*roots, mesh_node], extras={"mh": extras})
    data = builder.to_glb()
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".glb.tmp")
    temporary.write_bytes(data)
    temporary.replace(output)
    return {
        "bytes": len(data),
        "raw_bytes": builder.raw_bytes,
        "joints": len(joint_list),
        "morphs": len(names),
    }


def _relative_uri(glb: Path, target: Path) -> str:
    """URI of `target` relative to the GLB's folder (one level up at most: outfits/shared)."""
    folder = glb.parent
    try:
        return target.relative_to(folder).as_posix()
    except ValueError:
        return Path("..", target.relative_to(folder.parent)).as_posix()


# ---------------------------------------------------------------------------- outfits

LABELS_FILE = Path(__file__).with_name("outfit_labels.json")  # {name: {en, tr}}


def _labels() -> dict[str, dict[str, str]]:
    try:
        data = json.loads(LABELS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def outfit_label(name: str) -> dict[str, str]:
    """Bilingual label from outfit_labels.json, else the item name split into words."""
    known = _labels().get(name)
    if isinstance(known, dict) and isinstance(known.get("en"), str):
        return {"tr": str(known.get("tr", known["en"])), "en": str(known["en"])}
    words = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name.removeprefix("OA_")).replace("_", " ")
    words = words.strip() or name
    return {"tr": words, "en": words}


# {colors: {id: {en, tr}}, outfits: {name: [{id, values: {param: sRGB hex}}]}}
TINTS_FILE = Path(__file__).with_name("outfit_tints.json")


def curated_tints(
    name: str, params: Sequence[Mapping[str, Any]], tints_file: Path = TINTS_FILE
) -> list[dict[str, Any]] | None:
    """The outfit's curated colour presets from outfit_tints.json (first = the colour it is
    put on and photographed in), or None when it has none. The template colours are a flat
    grey with debug-blue trims on nearly every item, so the catalogue reads as one garment
    without them. A preset naming a colour or param the garment lacks is a data error."""
    data = json.loads(tints_file.read_text(encoding="utf-8"))
    presets = data["outfits"].get(name)
    if presets is None:
        return None
    colors: Mapping[str, Mapping[str, str]] = data["colors"]
    known = {str(p["name"]) for p in params if p.get("type") == "color"}
    entries = []
    for preset in presets:
        identifier = str(preset["id"])
        if identifier not in colors:
            raise ValueError(f"{TINTS_FILE.name}: {name} uses unknown colour {identifier!r}")
        values = {str(k): str(v) for k, v in preset["values"].items()}
        unknown = sorted(values.keys() - known)
        if unknown:
            raise ValueError(f"{TINTS_FILE.name}: {name}/{identifier} sets unknown {unknown}")
        label = colors[identifier]
        entries.append(
            {"id": identifier, "label": {"tr": label["tr"], "en": label["en"]}, "values": values}
        )
    return entries


@dataclass
class OutfitResult:
    record: dict[str, Any]  # per-gender manifest record (merged by manifest_entries)
    outputs: list[Path]
    stats: dict[str, Any]


def convert_outfit(
    unit: OutfitUnit,
    body: BodyFit,
    web_root: Path,
    *,
    archive: Path | None = None,
    log: Callable[[str], None] = lambda _: None,
) -> OutfitResult:
    """Write `outfits/<name>/<gender>.glb` and its maps; return the manifest record."""
    garment = load_garment(unit.glb, body)
    atlases = pack_udim_parts(unit, garment, log)
    fit = fit_garment(garment, body)
    hidden, hide_stats = body_hide(fit, body)
    coverage = region_coverage(hidden, body_regions(body))
    category = outfit_category(unit.name, coverage)
    if category == "shoes":
        hidden, closed = hide_closed_toes(hidden, body)
        hide_stats = {**hide_stats, "closed_toes": closed, "hidden": int(hidden.sum())}
    label = outfit_label(unit.name)
    writer = TextureWriter(web_root, log)
    hashes = unit.hashes()
    materials: dict[str, MaterialResult] = {}
    keys: set[str] = set()
    for part in garment.parts:
        if part.material in materials:
            continue
        result = convert_material(unit, part.material, writer, hashes, atlases.get(part.material))
        key, n = result.key, 1
        while key in keys:
            n += 1
            key = f"{result.key}_{n}"
        keys.add(key)
        result.key = key
        result.gltf["name"] = key
        materials[part.material] = result
    source: dict[str, Any] = {"unit": unit.folder.name, "gender": unit.gender}
    if archive is not None:
        source["unit"] = unit.folder.relative_to(archive).as_posix()
    extras = {
        "kind": "outfit",
        "id": f"outfit.{unit.name}",
        "gender": unit.gender,
        "category": category,
        "label": label["en"],
        "materials": {r.key: r.extras for r in materials.values()},
        "body_hide": encode_bitset(hidden),
        "body_hide_vertices": len(hidden),
        "body_hide_note": (
            "base64 bitset over the body primitive's vertex order (bit v of byte v >> 3, "
            "least significant bit first); the body shader discards triangles whose three "
            "vertices are hidden"
        ),
        "units": "m",
        "up": "+Y",
        "forward": "+Z",
        "fit": {**fit.stats, "body_hide": hide_stats, "coverage": coverage},
        "source": source,
    }
    output = web_root / "outfits" / unit.name / f"{unit.gender}.glb"
    glb_stats = write_outfit_glb(output, web_root, fit, body, materials, extras)
    multiple = len(materials) > 1
    params: list[dict[str, Any]] = []
    for result in materials.values():
        for param in result.params:
            name = f"{result.key}.{param['name']}" if multiple else param["name"]
            params.append({**param, "name": name})
    record = {
        "id": f"outfit.{unit.name}",
        "name": unit.name,
        "gender": unit.gender,
        "category": category,
        "label": label,
        "file": output.relative_to(web_root).as_posix(),
        "params": params,
        "tintPresets": (
            [
                {
                    "id": "default",
                    "label": {"tr": "Orijinal", "en": "Original"},
                    "values": {p["name"]: p["default"] for p in params},
                }
            ]
            if params
            else []
        ),
        "hidesBodyRegions": [r for r, share in coverage.items() if share >= REGION_HIDE_SHARE],
    }
    stats = {
        **glb_stats,
        "vertices": fit.stats["vertices"],
        "caps": fit.stats["caps_removed"],
        "pushed": fit.stats["pushed_out"],
        "hidden": hide_stats["hidden"],
        "textures": {f.relative_to(web_root).as_posix(): b for f, b in writer.written.items()},
        "dropped": fit.stats["dropped_primitives"],
    }
    return OutfitResult(record=record, outputs=[output, *writer.written], stats=stats)


def manifest_entries(records: Sequence[Mapping[str, Any]], web_root: Path) -> list[dict[str, Any]]:
    """Manifest `outfits[]` from per-gender records: one entry per item, files per gender.
    Params and tint presets come from the female garment when both exist (curated presets,
    see curated_tints, replace the authored one); the coarse regions are those both
    garments hide. An item gender_compat.json gives one gender is offered to it only."""
    grouped: dict[str, list[Mapping[str, Any]]] = {}
    for record in records:
        grouped.setdefault(str(record["id"]), []).append(record)
    entries = []
    for identifier, items in sorted(grouped.items()):
        items = sorted(items, key=lambda r: GENDERS.index(str(r["gender"])))
        first = items[0]
        genders = [str(r["gender"]) for r in items]
        compat = curated_compat("outfits", str(first["name"]))
        if compat and compat not in genders:
            raise ValueError(f"{COMPAT_FILE.name}: {first['name']} is for {compat}, no such mesh")
        regions = set(first["hidesBodyRegions"])
        for other in items[1:]:
            regions &= set(other["hidesBodyRegions"])
        entry: dict[str, Any] = {
            "id": identifier,
            "category": first["category"],
            "label": first["label"],
            "compat": compat or ("unisex" if len(set(genders)) == 2 else genders[0]),
            "files": {str(r["gender"]): str(r["file"]) for r in items},
            "params": list(first["params"]),
            "tintPresets": curated_tints(str(first["name"]), first["params"])
            or list(first["tintPresets"]),
            "hidesBodyRegions": sorted(regions),
        }
        thumbnail = web_root / "outfits" / str(first["name"]) / "thumbnail.webp"
        if thumbnail.is_file():
            entry["thumbnail"] = thumbnail.relative_to(web_root).as_posix()
        entries.append(entry)
    return entries
