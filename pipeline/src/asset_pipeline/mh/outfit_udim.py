"""UDIM garments: pack the tiles a garment uses into one texture atlas and move its UVs there.

Some Fab garments (the Khaos MDF items) paint their maps as UDIM tiles: UV0 runs past 1 and
tile `1001 + u + 10 v` is a separate image, exported as `textures/<map>.<tile>.png` and listed
under `udim` in outfit.json. Unreal's material bake renders UV 0..1 only, so the baked GLB
holds tile 1001 alone and every other tile would sample it on the web. Here each tile the
garment's triangles use is rebuilt from the raw tiles with the material's own math at one
cell of `CELL` pixels (what every other outfit map gets after the converter's downsizing, so
the texel density stays the same), the cells are packed into a grid, and every vertex UV is
moved into its tile's cell.

Khaos AssetMaster recipe (read from the `M_KhaosMDF*_AssetMaster_Opaque` graphs and their
`MF_*_AssetMaster_Masks` / `_ScalarModifier` functions; checked against Unreal's tile-1001
bake of KhaosMDF255/322/492/503: colour within 0.3-5 levels of 255 on average, roughness and
metallic within 2-6, occlusion within 7):

- zones `M1..M8` mask channels R, G, B, A of `Masks 1 - 4`, then of `Masks 5 - 8`;
- base colour = `Base Color` (sRGB) times `lerp(1, Mi Tint, mask_i)` for every zone;
- specular / roughness / metallic start as `SRMD` R, G, B and go through every zone's
  `Mi <X> Modifier` in order: 0.5 keeps the value, above 0.5 lerps it toward 1, below 0.5
  scales it toward 0 (`lerp(0, value, 2 m)`), each blended in by the zone mask;
- occlusion = `Bent Normal/AO` alpha; normal = `Normal` (two-channel source: Z rebuilt).

Only `Texture Set Index` 0 is handled (the set's tiles are the mesh's own); other sets keep
the baked tile-1001 maps.
"""

import hashlib
import json
import math
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray
from PIL import Image

from asset_pipeline.mh.textures import linear_to_srgb, srgb_to_linear

F32 = NDArray[np.float32]
F64 = NDArray[np.float64]
I64 = NDArray[np.int64]
U8 = NDArray[np.uint8]

RECIPE = "khaos-assetmaster-v1"  # part of every atlas map's content hash
FIRST_TILE = 1001
CELL = 2048  # pixels per tile: outfits.ITEM_TEXTURE_SIZE
MAX_SIDE = 4096  # widest atlas sent to the web

KHAOS_TEXTURES = ("Base Color", "Masks 1 - 4", "SRMD", "Normal", "Bent Normal/AO")
KHAOS_MASKS = ("Masks 1 - 4", "Masks 5 - 8")
_ZONE = re.compile(r"^M([1-8]) ")
_COLOR = re.compile(r"([RGBA])=(-?[0-9.]+(?:[eE][-+]?\d+)?)")
NEUTRAL = 0.5  # scalar modifier that leaves a value unchanged

# Fill for atlas cells no tile lands in (only reached through mip filtering at cell edges).
FILL = {"color": (128, 128, 128), "data": (255, 255, 0), "normal": (128, 128, 255)}


class UdimError(ValueError):
    """A UDIM garment cannot be packed."""


# ---------------------------------------------------------------------------- tiles


def tile_number(column: int, row: int) -> int:
    """Mari tile number of UV cell (column, row): 1001 + u + 10 v."""
    if not 0 <= column < 10 or row < 0:
        raise UdimError(f"UV cell ({column}, {row}) is outside the UDIM range")
    return FIRST_TILE + column + 10 * row


def tile_cell(tile: int) -> tuple[int, int]:
    """UV cell (column, row) of a Mari tile number."""
    index = tile - FIRST_TILE
    if index < 0:
        raise UdimError(f"{tile} is not a UDIM tile")
    return index % 10, index // 10


def triangle_tiles(uvs: F64, triangles: I64) -> I64:
    """UDIM tile of every triangle, from its UV centroid (islands never cross tiles)."""
    centroids = uvs[triangles].mean(axis=1)
    cells = np.floor(centroids).astype(np.int64)
    if (cells[:, 0] < 0).any() or (cells[:, 0] > 9).any() or (cells[:, 1] < 0).any():
        raise UdimError("UVs outside the UDIM range (u in 0..10, v >= 0)")
    return FIRST_TILE + cells[:, 0] + 10 * cells[:, 1]


# ---------------------------------------------------------------------------- atlas


@dataclass(frozen=True)
class AtlasLayout:
    """Tiles packed row by row into a `columns` x `rows` grid of `cell`-pixel squares."""

    tiles: tuple[int, ...]
    columns: int
    rows: int
    cell: int

    @property
    def width(self) -> int:
        return self.columns * self.cell

    @property
    def height(self) -> int:
        return self.rows * self.cell

    def position(self, tile: int) -> tuple[int, int]:
        """Grid (column, row) of a tile's cell."""
        index = self.tiles.index(tile)
        return index % self.columns, index // self.columns

    def as_dict(self) -> dict[str, Any]:
        return {
            "tiles": list(self.tiles),
            "grid": [self.columns, self.rows],
            "cell": self.cell,
            "size": [self.width, self.height],
        }


def plan_atlas(tiles: Sequence[int], cell: int = CELL, max_side: int = MAX_SIDE) -> AtlasLayout:
    """Smallest grid that keeps `cell` pixels per tile within `max_side` (halving the cell
    only when the tiles do not fit: four 2048-px tiles still do at 4096)."""
    ordered = tuple(sorted(set(tiles)))
    if not ordered:
        raise UdimError("no tiles to pack")
    while cell >= 1:
        columns = min(len(ordered), max(1, max_side // cell))
        rows = math.ceil(len(ordered) / columns)
        if rows * cell <= max_side:
            return AtlasLayout(ordered, columns, rows, cell)
        cell //= 2
    raise UdimError(f"{len(ordered)} tiles do not fit a {max_side}-px atlas")


@dataclass
class Remapped:
    """A part's mesh with UVs in the atlas: `source` maps every vertex to the vertex it was
    copied from (vertices on triangles of two tiles are split, `split` of them)."""

    uvs: F64
    triangles: I64
    source: I64
    split: int


def remap_uvs(uvs: F64, triangles: I64, layout: AtlasLayout) -> Remapped:
    """Move every vertex UV from its tile into the tile's atlas cell (clamped to the cell)."""
    corner_tile = np.repeat(triangle_tiles(uvs, triangles), 3)
    corner_vertex = triangles.ravel()
    count = len(uvs)
    home = np.full(count, -1, dtype=np.int64)
    home[corner_vertex[::-1]] = corner_tile[::-1]  # the first triangle that uses a vertex
    loose = home < 0
    if loose.any():  # vertices no triangle uses: their own cell, else the first tile
        own = np.floor(uvs[loose]).astype(np.int64)
        guess = FIRST_TILE + own[:, 0] + 10 * own[:, 1]
        home[loose] = np.where(np.isin(guess, layout.tiles), guess, layout.tiles[0])
    stray = corner_tile != home[corner_vertex]
    pairs = np.stack([corner_vertex[stray], corner_tile[stray]], axis=1)
    extra, inverse = np.unique(pairs, axis=0, return_inverse=True)
    corners = corner_vertex.copy()
    corners[stray] = count + inverse.ravel()
    source = np.concatenate([np.arange(count, dtype=np.int64), extra[:, 0]])
    tiles = np.concatenate([home, extra[:, 1]])
    unknown = sorted(set(tiles.tolist()) - set(layout.tiles))
    if unknown:
        raise UdimError(f"tiles {unknown} are not in the atlas")
    cells = np.array([tile_cell(int(t)) for t in tiles], dtype=np.float64).reshape(-1, 2)
    grid = np.array([layout.position(int(t)) for t in tiles], dtype=np.float64).reshape(-1, 2)
    local = np.clip(uvs[source] - cells, 0.0, 1.0)
    moved = (grid + local) / np.array([layout.columns, layout.rows], dtype=np.float64)
    return Remapped(moved, corners.reshape(-1, 3), source, len(extra))


def compose_atlas(layout: AtlasLayout, cells: Mapping[int, U8], fill: Sequence[int]) -> U8:
    """The atlas image: every tile's `cell`-pixel map at its grid position."""
    channels = len(fill)
    atlas = np.empty((layout.height, layout.width, channels), dtype=np.uint8)
    atlas[...] = np.asarray(fill, dtype=np.uint8)
    for tile, pixels in cells.items():
        if pixels.shape[:2] != (layout.cell, layout.cell):
            raise UdimError(f"tile {tile} map is {pixels.shape[:2]}, not {layout.cell} px")
        column, row = layout.position(tile)
        y, x = row * layout.cell, column * layout.cell
        atlas[y : y + layout.cell, x : x + layout.cell] = pixels.reshape(
            layout.cell, layout.cell, channels
        )
    return atlas


# ---------------------------------------------------------------------------- resampling


def area_resize(values: F32, size: int) -> F32:
    """Square `(H, W, C)` float map to `size` px: box average down, bilinear up."""
    height, width = values.shape[:2]
    if (height, width) == (size, size):
        return values
    if height >= size and height % size == 0 and width % size == 0:
        fy, fx = height // size, width // size
        shaped = values.reshape(size, fy, size, fx, values.shape[2])
        return shaped.mean(axis=(1, 3), dtype=np.float32)
    method = Image.Resampling.BOX if height > size else Image.Resampling.BILINEAR
    return np.stack(
        [
            np.asarray(Image.fromarray(values[..., c]).resize((size, size), method))
            for c in range(values.shape[2])
        ],
        axis=-1,
    ).astype(np.float32)


def _unit_float(pixels: U8) -> F32:
    channels = pixels[..., None] if pixels.ndim == 2 else pixels
    return channels.astype(np.float32) / 255.0


def _to_u8(values: F32) -> U8:
    return np.round(np.clip(values, 0.0, 1.0) * 255.0).astype(np.uint8)


# ---------------------------------------------------------------------------- Khaos recipe


@dataclass(frozen=True)
class Zone:
    """One mask zone of a Khaos AssetMaster (`M<index> Tint`, `M<index> ... Modifier`)."""

    index: int
    tint: tuple[float, float, float]
    specular: float
    roughness: float
    metallic: float


def _linear_color(text: object) -> tuple[float, float, float] | None:
    values = dict(_COLOR.findall(str(text)))
    if not all(k in values for k in "RGB"):
        return None
    return float(values["R"]), float(values["G"]), float(values["B"])


def khaos_zones(material: Mapping[str, Any]) -> list[Zone]:
    """The zones a material instance parameterises, in graph order (M1 first)."""
    vectors: Mapping[str, Any] = material.get("vectors", {})
    scalars: Mapping[str, Any] = material.get("scalars", {})
    indices = sorted(
        {int(m.group(1)) for name in [*vectors, *scalars] if (m := _ZONE.match(str(name)))}
    )

    def scalar(name: str) -> float:
        value = scalars.get(name, NEUTRAL)
        return float(value) if isinstance(value, int | float) else NEUTRAL

    return [
        Zone(
            index=i,
            tint=_linear_color(vectors.get(f"M{i} Tint")) or (1.0, 1.0, 1.0),
            specular=scalar(f"M{i} Specular Modifier"),
            roughness=scalar(f"M{i} Roughness Modifier"),
            metallic=scalar(f"M{i} Metallic Modifier"),
        )
        for i in indices
    ]


def is_khaos(material: Mapping[str, Any]) -> bool:
    """A Khaos AssetMaster instance whose texture set is the mesh's own tiles."""
    parents = material.get("parents") or []
    master = str(parents[-1]).rsplit(".", 1)[-1] if parents else ""
    textures: Mapping[str, Any] = material.get("textures", {})
    index = material.get("scalars", {}).get("Texture Set Index", 0.0)
    return (
        "AssetMaster" in master
        and all(textures.get(name) for name in KHAOS_TEXTURES)
        and isinstance(index, int | float)
        and float(index) == 0.0
    )


def scalar_modifier(value: F32, modifier: float, mask: F32) -> F32:
    """MF_*_AssetMaster_ScalarModifier: push `value` toward 1 (modifier > 0.5) or 0 (< 0.5),
    blended in by `mask`."""
    if modifier > NEUTRAL:
        target = value + (1.0 - value) * (min(modifier, 1.0) - NEUTRAL) * 2.0
    elif modifier < NEUTRAL:
        target = value * max(modifier, 0.0) * 2.0
    else:
        return value
    return (value + (target - value) * mask).astype(np.float32)


def rebuild_normal(pixels: U8) -> F32:
    """Unit tangent-space normals from a normal map; a two-channel source (blue all 0, as
    Unreal exports BC5 maps) gets Z rebuilt from X and Y."""
    xyz = _unit_float(pixels)[..., :3] * 2.0 - 1.0
    if pixels.ndim == 2 or pixels.shape[2] < 3 or int(pixels[..., 2].max()) == 0:
        xy = xyz[..., :2]
        z = np.sqrt(np.clip(1.0 - (xy**2).sum(axis=-1), 0.0, 1.0))
        xyz = np.concatenate([xy, z[..., None]], axis=-1)
    length = np.linalg.norm(xyz, axis=-1, keepdims=True)
    return (xyz / np.maximum(length, 1e-6)).astype(np.float32)


def khaos_tile_maps(sources: Mapping[str, U8], zones: Sequence[Zone], size: int) -> dict[str, U8]:
    """One tile's glTF maps at `size` px from its Khaos source tiles (by parameter name):
    `color` (sRGB RGB), `data` (ORM: occlusion, roughness, metallic) and `normal` (RGB,
    in the source's green convention). Work happens at the base colour's resolution."""
    base = sources["Base Color"]
    work = base.shape[0]

    def at_work(pixels: U8) -> F32:
        return area_resize(_unit_float(pixels), work)

    masks: list[F32] = []
    for name in KHAOS_MASKS:
        if name in sources:
            channels = at_work(sources[name])
            masks += [channels[..., c] for c in range(channels.shape[2])]
    color = srgb_to_linear(base[..., :3]).astype(np.float32)
    srmd = at_work(sources["SRMD"])
    specular, roughness, metallic = srmd[..., 0], srmd[..., 1], srmd[..., 2]
    for zone in zones:
        if zone.index > len(masks):
            continue
        mask = masks[zone.index - 1]
        tint = np.asarray(zone.tint, dtype=np.float32)
        color *= 1.0 + (tint - 1.0) * mask[..., None]
        specular = scalar_modifier(specular, zone.specular, mask)
        roughness = scalar_modifier(roughness, zone.roughness, mask)
        metallic = scalar_modifier(metallic, zone.metallic, mask)
    occlusion = at_work(sources["Bent Normal/AO"])[..., -1]
    data = np.stack([occlusion, roughness, metallic], axis=-1)
    normal = area_resize(rebuild_normal(sources["Normal"]), size)
    normal /= np.maximum(np.linalg.norm(normal, axis=-1, keepdims=True), 1e-6)
    return {
        "color": linear_to_srgb(area_resize(color, size)),
        "data": _to_u8(area_resize(data, size)),
        "normal": _to_u8(normal * 0.5 + 0.5),
    }


# ---------------------------------------------------------------------------- unit files


def is_udim_material(material: Mapping[str, Any], textures: Mapping[str, Any]) -> bool:
    """Some texture the material samples was exported as UDIM tiles."""
    for reference in material.get("textures", {}).values():
        info = textures.get(str(reference)) if reference else None
        if isinstance(info, dict) and info.get("udim"):
            return True
    return False


def tile_file(textures: Mapping[str, Any], reference: str, tile: int) -> str | None:
    """File holding `tile` of a texture: its UDIM tile, or the whole map for a plain texture
    (which repeats on every tile). None when the export has neither."""
    info = textures.get(reference)
    if not isinstance(info, dict):
        return None
    if info.get("udim"):
        name = info["udim"].get(str(tile))
        return str(name) if name else None
    return str(info["file"]) if info.get("file") else None


def _load(path: Path) -> U8:
    """Pixels as stored (RGBA stays straight: PIL would premultiply on resize)."""
    Image.MAX_IMAGE_PIXELS = None
    with Image.open(path) as image:
        mode = "RGBA" if "A" in image.getbands() else "RGB"
        if image.mode in ("L", "I;16", "I", "F", "1"):
            mode = "L"
        return np.asarray(image.convert(mode))


@dataclass
class AtlasMap:
    pixels: U8
    sha256: str  # of the recipe, its parameters and every source tile


def khaos_atlas(
    folder: Path,
    material: Mapping[str, Any],
    textures: Mapping[str, Any],
    layout: AtlasLayout,
    hashes: Mapping[str, str],
    log: Callable[[str], None] = lambda _: None,
) -> tuple[dict[str, AtlasMap], list[int]]:
    """The material's atlas maps (`color`, `data`, `normal`) and the tiles it had no source
    for (their cells keep the fill). `folder` is the export unit; `hashes` its tile hashes."""
    zones = khaos_zones(material)
    references = {
        name: str(material["textures"][name])
        for name in (*KHAOS_TEXTURES, KHAOS_MASKS[1])
        if material.get("textures", {}).get(name)
    }
    cells: dict[str, dict[int, U8]] = {"color": {}, "data": {}, "normal": {}}
    digest = hashlib.sha256(
        json.dumps(
            {"recipe": RECIPE, "zones": [z.__dict__ for z in zones], "layout": layout.as_dict()},
            sort_keys=True,
        ).encode()
    )
    missing: list[int] = []
    for tile in layout.tiles:
        files = {name: tile_file(textures, ref, tile) for name, ref in references.items()}
        needed = [name for name in KHAOS_TEXTURES if not files.get(name)]
        if needed:
            missing.append(tile)
            log(f"        udim tile {tile}: no {', '.join(needed)}")
            continue
        sources = {name: _load(folder / "textures" / file) for name, file in files.items() if file}
        for name, file in sorted(files.items()):
            digest.update(f"{name}|{tile}|{hashes.get(str(file), file)}".encode())
        for role, pixels in khaos_tile_maps(sources, zones, layout.cell).items():
            cells[role][tile] = pixels
    if len(missing) == len(layout.tiles):
        raise UdimError("no tile of the atlas has its source maps")
    maps = {}
    for role, by_tile in cells.items():
        role_digest = digest.copy()
        role_digest.update(role.encode())
        maps[role] = AtlasMap(compose_atlas(layout, by_tile, FILL[role]), role_digest.hexdigest())
    return maps, missing
