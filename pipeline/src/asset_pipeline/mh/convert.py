"""Convert archived MetaHuman exports into web assets (`MetaHumanArchive/raw` -> `web`).

- `convert_head(name)`: `raw/characters/<Name>/dcc/<Name>/head.dna` -> `web/faces/<Name>/`
  `head.glb` (LOD0 meshes, the 52 ARKit shapes and 15 visemes baked through RigLogic,
  wrinkle-map weights per target and the wrinkle-mask channel of every region, the neck
  seam and the DNA position index), the teeth and eyelash KTX2 maps it references, and a
  portrait thumbnail.
- `convert_skin(name)` / `convert_iris(name)`: the preset's skin and iris maps as KTX2
  (`textures.py`) plus their manifest entries.
- `convert_body(gender)`: `raw/bodies/<gender>/neutral` -> `web/bodies/<gender>/body.glb`
  with the full body skeleton and `body_<slider>_<min|max>` targets from the basis DNAs,
  plus the joint translation offsets of each slider end.

GLBs carry geometry, skins and morphs only; skins and irises are chosen at runtime from the
manifest. Only units with a `done.json` are converted. Every function writes its outputs
and returns what the manifest needs; `build.py` decides what is out of date.
"""

import json
import os
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

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
from asset_pipeline.mh.seams import neck_seam
from asset_pipeline.mh.stamps import fingerprint
from asset_pipeline.mh.textures import (
    MASK_CHANNELS,
    MASK_ORDER,
    PresetMaps,
    TextureError,
    convert_head_maps,
    estimate_tone,
    remove_tree,
)
from asset_pipeline.mh.textures import convert_iris as encode_iris
from asset_pipeline.mh.textures import convert_skin as encode_skin
from asset_pipeline.mh.visemes import VISEME_RECIPES
from asset_pipeline.mh.wrinkles import wrinkle_channels

DEFAULT_ARCHIVE = Path.home() / "MetaHumanArchive"
EYE_JOINTS = ("FACIAL_L_Eye", "FACIAL_R_Eye")
# Twist joints stay live although the body rig drives them: undriven they still move rigidly
# with their parent, and a runtime twist solver can use them.
TWIST_JOINT = re.compile(r"_twist_\d+_")
BODY_SLIDERS = ("height", "weight", "muscle", "chest", "waist", "hips", "shoulders")
JOINT_DELTA_EPSILON = 1e-6  # metres
GENDERS_FILE = "characters_genders.json"
THUMBNAIL_SIZE = 384


class ConversionError(RuntimeError):
    """An input is missing or incomplete (no done.json, topology mismatch, ...)."""


def archive_root() -> Path:
    return Path(os.environ.get("MH_ARCHIVE", str(DEFAULT_ARCHIVE)))


def _require_done(unit: Path) -> None:
    if not (unit / "done.json").is_file():
        raise ConversionError(f"{unit} has no done.json (export incomplete)")


def web_path(path: Path, web_root: Path) -> str:
    return path.relative_to(web_root).as_posix()


# ---------------------------------------------------------------------------- sources


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
    def body_dna(self) -> Path:
        return self.dcc / "body.dna"

    @property
    def maps(self) -> PresetMaps:
        return PresetMaps(self.name, self.unit)

    @property
    def done(self) -> Path:
        return self.unit / "done.json"


def list_characters(archive: Path) -> list[str]:
    """Presets whose export finished (`done.json`), skipping `*.partial` folders."""
    root = archive / "raw" / "characters"
    if not root.is_dir():
        return []
    return sorted(
        p.name
        for p in root.iterdir()
        if p.is_dir() and not p.name.endswith(".partial") and (p / "done.json").is_file()
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
GENDER_FILE_SOURCE = f"raw/{GENDERS_FILE} (MetaHuman preset body type)"


def estimate_gender(body_dna: Path, archive: Path) -> str | None:
    """Best guess of a character's body gender from its shape (fallback when the presets'
    gender list has no entry); the DNA descriptors all read "female, 24". Compares the
    character body with the neutral basis bodies after removing position and height, so a
    tall woman does not read as a man. Returns None when the basis bodies are missing."""
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


def gender_record(archive: Path, name: str) -> dict[str, Any] | None:
    """The preset's entry in `raw/characters_genders.json`, if any."""
    path = archive / "raw" / GENDERS_FILE
    if not path.is_file():
        return None
    entry = json.loads(path.read_text(encoding="utf-8")).get(name)
    return entry if isinstance(entry, dict) else None


ANDROGYNOUS_BAND = 0.3
"""Masculine/feminine body values closer to 0 than this say little: Asha (-0.13) is a woman
by her preset's look, yet the sign alone made her a man. Inside the band the body's shape
decides (`estimate_gender`), which in turn misreads clear cases such as Aoi (-0.59)."""


def axis_gender(record: dict[str, Any] | None) -> str | None:
    """Gender from a preset's masculine/feminine body value, None when it is too close to
    the middle of the axis to tell (or the record has neither value nor gender)."""
    if not record:
        return None
    axis = record.get("masculine_feminine")
    if isinstance(axis, int | float):
        if abs(axis) < ANDROGYNOUS_BAND:
            return None
        return "female" if axis > 0 else "male"
    gender = record.get("gender")
    return str(gender) if gender in ("female", "male") else None


def preset_gender(archive: Path, name: str, body_dna: Path) -> tuple[str | None, str]:
    """(gender, where it came from): the presets' body values first, the shape estimate for
    presets near the middle of the masculine/feminine axis or missing from the list."""
    gender = axis_gender(gender_record(archive, name))
    if gender:
        return gender, GENDER_FILE_SOURCE
    estimate = estimate_gender(body_dna, archive)
    return estimate, GENDER_SOURCE if estimate else "unknown"


def head_live_rule(body_driven: set[str]) -> Callable[[str], bool]:
    """Head joints that move at runtime: the eyeballs and the body joints animation drives
    (spine, clavicles, upper arms, neck, head). Facial expressions are baked into morphs."""

    def live(name: str) -> bool:
        if name.startswith("FACIAL_"):
            return name in EYE_JOINTS
        return name not in body_driven

    return live


# ---------------------------------------------------------------------------- heads


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


def wrinkle_extras(dna: DnaFile) -> dict[str, Any]:
    """How the runtime finds a region's mask channel (see `wrinkles.py`)."""
    channels = wrinkle_channels(
        dna.behavior.animated_map_names, [(name, MASK_CHANNELS[name]) for name in MASK_ORDER]
    )
    return {
        "masks": list(MASK_ORDER),
        "regions": {region: list(slot) for region, slot in channels.items()},
        "note": (
            "animated_maps keys are <texture>.<region>. head_cm<n>_color blends "
            "skin.face.wrinkleColor[n-1] and head_wm<n>_normal blends "
            "skin.face.wrinkleNormal[n-1] over the base maps, by sum(morph weight x map "
            "weight) times channel `regions[region][1]` (0=R..3=A) of "
            "skin.face.wrinkleMasks[regions[region][0]]"
        ),
    }


def write_thumbnail(source: Path, output: Path) -> bool:
    """A small WebP of the export's portrait (`dcc/<Name>/<Name>.png`), when it has one.
    An existing thumbnail (the web app's thumbnail bench renders its own) is kept."""
    if output.is_file():
        return True
    if not source.is_file():
        return False
    with Image.open(source) as image:
        portrait = image.convert("RGBA")
        portrait.thumbnail((THUMBNAIL_SIZE, THUMBNAIL_SIZE), Image.Resampling.LANCZOS)
        output.parent.mkdir(parents=True, exist_ok=True)
        portrait.save(output, "WEBP", quality=88, method=6)
    return True


@dataclass(frozen=True)
class HeadResult:
    stats: GlbStats
    face: dict[str, Any]  # manifest face entry without defaultSkin / defaultIris
    outputs: tuple[Path, ...]
    info: dict[str, Any]


def head_maps_source(archive: Path, name: str, gender: str | None) -> PresetMaps | None:
    """The preset whose teeth and eyelash maps a head uses: its own, else the first complete
    preset of the same gender (exports without DCC maps)."""
    own = CharacterSource.find(archive, name).maps
    if own.has_head_maps:
        return own
    for other in list_characters(archive):
        source = CharacterSource.find(archive, other).maps
        same = gender is None or axis_gender(gender_record(archive, other)) == gender
        if source.has_head_maps and same:
            return source
    return None


def head_fingerprint(archive: Path, name: str, mapping_path: Path, compress: bool) -> str:
    source = CharacterSource.find(archive, name)
    return fingerprint(
        "head-v3",
        source.done,
        mapping_path,
        VISEME_RECIPES,
        gender_record(archive, name),
        compress,
    )


def convert_head(
    name: str,
    archive: Path | None = None,
    *,
    mapping_path: Path | None = None,
    recipes: Mapping[str, Mapping[str, float]] = VISEME_RECIPES,
    web_root: Path | None = None,
    compress: bool = True,
    head_maps: bool = True,
) -> HeadResult:
    """Bake and write `<web_root>/faces/<name>/` (default web root: `<archive>/web`).
    `head_maps=False` skips the teeth and eyelash KTX2 maps (tests, quick looks)."""
    archive = archive or archive_root()
    source = CharacterSource.find(archive, name)
    web = web_root or archive / "web"
    mapping_path = mapping_path or archive / "raw" / "arkit" / "arkit_mapping.json"
    if not source.body_dna.is_file():
        raise ConversionError(
            f"no body DNA to tell animated joints from correctives ({source.body_dna})"
        )
    dna = read_dna(source.head_dna, lods=[0])
    _, targets, bake_info = bake_head(dna, mapping_path, recipes)
    live_rule = head_live_rule(body_driven_joints(read_dna(source.body_dna, geometry=False)))
    gender, gender_source = preset_gender(archive, name, source.body_dna)
    meshes = list(dna.lod_meshes[0])
    head = next(m for m in meshes if mesh_kind(dna.mesh_names[m]) == "head")
    space = Space.from_descriptor(dna.descriptor)

    out_dir = web / "faces" / name
    remove_tree(out_dir / "maps", web)  # PNG links of the first converter version
    outputs: list[Path] = []
    textures: dict[str, str] = {}
    maps_from = head_maps_source(archive, name, gender) if head_maps else None
    if maps_from is not None:
        for file_name in convert_head_maps(maps_from, out_dir):
            textures[file_name] = file_name
            outputs.append(out_dir / file_name)
    thumbnail = out_dir / "thumbnail.webp"
    has_thumbnail = write_thumbnail(source.dcc / f"{name}.png", thumbnail)
    if has_thumbnail:
        outputs.append(thumbnail)

    manifest = source.dcc / "ExportManifest.json"
    exported = json.loads(manifest.read_text(encoding="utf-8")) if manifest.is_file() else {}
    extras = {
        "kind": "head",
        "preset": name,
        "gender": gender,
        "gender_source": gender_source,
        "neck_seam": neck_seam(dna.mesh(head), space, lowest=True),
        "animated_maps": {t.name: t.animated_maps for t in targets if t.animated_maps},
        "wrinkle_masks": wrinkle_extras(dna),
        "textures": {
            "teeth_eyelashes_from": maps_from.name if maps_from else None,
            "skin": "manifest skins[] (face maps); eyes: manifest irises[]",
        },
        "source": {
            "dna": source.head_dna.relative_to(archive).as_posix(),
            "done_sha256": fingerprint(source.done),
            "engine_version": exported.get("exportEngineVersion", ""),
        },
        "bake": bake_info,
    }
    stats = write_glb(
        out_dir / "head.glb",
        dna,
        meshes,
        targets=targets,
        live_joint=live_rule,
        textures=textures,
        extras=extras,
        mesh_name="head",
        compress=compress,
    )
    outputs.append(stats.path)
    face: dict[str, Any] = {
        "id": f"face.{name}",
        "label": name,
        "gender": gender,
        "head": web_path(stats.path, web),
    }
    if has_thumbnail:
        face["thumbnail"] = web_path(thumbnail, web)
    info: dict[str, Any] = {
        "face": face,
        "glb_bytes": stats.size,
        "glb_raw_bytes": stats.raw_size,
        "gender_source": gender_source,
        "maps_from": maps_from.name if maps_from else None,
    }
    if not source.maps.complete:
        # Incomplete exports have no skin of their own; the manifest borrows the skin
        # closest in tone.
        info["tone_estimate"] = estimate_tone(source.maps, dna)
    return HeadResult(stats=stats, face=face, outputs=tuple(outputs), info=info)


# ---------------------------------------------------------------------------- skins


def skin_fingerprint(archive: Path, name: str) -> str:
    # v2: face albedo takes the DCC bake in the neck/chest flap and its low frequencies.
    # v3: 2K face cavity; maps whose own recipe did not change are reused (TextureCache).
    return fingerprint("skin-v3", CharacterSource.find(archive, name).done)


def iris_fingerprint(archive: Path, name: str) -> str:
    # v2: the eye normal map is already OpenGL and is no longer flipped.
    return fingerprint("iris-v2", CharacterSource.find(archive, name).done)


def convert_skin(
    name: str, archive: Path | None = None, *, web_root: Path | None = None
) -> dict[str, Any]:
    """Encode `skins/<name>/` and return the manifest skin entry (with `stats`)."""
    archive = archive or archive_root()
    source = CharacterSource.find(archive, name)
    web = web_root or archive / "web"
    try:
        dna = read_dna(source.head_dna, lods=[0], blend_shapes=False)
        return encode_skin(source.maps, dna, web)
    except TextureError as error:
        raise ConversionError(str(error)) from error


def convert_iris(
    name: str, archive: Path | None = None, *, web_root: Path | None = None
) -> dict[str, Any]:
    archive = archive or archive_root()
    source = CharacterSource.find(archive, name)
    web = web_root or archive / "web"
    maps = source.maps
    missing = [s for s in ("Eyes_Color", "Eyes_Normal") if not (maps.maps / f"{s}.png").is_file()]
    if missing:
        raise ConversionError(f"{name}: missing eye maps {missing}")
    return encode_iris(maps, web)


# ---------------------------------------------------------------------------- bodies


def _same_topology(a: Mesh, b: Mesh) -> bool:
    return (
        len(a.positions) == len(b.positions)
        and np.array_equal(a.layout_positions, b.layout_positions)
        and np.array_equal(a.layout_uvs, b.layout_uvs)
        and np.array_equal(a.face_offsets, b.face_offsets)
        and np.array_equal(a.face_layouts, b.face_layouts)
    )


# Slider values (-1..1) of the creator's body presets. Slim lowers fat and soft volume,
# athletic trades fat for muscle and shoulders, curvy (female only) widens hips and chest
# over a narrower waist.
BODY_PRESETS: dict[str, dict[str, dict[str, float]]] = {
    "female": {
        "slim": {"weight": -0.6, "muscle": -0.2, "chest": -0.3, "waist": -0.4, "hips": -0.3},
        "average": {},
        "athletic": {"weight": -0.3, "muscle": 0.7, "chest": 0.1, "waist": -0.3, "shoulders": 0.4},
        "curvy": {"weight": 0.2, "chest": 0.5, "waist": -0.2, "hips": 0.7},
    },
    "male": {
        "slim": {"weight": -0.6, "muscle": -0.2, "chest": -0.3, "waist": -0.4, "shoulders": -0.2},
        "average": {},
        "athletic": {"weight": -0.3, "muscle": 0.8, "chest": 0.4, "waist": -0.3, "shoulders": 0.6},
    },
}


def body_fingerprint(archive: Path, gender: str, compress: bool) -> str:
    return fingerprint("body-v3", archive / "raw" / "bodies" / gender / "done.json", compress)


def body_entry(gender: str, glb: str) -> dict[str, Any]:
    presets = BODY_PRESETS.get(gender, {"average": {}})
    return {
        "gender": gender,
        "glb": glb,
        "sliders": [{"id": s, "min": -1.0, "max": 1.0, "default": 0.0} for s in BODY_SLIDERS],
        "presets": {
            name: {s: float(values.get(s, 0.0)) for s in BODY_SLIDERS}
            for name, values in presets.items()
        },
    }


def convert_body(
    gender: str,
    archive: Path | None = None,
    *,
    web_root: Path | None = None,
    compress: bool = True,
) -> tuple[GlbStats, dict[str, Any]]:
    """Write `<web_root>/bodies/<gender>/body.glb` from the body basis DNAs; returns the GLB
    stats and the manifest body entry."""
    archive = archive or archive_root()
    unit = archive / "raw" / "bodies" / gender
    _require_done(unit)
    web = web_root or archive / "web"
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

    out_dir = web / "bodies" / gender
    remove_tree(out_dir / "maps", web)  # PNG links of the first converter version
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
        "textures": "manifest skins[] (body maps)",
        "source": {
            "dna": (unit / "neutral" / file_name).relative_to(archive).as_posix(),
            "done_sha256": fingerprint(unit / "done.json"),
        },
    }
    stats = write_glb(
        out_dir / "body.glb",
        dna,
        [mesh_index],
        targets=targets,
        live_joint=body_live_rule(dna),
        extras=extras,
        mesh_name="body",
        compress=compress,
    )
    return stats, body_entry(gender, web_path(stats.path, web))


def write_ready_note(archive: Path, web_root: Path | None = None) -> Path:
    """`web/READY.txt`: every GLB under `web/` with its size and morph target count."""
    web = web_root or archive / "web"
    lines = ["# GLBs written by asset-pipeline mh-convert (paths relative to MetaHumanArchive/web)"]
    for path in sorted(web.rglob("*.glb")):
        document, _ = read_glb(path.read_bytes())
        meshes = document.get("meshes", [])
        targets = len(meshes[0].get("extras", {}).get("targetNames", [])) if meshes else 0
        skins = document.get("skins", [])
        joints = len(skins[0].get("joints", [])) if skins else 0
        lines.append(
            f"{path.relative_to(web).as_posix()}\t{path.stat().st_size} bytes\t"
            f"{targets} morph targets\t{joints} joints"
        )
    note = web / "READY.txt"
    web.mkdir(parents=True, exist_ok=True)
    note.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    return note
