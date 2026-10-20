"""Convert archived MetaHuman exports into web GLBs (`MetaHumanArchive/raw` -> `web`).

- `convert_head(name)`: `raw/characters/<Name>/dcc/<Name>/head.dna` -> `web/faces/<Name>/head.glb`
  with LOD0 meshes, the 52 ARKit shapes and 15 visemes baked through RigLogic, wrinkle-map
  weights per target, the neck seam and the DNA position index.
- `convert_body(gender)`: `raw/bodies/<gender>/neutral` -> `web/bodies/<gender>/body.glb`
  with the full body skeleton and `body_<slider>_<min|max>` targets from the basis DNAs,
  plus the joint translation offsets of each slider end.

Textures are not converted yet: the 2K DCC maps (and wrinkle masks) are hard-linked next to
the GLB (`maps/`, a copy when linking fails) and referenced by relative URIs, so the GLB
renders when `web/` is served as is. Only units with a `done.json` are converted.
"""

import hashlib
import json
import os
import re
import shutil
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

from asset_pipeline.mh.arkit import load_arkit_mapping
from asset_pipeline.mh.bake import (
    MeshMorph,
    MorphBaker,
    MorphTarget,
    ShapeSpec,
    arkit_shapes,
    head_bake_meshes,
    mesh_kind,
    vertex_normals,
    viseme_shapes,
)
from asset_pipeline.mh.dna import DnaFile, Mesh, read_dna
from asset_pipeline.mh.glb import read_glb
from asset_pipeline.mh.gltf import GlbStats, Space, write_glb
from asset_pipeline.mh.rig import MetaHumanRig
from asset_pipeline.mh.visemes import VISEME_RECIPES

DEFAULT_ARCHIVE = Path.home() / "MetaHumanArchive"
EYE_JOINTS = ("FACIAL_L_Eye", "FACIAL_R_Eye")
# Twist joints stay live although the body rig drives them: undriven they still move rigidly
# with their parent, and a runtime twist solver can use them.
TWIST_JOINT = re.compile(r"_twist_\d+_")
BODY_SLIDERS = ("height", "weight", "muscle", "chest", "waist", "hips", "shoulders")
SEAM_RINGS = 4
JOINT_DELTA_EPSILON = 1e-6  # metres


class ConversionError(RuntimeError):
    """An input is missing or incomplete (no done.json, topology mismatch, ...)."""


def archive_root() -> Path:
    return Path(os.environ.get("MH_ARCHIVE", str(DEFAULT_ARCHIVE)))


def _require_done(unit: Path) -> None:
    if not (unit / "done.json").is_file():
        raise ConversionError(f"{unit} has no done.json (export incomplete)")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def link_files(sources: Iterable[Path], destination: Path, glb_dir: Path) -> dict[str, str]:
    """Hard-link (or copy) files into `destination`; return {file name: URI from glb_dir}."""
    destination.mkdir(parents=True, exist_ok=True)
    uris = {}
    for source in sources:
        target = destination / source.name
        if not (target.exists() and os.path.samefile(source, target)):
            if target.exists():
                target.unlink()
            try:
                os.link(source, target)
            except OSError:
                shutil.copy2(source, target)
        uris[source.name] = target.relative_to(glb_dir).as_posix()
    return uris


# ---------------------------------------------------------------------------- seams


def _edges(mesh: Mesh) -> np.ndarray:
    """Undirected polygon edges `(E, 2)` between DNA position indices (unique, sorted)."""
    corners = mesh.layout_positions[mesh.face_layouts]
    following = np.arange(len(corners)) + 1
    ends = mesh.face_offsets[1:]
    following[ends - 1] = mesh.face_offsets[:-1]  # wrap each polygon around
    return np.sort(np.stack([corners, corners[following]], axis=1), axis=1)


def boundary_loops(mesh: Mesh) -> list[np.ndarray]:
    """Position indices of each open boundary (edges used by one polygon), walked in order."""
    pairs = _edges(mesh)
    keys, counts = np.unique(
        pairs[:, 0].astype(np.int64) * len(mesh.positions) + pairs[:, 1], return_counts=True
    )
    boundary = keys[counts == 1]
    a, b = boundary // len(mesh.positions), boundary % len(mesh.positions)
    if not len(a):
        return []
    size = len(mesh.positions)
    graph = coo_matrix((np.ones(len(a)), (a, b)), shape=(size, size))
    _, labels = connected_components(graph, directed=False)
    neighbours: dict[int, list[int]] = {}
    for start, end in zip(a.tolist(), b.tolist(), strict=True):
        neighbours.setdefault(start, []).append(end)
        neighbours.setdefault(end, []).append(start)
    loops = []
    for label in np.unique(labels[np.concatenate([a, b])]):
        members = sorted(v for v in neighbours if labels[v] == label)
        walk, previous, current = [members[0]], -1, members[0]
        while True:
            options = [v for v in neighbours[current] if v != previous]
            if not options or options[0] == walk[0] or len(walk) > len(members):
                break
            previous, current = current, options[0]
            walk.append(current)
        loops.append(np.array(walk if len(walk) == len(members) else members, dtype=np.int64))
    return loops


def neck_seam(mesh: Mesh, space: Space, *, lowest: bool, rings: int = SEAM_RINGS) -> dict[str, Any]:
    """The open boundary at the neck (lowest loop of a head, highest of a body) plus `rings`
    rings of neighbours with falling weights (1 at the seam)."""
    loops = boundary_loops(mesh)
    if not loops:
        raise ConversionError(f"{mesh.name} has no open boundary for a neck seam")
    height = space.points(mesh.positions)[:, 1]
    by_height = sorted(loops, key=lambda members: float(height[members].mean()))
    loop = by_height[0] if lowest else by_height[-1]
    pairs = _edges(mesh)
    size = len(mesh.positions)
    adjacency = coo_matrix(
        (
            np.ones(2 * len(pairs)),
            (np.r_[pairs[:, 0], pairs[:, 1]], np.r_[pairs[:, 1], pairs[:, 0]]),
        ),
        shape=(size, size),
    ).tocsr()
    ring = np.full(size, -1, dtype=np.int64)
    ring[loop] = 0
    frontier = loop
    for step in range(1, rings + 1):
        reached = np.unique(adjacency[frontier].indices)
        reached = reached[ring[reached] < 0]
        ring[reached] = step
        frontier = reached
    positions = np.flatnonzero(ring >= 0)
    weights = 1.0 - ring[positions] / (rings + 1)
    weight_of = dict(zip(positions.tolist(), weights.tolist(), strict=True))
    vertices = np.flatnonzero(ring[mesh.layout_positions] >= 0)
    return {
        "primitive": mesh_kind(mesh.name),
        "boundary": loop.tolist(),
        "positions": positions.tolist(),
        "position_weights": [round(w, 4) for w in weights.tolist()],
        "vertices": vertices.tolist(),
        "weights": [round(weight_of[int(p)], 4) for p in mesh.layout_positions[vertices].tolist()],
        "rings": rings,
        "note": "boundary/positions are DNA position indices; vertices index the primitive",
    }


# ---------------------------------------------------------------------------- heads


@dataclass(frozen=True)
class CharacterSource:
    name: str
    unit: Path  # raw/characters/<Name>
    dcc: Path  # raw/characters/<Name>/dcc/<Name>

    @classmethod
    def find(cls, archive: Path, name: str) -> "CharacterSource":
        unit = archive / "raw" / "characters" / name
        _require_done(unit)
        dcc = unit / "dcc" / name
        if not (dcc / "head.dna").is_file():
            raise ConversionError(f"{dcc / 'head.dna'} not found")
        return cls(name=name, unit=unit, dcc=dcc)

    @property
    def head_dna(self) -> Path:
        return self.dcc / "head.dna"

    @property
    def maps(self) -> list[Path]:
        return sorted((self.dcc / "Maps").glob("*.png")) + sorted(
            (self.dcc / "Masks").glob("*.tga")
        )


def body_driven_joints(body: DnaFile) -> set[str]:
    """Correctives and twists a body DNA's RigLogic poses (animation clips do not)."""
    return {body.joints.names[j] for j in body.behavior.driven_joints.tolist()}


def body_live_rule(body: DnaFile) -> Callable[[str], bool]:
    """Body joints that move at runtime: everything animation drives, plus pure twists.

    Correctives only move when RigLogic runs, which the web runtime does not do for bodies,
    so their skin weight goes to the animated parent (exact while they rest) and the
    4-influence budget goes to joints that really move.
    """
    driven = body_driven_joints(body)
    return lambda name: name not in driven or bool(TWIST_JOINT.search(name))


GENDER_SOURCE = "estimate: nearest neutral basis body by height-normalised shape"


def estimate_gender(body_dna: Path, archive: Path) -> str | None:
    """Best guess of a character's body gender; the DCC export records none (the DNA
    descriptors all read "female, 24"). Compares the character body with the neutral basis
    bodies after removing position and height, so a tall woman does not read as a man.
    Returns None when the basis bodies are missing."""
    candidates = {}
    for gender in ("female", "male"):
        path = archive / "raw" / "bodies" / gender / "neutral" / f"Body_{gender}_Body.dna"
        if path.is_file():
            candidates[gender] = read_dna(path, lods=[0], blend_shapes=False)
    if not candidates:
        return None
    body = read_dna(body_dna, lods=[0], blend_shapes=False)

    def shape(dna: DnaFile) -> np.ndarray:
        positions = dna.meshes_for_lod(0)[0].positions.astype(np.float64)
        positions -= positions.mean(axis=0)
        return positions / np.ptp(positions[:, 1])

    target = shape(body)
    distances = {}
    for gender, basis in candidates.items():
        reference = shape(basis)
        if reference.shape == target.shape:
            distances[gender] = float(np.sqrt(((target - reference) ** 2).sum(axis=1).mean()))
    return min(distances, key=distances.__getitem__) if distances else None


def head_live_rule(body_driven: set[str]) -> Callable[[str], bool]:
    """Head joints that move at runtime: the eyeballs and the body joints animation drives
    (spine, clavicles, upper arms, neck, head). Facial expressions are baked into morphs."""

    def live(name: str) -> bool:
        if name.startswith("FACIAL_"):
            return name in EYE_JOINTS
        return name not in body_driven

    return live


def bake_head(
    dna: DnaFile, mapping_path: Path, recipes: Mapping[str, Mapping[str, float]]
) -> tuple[MetaHumanRig, list[MorphTarget], dict[str, Any]]:
    rig = MetaHumanRig(dna)
    mapping = load_arkit_mapping(mapping_path, rig.control_names)
    meshes, frozen = head_bake_meshes(rig, lod=0)
    baker = MorphBaker(rig, meshes, frozen=frozen)
    targets = baker.bake_all({**arkit_shapes(mapping), **viseme_shapes(recipes)})
    info = {
        "arkit_mapping": mapping_path.name,
        "arkit_engine_version": mapping.engine_version,
        "unmatched_control_curves": list(mapping.unmatched_curves),
        "mouth_close": "jawOpen + mouthLipsTogether{UL,UR,DL,DR}=1, minus jawOpen",
        "frozen_meshes": [mesh_kind(rig.dna.mesh_names[m]) for m in frozen],
        "viseme_recipes": {name: dict(controls) for name, controls in recipes.items()},
    }
    return rig, targets, info


def convert_head(
    name: str,
    archive: Path | None = None,
    *,
    mapping_path: Path | None = None,
    recipes: Mapping[str, Mapping[str, float]] = VISEME_RECIPES,
    web_root: Path | None = None,
) -> GlbStats:
    """Bake and write `<web_root>/faces/<name>/head.glb` (default web root: `<archive>/web`)."""
    archive = archive or archive_root()
    source = CharacterSource.find(archive, name)
    mapping_path = mapping_path or archive / "raw" / "arkit" / "arkit_mapping.json"
    dna = read_dna(source.head_dna, lods=[0])
    _, targets, bake_info = bake_head(dna, mapping_path, recipes)
    body_dna = source.dcc / "body.dna"
    if not body_dna.is_file():
        raise ConversionError(f"no body DNA to tell animated joints from correctives ({body_dna})")
    live_rule = head_live_rule(body_driven_joints(read_dna(body_dna, geometry=False)))
    gender = estimate_gender(body_dna, archive)
    meshes = list(dna.lod_meshes[0])
    head = next(m for m in meshes if mesh_kind(dna.mesh_names[m]) == "head")
    space = Space.from_descriptor(dna.descriptor)

    out_dir = (web_root or archive / "web") / "faces" / name
    maps = link_files(source.maps, out_dir / "maps", out_dir)
    manifest = source.dcc / "ExportManifest.json"
    exported = json.loads(manifest.read_text(encoding="utf-8")) if manifest.is_file() else {}
    extras = {
        "kind": "head",
        "preset": name,
        "gender": gender,
        "gender_source": GENDER_SOURCE if gender else "unknown",
        "neck_seam": neck_seam(dna.mesh(head), space, lowest=True),
        "animated_maps": {t.name: t.animated_maps for t in targets if t.animated_maps},
        "maps": maps,
        "source": {
            "dna": source.head_dna.relative_to(archive).as_posix(),
            "dna_sha256": _sha256(source.head_dna),
            "engine_version": exported.get("exportEngineVersion", ""),
        },
        "bake": bake_info,
    }
    return write_glb(
        out_dir / "head.glb",
        dna,
        meshes,
        targets=targets,
        live_joint=live_rule,
        maps=maps,
        extras=extras,
        mesh_name="head",
    )


# ---------------------------------------------------------------------------- bodies


def _same_topology(a: Mesh, b: Mesh) -> bool:
    return (
        len(a.positions) == len(b.positions)
        and np.array_equal(a.layout_positions, b.layout_positions)
        and np.array_equal(a.layout_uvs, b.layout_uvs)
        and np.array_equal(a.face_offsets, b.face_offsets)
        and np.array_equal(a.face_layouts, b.face_layouts)
    )


def _skin_source(archive: Path, gender: str, preferred: str | None) -> CharacterSource | None:
    """A converted character of this gender whose body maps the body GLB can show."""
    names = (
        [preferred]
        if preferred
        else sorted(p.name for p in (archive / "raw" / "characters").iterdir())
    )
    for name in names:
        try:
            source = CharacterSource.find(archive, name)
        except ConversionError:
            continue
        descriptor = read_dna(source.head_dna, geometry=False).descriptor
        if descriptor.gender == gender and (source.dcc / "Maps" / "Body_Basecolor.png").is_file():
            return source
    return None


def convert_body(
    gender: str,
    archive: Path | None = None,
    *,
    skin_from: str | None = None,
    web_root: Path | None = None,
) -> GlbStats:
    """Write `<web_root>/bodies/<gender>/body.glb` from the body basis DNAs."""
    archive = archive or archive_root()
    unit = archive / "raw" / "bodies" / gender
    _require_done(unit)
    file_name = f"Body_{gender}_Body.dna"
    dna = read_dna(unit / "neutral" / file_name, lods=[0], blend_shapes=False)
    (mesh_index,) = dna.lod_meshes[0]
    mesh = dna.mesh(mesh_index)
    space = Space.from_descriptor(dna.descriptor)
    triangles = mesh.layout_positions[mesh.triangles]
    neutral_normals = vertex_normals(mesh.positions.astype(np.float64), triangles)

    targets, joint_deltas, skin_differences = [], {}, {}
    for slider in BODY_SLIDERS:
        for end in ("min", "max"):
            variant_path = unit / f"{slider}_{end}" / file_name
            if not variant_path.is_file():
                raise ConversionError(f"missing body basis {variant_path}")
            variant = read_dna(variant_path, lods=[0], blend_shapes=False)
            shape = variant.mesh(mesh_index)
            if not _same_topology(mesh, shape) or variant.joints.names != dna.joints.names:
                raise ConversionError(f"{variant_path} does not share the neutral body topology")
            positions = shape.positions.astype(np.float64)
            name = f"body_{slider}_{end}"
            targets.append(
                MorphTarget(
                    name=name,
                    spec=ShapeSpec(controls={}),
                    meshes={
                        mesh_index: MeshMorph(
                            positions=positions - mesh.positions,
                            normals=vertex_normals(positions, triangles) - neutral_normals,
                        )
                    },
                    animated_maps={},
                )
            )
            offsets = space.points(variant.joints.translations - dna.joints.translations)
            moved = np.flatnonzero(np.abs(offsets).max(axis=1) > JOINT_DELTA_EPSILON)
            joint_deltas[name] = {
                dna.joints.names[j]: [round(v, 7) for v in offsets[j].tolist()]
                for j in moved.tolist()
            }
            dense_neutral = mesh.skin.dense()[1]
            dense_variant = shape.skin.dense()[1]
            skin_differences[name] = float(np.abs(dense_neutral - dense_variant).max())

    out_dir = (web_root or archive / "web") / "bodies" / gender
    skin = _skin_source(archive, gender, skin_from)
    maps = (
        link_files(sorted((skin.dcc / "Maps").glob("Body_*.png")), out_dir / "maps", out_dir)
        if skin
        else {}
    )
    bodies_json = unit / "bodies.json"
    sliders = (
        json.loads(bodies_json.read_text(encoding="utf-8")).get("sliders", {})
        if bodies_json.is_file()
        else {}
    )
    extras = {
        "kind": "body",
        "gender": gender,
        "neck_seam": neck_seam(mesh, space, lowest=False),
        "body_joint_deltas": joint_deltas,
        "body_joint_deltas_note": (
            "parent-space joint translation offsets (m) of each slider end. Morphs are "
            "bind-space: when a slider moves bones, rebind (recompute inverse bind matrices) "
            "or the change is applied twice"
        ),
        "sliders": {
            slider: {"measurement": info[0], "range_cm": info[1]}
            for slider, info in sliders.items()
        },
        "skin_weight_variation": skin_differences,
        "maps": maps,
        "maps_from": skin.name if skin else None,
        "source": {
            "dna": (unit / "neutral" / file_name).relative_to(archive).as_posix(),
            "dna_sha256": _sha256(unit / "neutral" / file_name),
        },
    }
    return write_glb(
        out_dir / "body.glb",
        dna,
        [mesh_index],
        targets=targets,
        live_joint=body_live_rule(dna),
        maps=maps,
        extras=extras,
        mesh_name="body",
    )


def write_ready_note(archive: Path) -> Path:
    """`web/READY.txt`: every GLB under `web/` with its size and morph target count."""
    web = archive / "web"
    lines = ["# GLBs written by asset-pipeline mh-convert (paths relative to MetaHumanArchive/web)"]
    for path in sorted(web.rglob("*.glb")):
        document, _ = read_glb(path.read_bytes())
        meshes = document.get("meshes", [])
        targets = len(meshes[0].get("extras", {}).get("targetNames", [])) if meshes else 0
        joints = len(document.get("skins", [{}])[0].get("joints", []))
        lines.append(
            f"{path.relative_to(web).as_posix()}\t{path.stat().st_size} bytes\t"
            f"{targets} morph targets\t{joints} joints"
        )
    note = web / "READY.txt"
    web.mkdir(parents=True, exist_ok=True)
    note.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    return note
