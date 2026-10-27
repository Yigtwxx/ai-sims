"""MetaHuman groom cards (`raw/grooms/<Slot>/<Style>/`) -> web groom GLBs bound to DNA heads.

Grooms are authored on "groom heads" (`raw/grooms/groom_head/SKM_Groom_Head_Legacy0*.glb`),
MetaHuman heads with the DNA head topology but their own shape. The converter

1. matches every groom-head vertex to its DNA position by UV (Unreal stores UVs as half
   floats, so a few hundred near ties are settled with a min-cost bipartite matching), which
   gives the groom head in DNA position order;
2. binds every card (connected component of a card mesh) to the groom-head surface point
   closest to its root (its vertex nearest the scalp): three DNA position indices,
   barycentrics, and per-vertex offsets from that point;
3. writes the cards fitted to a reference DNA head (`fitted_to`), skinned like the bound
   surface point (head GLB live joints), with the reference head's ARKit and viseme morphs
   transferred (each card translates with its root), so expressions move brows, beards and
   hairlines when the runtime sets the same morph names on the groom meshes.

Runtime refit to any other head (positions of that head's DNA positions, metres, rest):
`position = sum(_BIND_WEIGHTS[i] * head[_BIND_POSITIONS[i]]) + _BIND_OFFSET`; cards keep
their shape and only translate, so normals and tangents stay valid.
"""

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray
from PIL import Image
from scipy.ndimage import gaussian_filter
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import min_weight_full_bipartite_matching
from scipy.spatial import cKDTree

from asset_pipeline.mh.bake import MorphTarget
from asset_pipeline.mh.dna import DnaFile, Mesh
from asset_pipeline.mh.geometry import closest_triangles, components
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
)
from asset_pipeline.mh.gltf import (
    GENERATOR,
    MAX_INFLUENCES,
    Space,
    live_ancestors,
    merge_influences,
    neutral_joint_transforms,
)
from asset_pipeline.mh.kinematics import (
    compose_transforms,
    forward_kinematics,
)
from asset_pipeline.mh.ktx import Ktx2Settings, encode_ktx2

SLOTS = {"Hair": "hair", "Eyebrows": "eyebrows", "Beards": "beard", "Mustaches": "mustache"}
COMPAT = {"beard": "male", "mustache": "male"}
LIGHT_LODS = ("LOD2", "LOD3", "LOD1", "LOD4")  # first one present is the lighter LOD
HEADS = ("SKM_Groom_Head_Legacy01", "SKM_Groom_Head_Legacy02")
UV_RADIUS = 1.5e-3  # half-float UVs sit within ~3e-4 of the DNA layout UVs
MORPH_EPSILON = 1e-4  # metres: transferred morphs smaller than this are left out
# Cards whose root is farther than this from the skin (clumps inside long hair) follow the
# head shape but not expressions: the skin under them is not what they grow from.
ATTACH_DISTANCE = 0.01  # metres
# Texture caps by slot: a 4K cards atlas costs ~10 MB as UASTC, 2K ~2.7 MB; eyebrows are
# seen in face close-ups and keep 4K.
MAX_TEXTURE = {"eyebrows": 4096}
# `density`: where on the head the cards grow, from their root UVs, joined with Unreal's
# baked cover where there is one (see groom_density).
ROOT_GRID = 512  # head-UV texels the roots are counted on
ROOT_SIGMA = 4.0  # blur (grid texels): sparse roots stand for the scalp between them
ROOT_COVERAGE = 0.05  # atlas texels fainter than this carry no strand
ROOT_FULL = 0.5  # share of the median root density that already counts as full cover
DENSITY_SIZE = 1024
DEFAULT_MAX_TEXTURE = 2048
# The MetaHuman hair material is driven by melanin, redness and an optional dye.
COLOR_PARAMS = [
    {"name": "Melanin", "type": "float", "default": 0.75, "min": 0.0, "max": 1.0},
    {"name": "Redness", "type": "float", "default": 0.25, "min": 0.0, "max": 1.0},
    {"name": "DyeColor", "type": "color", "default": "#000000"},
]
TEXTURE_ROLES = (
    # (filename pattern, manifest role, output file, keep alpha). Channels stay as Unreal
    # exported them; the hair material of the web app decides how to use them.
    # Some Epic packages spell it "CardsAltas" (Hair_L_HighPonytail).
    (re.compile(r"cardsa(?:tl|lt)as_attribute", re.I), "attribute", "attribute", False),
    (re.compile(r"cardsa(?:tl|lt)as_tangent", re.I), "tangent", "tangent", True),
    (
        re.compile(r"colorxydepthgroupid", re.I),
        "colorXYDepthGroupId",
        "color_xy_depth_group_id",
        True,
    ),
    (re.compile(r"uvseedcoverage", re.I), "rootUvSeedCoverage", "root_uv_seed_coverage", True),
    (re.compile(r"tangent(strand|coord)u", re.I), "tangentStrandU", "tangent_strand_u", True),
    (re.compile(r"_baked", re.I), "baked", "baked", True),
    (re.compile(r"makeup", re.I), "makeup", "makeup", True),
    (re.compile(r"highlightmask", re.I), "highlight", "highlight", False),
)
THUMB = re.compile(r"_thumb", re.I)
CARD_MESH = re.compile(r"Cards?Mesh(?:_Group\d+)?_LOD(\d+)$", re.I)
LINEAR = Ktx2Settings("linear", rdo=2.0)
COLOR = Ktx2Settings("srgb", rdo=1.0)

F64 = NDArray[np.float64]
I64 = NDArray[np.int64]


class GroomError(ValueError):
    """A groom unit cannot be converted."""


# ---------------------------------------------------------------------------- groom heads


def _layout_uvs(mesh: Mesh) -> F64:
    uvs = mesh.uvs[mesh.layout_uvs].astype(np.float64)
    uvs[:, 1] = 1.0 - uvs[:, 1]  # glTF top-left origin, like the groom head GLB
    return uvs


def match_positions(glb_positions: F64, glb_uvs: F64, mesh: Mesh) -> tuple[I64, I64]:
    """Map the unique positions of a groom-head GLB primitive onto DNA positions.

    Returns (unique-position index of every GLB vertex, DNA position of every unique
    position). Confident nearest-UV matches are kept; the rest (UV ties) go through a
    min-cost bipartite matching over their candidates within `UV_RADIUS`.
    """
    unique, inverse = np.unique(np.round(glb_positions, 6), axis=0, return_inverse=True)
    inverse = inverse.ravel()
    count, dna_count = len(unique), len(mesh.positions)
    if count != dna_count:
        raise GroomError(f"groom head has {count} positions, the DNA head {dna_count}")
    tree = cKDTree(_layout_uvs(mesh))
    candidates = tree.query_ball_point(glb_uvs, r=UV_RADIUS)
    rows, cols, costs = [], [], []
    dna_uvs = _layout_uvs(mesh)
    for vertex, layouts in enumerate(candidates):
        if not layouts:
            continue
        layouts = np.asarray(layouts)
        distance = np.linalg.norm(dna_uvs[layouts] - glb_uvs[vertex], axis=1)
        rows.append(np.full(len(layouts), inverse[vertex]))
        cols.append(mesh.layout_positions[layouts])
        costs.append(distance)
    row = np.concatenate(rows)
    col = np.concatenate(cols).astype(np.int64)
    cost = np.concatenate(costs) + 1e-9
    # Best cost per (unique position, DNA position) pair.
    key = row.astype(np.int64) * dna_count + col
    order = np.lexsort((cost, key))
    keep = order[np.r_[True, key[order][1:] != key[order][:-1]]]
    row, col, cost = row[keep], col[keep], cost[keep]

    assigned = np.full(count, -1, dtype=np.int64)
    # Confident: a single candidate, or the best clearly ahead of the runner-up.
    by_row = np.lexsort((cost, row))
    starts = np.r_[0, np.flatnonzero(np.diff(row[by_row])) + 1]
    for start, stop in zip(starts, np.r_[starts[1:], len(by_row)], strict=True):
        entries = by_row[start:stop]
        if len(entries) == 1 or cost[entries[0]] < 0.25 * cost[entries[1]]:
            assigned[row[entries[0]]] = col[entries[0]]
    taken = np.zeros(dna_count, dtype=bool)
    values, counts = np.unique(assigned[assigned >= 0], return_counts=True)
    duplicated = values[counts > 1]
    assigned[np.isin(assigned, duplicated)] = -1
    taken[assigned[assigned >= 0]] = True
    open_rows = np.flatnonzero(assigned < 0)
    if len(open_rows):
        open_cols = np.flatnonzero(~taken)
        row_index = {r: i for i, r in enumerate(open_rows.tolist())}
        col_index = {c: i for i, c in enumerate(open_cols.tolist())}
        mask = np.isin(row, open_rows) & np.isin(col, open_cols)
        sub = csr_matrix(
            (
                cost[mask],
                (
                    np.array([row_index[r] for r in row[mask].tolist()]),
                    np.array([col_index[c] for c in col[mask].tolist()]),
                ),
            ),
            shape=(len(open_rows), len(open_cols)),
        )
        try:
            matched_rows, matched_cols = min_weight_full_bipartite_matching(sub)
        except ValueError as error:
            raise GroomError(f"groom head UVs do not match the DNA head ({error})") from error
        assigned[open_rows[matched_rows]] = open_cols[matched_cols]
    if np.any(assigned < 0) or len(np.unique(assigned)) != count:
        raise GroomError("groom head correspondence is not one-to-one")
    return inverse.astype(np.int64), assigned


@dataclass(frozen=True)
class GroomHead:
    """A groom-authoring head in DNA position order (metres, asset space)."""

    name: str
    positions: F64  # (P, 3)
    triangles: I64  # (T, 3) DNA position indices
    edge_agreement: float  # share of DNA polygon edges present in the GLB triangles

    @classmethod
    def load(cls, path: Path, head: Mesh) -> "GroomHead":
        document, binary = read_glb(path.read_bytes())
        primitive = document["meshes"][0]["primitives"][0]
        positions = accessor_values(document, binary, primitive["attributes"]["POSITION"])
        uvs = accessor_values(document, binary, primitive["attributes"]["TEXCOORD_0"])
        indices = accessor_array(document, binary, primitive["indices"]).reshape(-1, 3)
        inverse, to_dna = match_positions(positions, uvs, head)
        ordered = np.zeros((len(head.positions), 3))
        unique = np.unique(np.round(positions, 6), axis=0)
        ordered[to_dna] = unique
        triangles = to_dna[inverse[indices.astype(np.int64)]]
        glb_edges = set()
        for a, b in ((0, 1), (1, 2), (2, 0)):
            glb_edges.update(map(tuple, np.sort(triangles[:, [a, b]], axis=1).tolist()))
        corners = head.layout_positions[head.face_layouts]
        following = np.arange(len(corners)) + 1
        ends = head.face_offsets[1:]
        following[ends - 1] = head.face_offsets[:-1]
        dna_edges = set(map(tuple, np.sort(np.stack([corners, corners[following]], 1), 1).tolist()))
        agreement = len(dna_edges & glb_edges) / max(len(dna_edges), 1)
        return cls(path.stem, ordered, triangles, agreement)


# ---------------------------------------------------------------------------- cards


@dataclass(frozen=True)
class CardMesh:
    positions: F64
    normals: F64 | None
    tangents: F64 | None
    uv0: F64 | None
    uv1: F64 | None
    indices: I64

    @classmethod
    def load(cls, paths: Sequence[Path]) -> "CardMesh":
        """Concatenate the card groups of one LOD (one GLB per group)."""
        parts: dict[str, list[F64]] = {"P": [], "N": [], "T": [], "U0": [], "U1": []}
        indices: list[I64] = []
        offset = 0
        for path in paths:
            document, binary = read_glb(path.read_bytes())
            for mesh in document.get("meshes", []):
                for primitive in mesh["primitives"]:
                    attributes = primitive["attributes"]
                    positions = accessor_values(document, binary, attributes["POSITION"])
                    parts["P"].append(positions)
                    for key, name in (
                        ("N", "NORMAL"),
                        ("T", "TANGENT"),
                        ("U0", "TEXCOORD_0"),
                        ("U1", "TEXCOORD_1"),
                    ):
                        if name in attributes:
                            parts[key].append(accessor_values(document, binary, attributes[name]))
                    local = accessor_array(document, binary, primitive["indices"]).astype(np.int64)
                    indices.append(local.reshape(-1, 3) + offset)
                    offset += len(positions)
        if not parts["P"]:
            raise GroomError(f"no card geometry in {[p.name for p in paths]}")
        total = sum(len(p) for p in parts["P"])

        def joined(key: str) -> F64 | None:
            arrays = parts[key]
            if not arrays or sum(len(a) for a in arrays) != total:
                return None
            return np.concatenate(arrays)

        positions = joined("P")
        assert positions is not None  # every primitive has POSITION
        return cls(
            positions,
            joined("N"),
            joined("T"),
            joined("U0"),
            joined("U1"),
            np.concatenate(indices),
        )


@dataclass(frozen=True)
class Binding:
    triangles: I64  # (V, 3) DNA positions of each vertex's card-root surface point
    weights: F64  # (V, 3) barycentrics
    offsets: F64  # (V, 3) vertex minus surface point, metres
    root_distance: F64  # (cards,) root-to-surface distance, metres
    attached: NDArray[np.bool_]  # (V,) the vertex's card grows from the skin

    def fit(self, head_positions: F64) -> F64:
        anchor = np.einsum("vk,vkj->vj", self.weights, head_positions[self.triangles])
        return anchor + self.offsets


def bind_cards(cards: CardMesh, head: GroomHead) -> Binding:
    labels = components(len(cards.positions), cards.indices)
    triangle, bary, distance = closest_triangles(cards.positions, head.positions, head.triangles)
    order = np.lexsort((distance, labels))
    first = np.r_[True, labels[order][1:] != labels[order][:-1]]
    roots = order[first]  # the vertex of each card nearest the scalp
    root_of_label = np.empty(labels.max() + 1, dtype=np.int64)
    root_of_label[labels[roots]] = roots
    root = root_of_label[labels]
    triangles = head.triangles[triangle[root]]
    weights = bary[root]
    anchor = np.einsum("vk,vkj->vj", weights, head.positions[triangles])
    attached = distance[root] <= ATTACH_DISTANCE
    return Binding(triangles, weights, cards.positions - anchor, distance[roots], attached)


# ---------------------------------------------------------------------------- reference head


@dataclass(frozen=True)
class ReferenceHead:
    """The DNA head grooms are fitted to and skinned with (rest pose, metres)."""

    name: str
    positions: F64  # (P, 3) head mesh positions
    joints: I64  # (P, 4) merged live joints per position
    weights: F64  # (P, 4)
    joint_names: tuple[str, ...]
    parents: I64  # (J,), -1 for roots
    rest_translations: F64  # (J, 3) local, metres
    rest_rotations: F64  # (J, 4) local
    rest_world: F64  # (J, 4, 4)
    morphs: dict[str, F64]  # name -> (P, 3) head position deltas, metres

    @classmethod
    def build(
        cls,
        name: str,
        dna: DnaFile,
        targets: Sequence[MorphTarget],
        live: Mapping[str, bool],
    ) -> "ReferenceHead":
        head = next(m for m in dna.meshes_for_lod(0) if m.name.startswith("head_"))
        space = Space.from_descriptor(dna.descriptor)
        alive = np.array([live.get(n, True) for n in dna.joints.names])
        target = live_ancestors(dna.joints.parents, alive)
        joints, weights = head.skin.dense(normalize=True)
        merged_joints, merged_weights, _ = merge_influences(joints, weights, target)
        translations, rotations = neutral_joint_transforms(dna, space)
        world = forward_kinematics(
            compose_transforms(translations, rotations, np.ones_like(translations)),
            dna.joints.parents,
        )
        morphs = {
            t.name: space.points(t.meshes[head.index].positions)
            for t in targets
            if head.index in t.meshes
        }
        return cls(
            name=name,
            positions=space.points(head.positions),
            joints=merged_joints.astype(np.int64),
            weights=merged_weights.astype(np.float64),
            joint_names=tuple(dna.joints.names),
            parents=dna.joints.parents.astype(np.int64),
            rest_translations=translations,
            rest_rotations=rotations,
            rest_world=world,
            morphs=morphs,
        )


def _blend_skin(reference: ReferenceHead, binding: Binding) -> tuple[I64, F64]:
    """Per-vertex skin of the bound surface point, top 4 influences."""
    vertices = len(binding.weights)
    joints = reference.joints[binding.triangles].reshape(vertices, -1)
    weights = (reference.weights[binding.triangles] * binding.weights[:, :, None]).reshape(
        vertices, -1
    )
    identity = np.arange(len(reference.joint_names), dtype=np.int32)
    merged_joints, merged_weights, _ = merge_influences(
        joints.astype(np.int32), weights.astype(np.float32), identity, limit=MAX_INFLUENCES
    )
    return merged_joints.astype(np.int64), merged_weights.astype(np.float64)


def _local_joints(remap: I64, joints: I64, weights: F64) -> NDArray[np.uint16]:
    """Head joint indices as groom-skin indices for JOINTS_0.

    Empty slots (weight 0) carry head joint 0, which the skin may not include; they point
    at skin joint 0 instead, since glTF requires every index to name a skin joint.
    """
    local = np.where(weights > 0, remap[joints], 0)
    if (local < 0).any():
        raise ValueError("a weighted influence is outside the groom skin")
    return local.astype(np.uint16)


# ---------------------------------------------------------------------------- units


@dataclass(frozen=True)
class GroomUnit:
    unit: Path
    slot: str  # manifest slot
    style: str
    cards: dict[str, Any]

    @classmethod
    def load(cls, unit: Path) -> "GroomUnit":
        cards = json.loads((unit / "cards.json").read_text(encoding="utf-8"))
        slot = SLOTS.get(unit.parent.name)
        if slot is None:
            raise GroomError(f"{unit.parent.name} grooms are not converted")
        return cls(unit, slot, unit.name, cards)

    def lod_files(self) -> dict[str, list[Path]]:
        """Card meshes by LOD (`..._CardsMesh_Group0_LOD0.glb`; some exports say `CardMesh`)."""
        lods: dict[str, list[Path]] = {}
        for path in sorted((self.unit / "meshes").glob("*.glb")):
            match = CARD_MESH.search(path.stem)
            if match:
                lods.setdefault(f"LOD{match.group(1)}", []).append(path)
        return lods

    @property
    def label(self) -> str:
        for binding in self.cards.get("bindings", {}).values():
            if isinstance(binding, dict) and binding.get("thumbnail_name"):
                return str(binding["thumbnail_name"])
        return self.style.replace("_", " ")

    @property
    def source_head(self) -> str | None:
        for binding in self.cards.get("bindings", {}).values():
            if isinstance(binding, dict) and binding.get("source_skeletal_mesh"):
                return str(binding["source_skeletal_mesh"]).split("/")[-1].split(".")[0]
        return None

    def texture_flags(self) -> dict[str, bool]:
        flags = {}
        for info in self.cards.get("textures", {}).values():
            if isinstance(info, dict) and "file" in info:
                flags[Path(str(info["file"])).name.lower()] = bool(info.get("srgb", False))
        return flags


def list_groom_units(archive: Path) -> list[Path]:
    root = archive / "raw" / "grooms"
    units = []
    for folder in SLOTS:
        base = root / folder
        if base.is_dir():
            units += [
                p
                for p in sorted(base.iterdir())
                if (p / "done.json").is_file() and (p / "cards.json").is_file()
            ]
    return units


def choose_head(
    cards: CardMesh, heads: Mapping[str, GroomHead], preferred: str | None
) -> tuple[GroomHead, float]:
    """The groom head the cards were authored on: the one their roots sit closest to."""
    sample = cards.positions[:: max(1, len(cards.positions) // 4000)]
    scores = {}
    for name, head in heads.items():
        _, _, distance = closest_triangles(sample, head.positions, head.triangles, candidates=8)
        scores[name] = float(np.percentile(distance, 10))
    best = min(scores, key=scores.__getitem__)
    if preferred is not None and preferred in heads and scores[preferred] <= scores[best] * 1.5:
        best = preferred
    return heads[best], scores[best]


def _texture_settings(path: Path, srgb: bool) -> Ktx2Settings:
    return COLOR if srgb else LINEAR


def _resize_straight(pixels: NDArray[np.uint8], size: int) -> NDArray[np.uint8]:
    """Box-filter every channel on its own. PIL resizes RGBA with premultiplied alpha,
    which darkens colour and corrupts data channels where coverage is partial."""
    if pixels.ndim == 2:
        return np.asarray(Image.fromarray(pixels).resize((size, size), Image.Resampling.BOX))
    return np.stack(
        [
            np.asarray(
                Image.fromarray(np.ascontiguousarray(pixels[..., c])).resize(
                    (size, size), Image.Resampling.BOX
                )
            )
            for c in range(pixels.shape[2])
        ],
        axis=-1,
    )


def density_from_roots(root_uv_seed_coverage: NDArray[np.uint8]) -> NDArray[np.uint8]:
    """A head-UV density map (alpha, 0..1) from a card atlas's root UV texture (R, G: the head
    UV a texel's strands grow from; A: their coverage). Every covered texel adds its coverage
    at its root; a blur turns the sparse roots into the scalp they cover, and anything over
    half the median density is full cover. Unreal bakes its `_baked` map the same way, but
    with strand detail and only for some grooms; this one is smooth and exists for all."""
    rgba = root_uv_seed_coverage.astype(np.float32) / 255.0
    coverage = rgba[..., 3]
    grown = coverage > ROOT_COVERAGE
    cols = np.clip((rgba[..., 0][grown] * ROOT_GRID).astype(np.int64), 0, ROOT_GRID - 1)
    rows = np.clip((rgba[..., 1][grown] * ROOT_GRID).astype(np.int64), 0, ROOT_GRID - 1)
    grid = np.zeros((ROOT_GRID, ROOT_GRID), dtype=np.float32)
    np.add.at(grid, (rows, cols), coverage[grown])
    grid = gaussian_filter(grid, ROOT_SIGMA)
    present = grid[grid > grid.max() * 0.01] if grid.max() > 0 else grid[:0]
    full = float(np.median(present)) * ROOT_FULL if present.size else 1.0
    t = np.clip(grid / max(full, 1e-9), 0.0, 1.0)
    density = t * t * (3.0 - 2.0 * t)
    image = Image.fromarray(density.astype(np.float32))
    upsized = np.asarray(image.resize((DENSITY_SIZE, DENSITY_SIZE), Image.Resampling.BILINEAR))
    out = np.zeros((DENSITY_SIZE, DENSITY_SIZE, 4), dtype=np.uint8)
    out[..., 3] = np.round(np.clip(upsized, 0.0, 1.0) * 255.0).astype(np.uint8)
    return out


def groom_density(
    root_uv_seed_coverage: NDArray[np.uint8], baked_cover: NDArray[np.uint8] | None
) -> NDArray[np.uint8]:
    """The `density` map: the root density joined with Unreal's baked cover (the `_baked`
    map's alpha, head UV) where the groom has one. Cards only carry the strands they were
    built from, so the roots of combed-back styles stay near the hairline; an updo's crown
    and back, which its strands cover, showed bare scalp between the cards."""
    density = density_from_roots(root_uv_seed_coverage)
    if baked_cover is None:
        return density
    cover = Image.fromarray(baked_cover).resize(
        (DENSITY_SIZE, DENSITY_SIZE), Image.Resampling.BILINEAR
    )
    density[..., 3] = np.maximum(density[..., 3], np.asarray(cover))
    return density


def convert_textures(
    groom: GroomUnit, folder: Path, web_root: Path
) -> tuple[dict[str, str], str | None]:
    """KTX2 maps by role and a WebP thumbnail; returns ({role: file}, thumbnail)."""
    flags = groom.texture_flags()
    textures: dict[str, str] = {}
    thumbnail = None
    roots: NDArray[np.uint8] | None = None
    baked_cover: NDArray[np.uint8] | None = None
    for path in sorted((groom.unit / "textures").glob("*.png")):
        if THUMB.search(path.stem):
            output = folder / "thumbnail.webp"
            # Keep an existing thumbnail: the web app's thumbnail bench renders its own.
            if not output.is_file():
                with Image.open(path) as image:
                    picture = image.convert("RGB")
                    picture.thumbnail((384, 384), Image.Resampling.LANCZOS)
                    output.parent.mkdir(parents=True, exist_ok=True)
                    picture.save(output, "WEBP", quality=88, method=6)
            thumbnail = output.relative_to(web_root).as_posix()
            continue
        role = next(
            (
                (r, file_name, alpha)
                for pattern, r, file_name, alpha in TEXTURE_ROLES
                if pattern.search(path.stem)
            ),
            None,
        )
        if role is None:
            continue
        name, file_name, keep_alpha = role
        limit = MAX_TEXTURE.get(groom.slot, DEFAULT_MAX_TEXTURE)
        with Image.open(path) as image:
            mode = "L" if image.mode in ("L", "I;16") else ("RGBA" if keep_alpha else "RGB")
            pixels = np.asarray(image.convert(mode))
        if max(pixels.shape[:2]) > limit:
            pixels = _resize_straight(pixels, limit)
        if pixels.ndim == 3 and pixels.shape[2] == 4 and pixels[..., 3].min() == 255:
            pixels = pixels[..., :3]
        output = folder / f"{file_name}.ktx2"
        encode_ktx2(pixels, output, _texture_settings(path, flags.get(path.name.lower(), False)))
        textures[name] = output.relative_to(web_root).as_posix()
        if pixels.ndim == 3 and pixels.shape[2] == 4:
            if name == "rootUvSeedCoverage":
                roots = pixels
            elif name == "baked":
                baked_cover = pixels[..., 3]
    if roots is not None:
        density = folder / "density.ktx2"
        encode_ktx2(groom_density(roots, baked_cover), density, LINEAR)
        textures["density"] = density.relative_to(web_root).as_posix()
    return textures, thumbnail


def write_cards_glb(
    output: Path,
    lods: Sequence[tuple[str, CardMesh, Binding]],
    reference: ReferenceHead,
    extras: dict[str, Any],
) -> dict[str, Any]:
    builder = GlbBuilder(GENERATOR, compress=True)
    builder.use_extension(QUANTIZATION)
    fitted = []
    used: set[int] = set()
    skins = []
    for _, _cards, binding in lods:
        positions = binding.fit(reference.positions)
        joints, weights = _blend_skin(reference, binding)
        fitted.append(positions)
        skins.append((joints, weights))
        used.update(np.unique(joints[weights > 0]).tolist())
    joint_list = sorted(used)
    # The skinned joints and their ancestors, in the head skeleton's hierarchy (glTF wants a
    # common root; the runtime re-points the joints at the character's bones by name).
    kept: set[int] = set()
    for joint in joint_list:
        while joint >= 0 and joint not in kept:
            kept.add(joint)
            joint = int(reference.parents[joint])
    skeleton = sorted(kept)
    node_of = {joint: index for index, joint in enumerate(skeleton)}
    for joint in skeleton:
        node: dict[str, Any] = {
            "name": reference.joint_names[joint],
            "translation": reference.rest_translations[joint].tolist(),
            "rotation": reference.rest_rotations[joint].tolist(),
        }
        children = [node_of[c] for c in skeleton if int(reference.parents[c]) == joint]
        if children:
            node["children"] = children
        builder.add_node(node)
    remap = np.full(len(reference.joint_names), -1, dtype=np.int64)
    remap[joint_list] = np.arange(len(joint_list))
    skeleton_roots = [node_of[j] for j in skeleton if int(reference.parents[j]) < 0]
    skin = builder.add_skin(
        {
            "name": "groom_skin",
            "joints": [node_of[j] for j in joint_list],
            "inverseBindMatrices": builder.add_matrices(
                np.linalg.inv(reference.rest_world[joint_list])
            ),
            "skeleton": skeleton_roots[0],
        }
    )
    material = builder.add_material(
        {
            "name": f"groom_{extras['slot']}",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.08, 0.05, 0.035, 1.0],
                "metallicFactor": 0.0,
                "roughnessFactor": 0.55,
            },
            "alphaMode": "MASK",
            "alphaCutoff": 0.5,
            "doubleSided": True,
        }
    )
    mesh_nodes = []
    lod_info = []
    names_union: list[str] = []
    for (lod_name, cards, binding), positions, (joints, weights) in zip(
        lods, fitted, skins, strict=True
    ):
        count = len(positions)
        # Morphs: every card translates with its root's surface point.
        deltas = {
            name: np.einsum("vk,vkj->vj", binding.weights, morph[binding.triangles])
            for name, morph in reference.morphs.items()
        }
        for delta in deltas.values():
            delta[~binding.attached] = 0.0
        active = [n for n, d in deltas.items() if np.abs(d).max() > MORPH_EPSILON]
        attributes: dict[str, int] = {
            "POSITION": builder.add_accessor(
                positions.astype(np.float32), target=ARRAY_BUFFER, bounds=True
            ),
            "JOINTS_0": builder.add_accessor(
                _local_joints(remap, joints, weights), target=ARRAY_BUFFER
            ),
            "WEIGHTS_0": builder.add_accessor(
                quantize_weights(weights), target=ARRAY_BUFFER, normalized=True
            ),
            "_BIND_POSITIONS": builder.add_accessor(
                binding.triangles.astype(np.float32), target=ARRAY_BUFFER
            ),
            "_BIND_WEIGHTS": builder.add_accessor(
                binding.weights.astype(np.float32), target=ARRAY_BUFFER
            ),
            "_BIND_OFFSET": builder.add_accessor(
                binding.offsets.astype(np.float32), target=ARRAY_BUFFER
            ),
        }
        if cards.normals is not None:
            attributes["NORMAL"] = builder.add_accessor(
                quantize_snorm16(cards.normals), target=ARRAY_BUFFER, normalized=True
            )
        if cards.tangents is not None and cards.tangents.shape[1] == 4:
            attributes["TANGENT"] = builder.add_accessor(
                quantize_snorm16(cards.tangents), target=ARRAY_BUFFER, normalized=True
            )
        for key, uv in (("TEXCOORD_0", cards.uv0), ("TEXCOORD_1", cards.uv1)):
            if uv is None:
                continue
            if uv.min() >= 0.0 and uv.max() <= 1.0:
                attributes[key] = builder.add_accessor(
                    quantize_unorm16(uv), target=ARRAY_BUFFER, normalized=True
                )
            else:
                attributes[key] = builder.add_accessor(uv.astype(np.float32), target=ARRAY_BUFFER)
        index_type = np.uint16 if count <= 65535 else np.uint32
        primitive: dict[str, Any] = {
            "attributes": attributes,
            "indices": builder.add_accessor(
                cards.indices.astype(index_type).ravel(), target=ELEMENT_ARRAY_BUFFER
            ),
            "material": material,
        }
        if active:
            primitive["targets"] = [
                {
                    "POSITION": builder.add_accessor(
                        quantize_snorm16(deltas[n]),
                        target=ARRAY_BUFFER,
                        bounds=True,
                        normalized=True,
                    )
                }
                for n in active
            ]
        mesh: dict[str, Any] = {"name": f"cards_{lod_name.lower()}", "primitives": [primitive]}
        if active:
            mesh["weights"] = [0.0] * len(active)
            mesh["extras"] = {"targetNames": active}
            names_union += [n for n in active if n not in names_union]
        node = builder.add_node(
            {"name": f"cards_{lod_name.lower()}", "mesh": builder.add_mesh(mesh), "skin": skin}
        )
        mesh_nodes.append(node)
        lod_info.append(
            {
                "node": f"cards_{lod_name.lower()}",
                "source": lod_name,
                "vertices": count,
                "triangles": len(cards.indices),
                "morphs": len(active),
            }
        )
    roots = skeleton_roots + mesh_nodes
    builder.add_scene(
        roots,
        extras={"mh": {**extras, "lods": lod_info, "units": "m", "up": "+Y", "forward": "+Z"}},
    )
    data = builder.to_glb()
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".glb.tmp")
    temporary.write_bytes(data)
    temporary.replace(output)
    return {"bytes": len(data), "raw_bytes": builder.raw_bytes, "lods": lod_info}


def convert_painted(
    groom: GroomUnit, web_root: Path
) -> tuple[dict[str, Any], list[Path], dict[str, Any]]:
    """A groom Unreal draws from strands only (stubble, buzz cuts, waves): there are no cards
    to fit, but its `_baked` head-UV map (RG: strand direction, A: coverage, strand by
    strand) is that hair as the skin shows it, so the web paints it on the head skin in the
    hair colour. The manifest entry has `painted` (the map) instead of `glb`."""
    folder = web_root / "grooms" / groom.slot / groom.style
    textures, thumbnail = convert_textures(groom, folder, web_root)
    painted = textures.get("baked")
    if painted is None:
        raise GroomError(f"{groom.style}: no hair cards and no baked head-UV map")
    entry: dict[str, Any] = {
        "id": f"groom.{groom.slot}.{groom.style}",
        "slot": groom.slot,
        "label": groom.label,
        "compat": COMPAT.get(groom.slot, "unisex"),
        "painted": painted,
        "textures": textures,
        "params": [dict(p) for p in COLOR_PARAMS],
    }
    if thumbnail:
        entry["thumbnail"] = thumbnail
    outputs = [*(web_root / f for f in textures.values())]
    if thumbnail:
        outputs.append(web_root / thumbnail)
    return entry, outputs, {"painted": True, "textures": sorted(textures)}


def convert_groom(
    groom: GroomUnit,
    heads: Mapping[str, GroomHead],
    reference: ReferenceHead,
    web_root: Path,
) -> tuple[dict[str, Any], list[Path], dict[str, Any]]:
    """Write `grooms/<slot>/<style>/` and return (manifest entry, outputs, stats)."""
    lods = groom.lod_files()
    if "LOD0" not in lods:
        return convert_painted(groom, web_root)
    light = next((name for name in LIGHT_LODS if name in lods), None)
    chosen = ["LOD0", *([light] if light else [])]
    meshes = {name: CardMesh.load(lods[name]) for name in chosen}
    head, score = choose_head(meshes["LOD0"], heads, groom.source_head)
    bound = [(name, mesh, bind_cards(mesh, head)) for name, mesh in meshes.items()]
    folder = web_root / "grooms" / groom.slot / groom.style
    textures, thumbnail = convert_textures(groom, folder, web_root)
    roots = bound[0][2].root_distance
    extras = {
        "kind": "groom",
        "slot": groom.slot,
        "style": groom.style,
        "label": groom.label,
        "source_head": head.name,
        "source_head_edges": round(head.edge_agreement, 4),
        "fitted_to": reference.name,
        "root_distance_mm": {
            "median": round(float(np.median(roots)) * 1000, 2),
            "p95": round(float(np.percentile(roots, 95)) * 1000, 2),
        },
        "binding": (
            "_BIND_POSITIONS: 3 DNA head position indices, _BIND_WEIGHTS: barycentrics, "
            "_BIND_OFFSET: metres; position = sum(w * head[p]) + offset (rest pose). Bind "
            "the refitted cards with the head's skeleton and inverse bind matrices. Cards "
            "whose root is over 1 cm from the skin carry no expression morphs"
        ),
        "textures": textures,
    }
    stats = write_cards_glb(folder / "cards.glb", bound, reference, extras)
    entry: dict[str, Any] = {
        "id": f"groom.{groom.slot}.{groom.style}",
        "slot": groom.slot,
        "label": groom.label,
        "compat": COMPAT.get(groom.slot, "unisex"),
        "glb": (folder / "cards.glb").relative_to(web_root).as_posix(),
        "textures": textures,
        "params": [dict(p) for p in COLOR_PARAMS],
    }
    if thumbnail:
        entry["thumbnail"] = thumbnail
    outputs = [folder / "cards.glb", *(web_root / f for f in textures.values())]
    if thumbnail:
        outputs.append(web_root / thumbnail)
    stats.update(
        {
            "head": head.name,
            "head_fit_p10_mm": round(score * 1000, 2),
            "root_distance_mm": extras["root_distance_mm"],
        }
    )
    return entry, outputs, stats
