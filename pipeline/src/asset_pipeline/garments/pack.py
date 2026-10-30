"""Write a draped garment as an archive unit `raw/outfits/<gender>/WI_<name>/`.

The unit looks like one `ue outfits` wrote (see `asset_pipeline.mh.outfits` `_is_unit`,
`OutfitUnit`): `OutfitBase_<gender>_Outfits.glb`, `outfit.json`, `textures/*.png` and a
`done.json` listing every file with its sha256. The material is an `M_fabric_simpler`
instance taken from an Epic unit (the template): its tiling maps are copied, its tiling
scalars scaled to our UV density, and the four garment maps the master always samples
(`normalmap`, `AO`, `Masks`, `CustomStitch`) are drawn on the pattern UVs here.
"""

import copy
import hashlib
import json
import os
import shutil
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageDraw, ImageFilter

from asset_pipeline.garments import GarmentError
from asset_pipeline.mh.glb import accessor_array, accessor_values, read_glb
from asset_pipeline.mh.outfits import fabric_slots

F64 = NDArray[np.float64]

TEMPLATE = "WI_OA_Crewneckt"
GARMENT_SLOTS = ("normalmap", "AO", "Masks", "CustomStitch")
TILING_SCALARS = ("DetailTex_UVTtiling", "MacroTex_UvTiling")  # also their B_ variants
MAP_SIZE = 4096
CUSTOM_ROOT = "/Game/Custom"  # not /Game/Fab: mh-prune reads that as a Fab package


@dataclass(frozen=True, eq=False)
class GarmentLines:
    """Polylines in UV space (each (N, 2)) the garment maps are drawn from."""

    seams: list[F64] = field(default_factory=list)  # sewn seams: a groove and a shadow
    edges: list[F64] = field(default_factory=list)  # finished edges: wear and a slight roll
    stitches: list[F64] = field(default_factory=list)  # topstitching
    ribs: list[F64] = field(default_factory=list)  # knit rib wales (a neckband's grooves)
    fades: list[F64] = field(default_factory=list)  # worn, washed-out bands (denim seams)
    frays: list[F64] = field(default_factory=list)  # loose threads of a cut-off hem


@dataclass(frozen=True)
class Look:
    """Changes to the template's material: tiling maps taken from other units' files and
    scalars set outright (tiling already in our UV density)."""

    textures: Mapping[str, Path] = field(default_factory=dict)  # slot -> source file
    scalars: Mapping[str, float] = field(default_factory=dict)


def metres_per_uv(glb: Path) -> float:
    """Median 3D edge length over UV edge length of a GLB's first mesh."""
    document, binary = read_glb(glb.read_bytes())
    ratios = []
    for primitive in document["meshes"][0]["primitives"]:
        positions = accessor_values(document, binary, primitive["attributes"]["POSITION"])
        uvs = accessor_values(document, binary, primitive["attributes"]["TEXCOORD_0"])
        triangles = accessor_array(document, binary, primitive["indices"]).reshape(-1, 3)
        a, b = triangles[:, 0], triangles[:, 1]
        uv_length = np.linalg.norm(uvs[b] - uvs[a], axis=1)
        keep = uv_length > 1e-6
        ratios.append(np.linalg.norm(positions[b] - positions[a], axis=1)[keep] / uv_length[keep])
    return float(np.median(np.concatenate(ratios)))


def _mask(lines: Sequence[F64], size: int, width: float, blur: float) -> F64:
    """Lines rasterised on a size x size UV image, `width` and `blur` in pixels, 0..1."""
    image = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(image)
    for line in lines:
        points = [(float(u) * size, float(v) * size) for u, v in line]
        draw.line(points, fill=255, width=max(1, round(width)), joint="curve")
    if blur > 0:
        image = image.filter(ImageFilter.GaussianBlur(float(blur)))
    return np.asarray(image, np.float64) / 255.0


def _normal_from_height(height: F64, strength: float) -> NDArray[np.uint8]:
    """Tangent-space normal map (OpenGL, +y up the image is -v) from a height field."""
    dy, dx = np.gradient(height)
    normal = np.stack([-dx * strength, dy * strength, np.ones_like(height)], -1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    return np.round((normal * 0.5 + 0.5) * 255).astype(np.uint8)


def garment_maps(
    lines: GarmentLines, uv_metres: float, size: int = MAP_SIZE
) -> dict[str, Image.Image]:
    """normalmap, AO (occlusion R, roughness G, metal B, material C mask A), Masks (wear R,
    colour 2 G, material B region B) and CustomStitch, all linear."""
    px = float(size / uv_metres / 1000.0)  # pixels per millimetre of fabric

    groove = _mask(lines.seams, size, 1.2 * px, 1.0 * px)
    shadow = _mask(lines.seams, size, 3.0 * px, 3.0 * px)
    edge = _mask(lines.edges, size, 2.0 * px, 4.0 * px)
    stitch = _mask(lines.stitches, size, 0.6 * px, 0.25 * px)
    rib = _mask(lines.ribs, size, 0.8 * px, 0.35 * px) if lines.ribs else 0.0 * groove
    fade = _mask(lines.fades, size, 5.0 * px, 6.0 * px) if lines.fades else 0.0 * groove
    fray = _mask(lines.frays, size, 0.5 * px, 0.2 * px) if lines.frays else 0.0 * groove

    height = -groove + 0.5 * edge - 0.4 * stitch - 0.5 * rib + 0.3 * fray
    normal = _normal_from_height(height, strength=2.0)
    ones = np.ones((size, size))
    occlusion = np.clip(1.0 - 0.35 * shadow - 0.15 * stitch - 0.12 * rib, 0.0, 1.0)
    wear = np.clip(0.55 + 0.3 * edge + 0.3 * fade + 0.45 * fray, 0.0, 1.0)

    def rgba(*channels: F64) -> Image.Image:
        return Image.fromarray(np.round(np.stack(channels, -1) * 255).astype(np.uint8), "RGBA")

    return {
        "normalmap": Image.fromarray(
            np.dstack([normal, np.full((size, size, 1), 255, np.uint8)]), "RGBA"
        ),
        "AO": rgba(occlusion, ones, 0 * ones, ones),
        "Masks": rgba(wear, 0 * ones, 0 * ones, ones),
        "CustomStitch": Image.fromarray(
            np.round(np.clip(stitch, 0, 1) * 255).astype(np.uint8), "L"
        ),
    }


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def outfit_info(
    template: Mapping[str, Any],
    name: str,
    gender: str,
    garment_files: Mapping[str, str],
    tiling_scale: float,
    switches: Mapping[str, bool],
    look: Look | None = None,
) -> dict[str, Any]:
    """`outfit.json` for our unit: the template's single material renamed, its garment maps
    replaced by ours, its tiling scaled and the `look` applied."""
    materials = template.get("materials", {})
    if len(materials) != 1:
        raise GarmentError(f"{TEMPLATE}: expected one material, found {len(materials)}")
    material = copy.deepcopy(next(iter(materials.values())))
    material.setdefault("static_switches", {}).update(switches)
    scalars = material.setdefault("scalars", {})
    for key in list(scalars):
        if key.removeprefix("B_") in TILING_SCALARS:
            scalars[key] = float(scalars[key]) * tiling_scale
    look = look or Look()
    scalars.update(look.scalars)
    sampled = fabric_slots(material)
    folder = f"{CUSTOM_ROOT}/{name}"
    textures = {}
    for slot, source in look.textures.items():
        reference = f"{folder}/Textures/T_{name}_{slot}.T_{name}_{slot}"
        material.setdefault("textures", {})[slot] = reference
        with Image.open(source) as image:
            size = list(image.size)
        textures[reference] = {"file": source.name, "size": size, "srgb": False}
    for slot, reference in list(material.get("textures", {}).items()):
        if slot in look.textures:
            continue
        if slot in garment_files:
            asset = f"{folder}/Textures/T_{name}_{slot}"
            material["textures"][slot] = f"{asset}.T_{name}_{slot}"
            textures[material["textures"][slot]] = {
                "file": garment_files[slot],
                "size": [MAP_SIZE, MAP_SIZE],
                "srgb": False,
            }
        elif slot in sampled:
            if reference not in template.get("textures", {}):
                raise GarmentError(
                    f"{TEMPLATE}: {slot} samples {reference}, which was not exported"
                )
            textures[reference] = copy.deepcopy(template["textures"][reference])
    instance = f"{folder}/MI_{name}.MI_{name}"
    item = f"{folder}/WI_{name}.WI_{name}"
    mesh = f"OutfitBase_{gender}_Outfits"
    return {
        "build_warning": None,
        "gender": gender,
        "item": item,
        "item_properties": {"principal_asset": None, "thumbnail_name": "", "thumbnail_image": None},
        "materials": {instance: material},
        "meshes": {mesh: {"glb": f"{mesh}.glb"}},
        "parameters": [],
        "textures": textures,
        "source": "asset_pipeline.garments",
    }


def write_unit(
    archive: Path,
    gender: str,
    name: str,
    glb: Path,
    lines: GarmentLines,
    uv_metres: float,
    switches: Mapping[str, bool] | None = None,
    template_unit: str = TEMPLATE,
    look: Look | None = None,
) -> Path:
    """Write `raw/outfits/<gender>/WI_<name>/` atomically (via `.partial`), its material
    taken from the Epic unit `template_unit`."""
    root = archive / "raw" / "outfits" / gender
    template_dir = root / template_unit
    if not (template_dir / "outfit.json").is_file():
        raise GarmentError(f"template unit {template_dir} is missing")
    template = json.loads((template_dir / "outfit.json").read_text(encoding="utf-8"))
    template_glb = template_dir / f"OutfitBase_{gender}_Outfits.glb"
    tiling_scale = uv_metres / metres_per_uv(template_glb)

    final = root / f"WI_{name}"
    partial = final.with_name(final.name + ".partial")
    if partial.exists():
        shutil.rmtree(partial)
    (partial / "textures").mkdir(parents=True)

    shutil.copyfile(glb, partial / f"OutfitBase_{gender}_Outfits.glb")
    garment_files = {}
    for slot, image in garment_maps(lines, uv_metres).items():
        file = f"T_{name}_{slot}.png"
        image.save(partial / "textures" / file, optimize=False, compress_level=6)
        garment_files[slot] = file
    info = outfit_info(template, name, gender, garment_files, tiling_scale, switches or {}, look)
    for source in (look or Look()).textures.values():
        shutil.copyfile(source, partial / "textures" / source.name)
    for reference, entry in info["textures"].items():
        source = template_dir / "textures" / str(entry["file"])
        target = partial / "textures" / str(entry["file"])
        if not target.exists():
            if not source.is_file():
                raise GarmentError(f"template texture {reference} has no file {source}")
            shutil.copyfile(source, target)
    (partial / "outfit.json").write_text(
        json.dumps(info, indent=2, sort_keys=True), encoding="utf-8"
    )

    files = sorted(p for p in partial.rglob("*") if p.is_file())
    done = {
        "completed_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "file_count": len(files),
        "files": [
            {
                "bytes": p.stat().st_size,
                "path": p.relative_to(partial).as_posix(),
                "sha256": _sha256(p),
            }
            for p in files
        ],
    }
    (partial / "done.json").write_text(json.dumps(done, indent=2), encoding="utf-8")
    if final.exists():
        shutil.rmtree(final)
    os.replace(partial, final)
    return final
