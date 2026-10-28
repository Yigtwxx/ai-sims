"""Preset textures -> web KTX2 maps: skins, irises, teeth and eyelashes.

Sources (per `raw/characters/<Name>`; checked on Ada, see the report of chunk 3):

- `textures/face/T_Face_Basecolor.png` (8K, sRGB) is the final face albedo, and
  `T_Face_Normal` (8K, linear) the final normal map.
  The 8K `*_Animated_CM*/WM*` and the 4K body basecolor are grey material *inputs*, so the
  wrinkle maps, SRMF and body albedo/normal come from the DCC bakes (`dcc/<Name>/Maps`, 2K).
- The cavity maps (`T_Face_Cavity`, `T_Body_Body_Cavity`) are not converted: the DCC SRMF
  bake already lowers the specular and raises the roughness in their pores and creases
  (high-pass correlation -0.77 and +0.74 on Jelena), and Unreal's baked skin material
  (`MI_Head_Baked_LOD0`) takes no cavity map.
- The DCC body albedo has the default underwear baked in (neutral grey). `body_albedo` is that
  map with the underwear filled from the skin around it; the underwear comes back in the web
  shader from `T_Body_Body_Underwear_Mask` (R top, G briefs; B, a longer leg, is unused) and
  `T_Body_Body_Underwear_Basecolor`, identical for every preset and written once, so a top or
  trousers can take it off and a neckline never shows a band of it. The DCC body normal
  has the underwear's seams too, so `body_normal` comes from the bare
  `T_Body_Body_Normal` and the shared `T_Body_Body_Underwear_Normal` goes with the cloth.
  The head reaches the shoulders, and its DCC bake (used in the neck/chest flap) has the
  top's straps: they are filled the same way, and `face_underwear` packs the bake's straps
  (grey, normal, coverage; see `strap_map`) so the shader draws them with the body's top,
  hems and grain continuing across the neck seam.
- `dcc_makeup/<Name>/Maps/Head_Basecolor.png` is the 2K albedo with the preset's makeup; the
  makeup albedo is the 4K albedo plus the (upsampled, linear) makeup difference.
- Wrinkle masks (`dcc/<Name>/Masks/*.tga`, 256 px, identical for every preset so far) keep
  their native size and go to a content-addressed shared folder.

Conventions of the written maps (documented for the web material pass):

- Colour maps are sRGB (KTX2 transfer function sRGB); everything else is linear.
- Normal maps are tangent space in the glTF/OpenGL convention (+Y up): Unreal's DirectX
  green channel is flipped. They are renormalised after downsampling.
- SRMF: R specular, G roughness, B metallic (0), A the fourth Unreal mask channel.
- UVs: glTF top-left origin, the same images Unreal samples (no vertical flip).
"""

import hashlib
import json
import math
import shutil
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt, gaussian_filter

from asset_pipeline.mh.dna import DnaFile, Mesh
from asset_pipeline.mh.gltf import Space
from asset_pipeline.mh.ktx import Ktx2Settings, encode_ktx2
from asset_pipeline.mh.seams import neck_seam

Image.MAX_IMAGE_PIXELS = None

# 2: normal maps flipped only when they read DirectX; 3: face albedo flap and grading.
TEXTURES_VERSION = 3
ALBEDO_VERSION = 3  # bump when the face albedo changes (3: straps filled on the island)
COLOR = Ktx2Settings("srgb", rdo=1.0)
NORMAL = Ktx2Settings("linear", rdo=1.5)
SRMF = Ktx2Settings("linear", rdo=2.0)
MASK = Ktx2Settings("linear", rdo=None)

FACE_SIZE = 4096
FACE_SRMF_SIZE = 2048
WRINKLE_SIZE = 2048
BODY_SIZE = 2048

# Underwear (see the module docstring).
UNDERWEAR_VERSION = 1  # bump when the bare body albedo or the shared underwear maps change
UNDERWEAR_MASK = "T_Body_Body_Underwear_Mask.png"
UNDERWEAR_ALBEDO = "T_Body_Body_Underwear_Basecolor.png"
UNDERWEAR_NORMAL = "T_Body_Body_Underwear_Normal.png"
BARE_BODY_NORMAL = "T_Body_Body_Normal.png"
STRAP_VERSION = 2  # bump when face_underwear changes (2: grey, normal and coverage)
STRAP_SIZE = 2048  # face_underwear: the DCC head bake's own size (hems are ~8 texels)
STRAP_NOISE = 0.1  # skin share at either end of the hem read as grain, not coverage
STRAP_SOLID = 0.75  # coverage from which a texel holds the cloth's own grey and normal
STRAP_REACH = 8.0  # texels past the solid cloth that carry its grey and normal (filtering)
UNDERWEAR_COVER = 0.25  # mask level from which a texel can be underwear
UNDERWEAR_GREY = 0.08  # chroma / value below which a texel is the grey cloth, not skin
UNDERWEAR_DILATE = 3.0  # texels filled past the cloth (antialiased hems mix in skin)
EYE_SIZE = 2048
MASK_ORDER = (
    "head_wm1_msk_01",
    "head_wm1_msk_02",
    "head_wm1_msk_03",
    "head_wm1_msk_04",
    "head_wm2_msk_01",
    "head_wm2_msk_02",
    "head_wm2_msk_03",
    "head_wm3_msk_01",
    "head_wm3_msk_02",
    "head_wm13_msk_01",
)
# Channels of each mask as exported (RGB masks have no unused alpha to carry).
MASK_CHANNELS = {
    name: 3 if name in ("head_wm1_msk_04", "head_wm2_msk_03") else 4 for name in MASK_ORDER
}
# A normal map reads OpenGL only when the other convention's curl is this much larger.
AMBIGUOUS_CONVENTION = 1.25
# Makeup counts when this share of texels moves by more than 1% (linear).
MAKEUP_TEXEL_DELTA = 0.01
MAKEUP_MIN_SHARE = 0.002
# The head mesh's neck/chest flap: the DCC bakes paint the default top there like the body
# albedo, the 8K synthesized map does not. These rings (about 1 cm each) from the head's
# lower boundary take the DCC bake, feathered over FLAP_FEATHER texels at 4K.
FLAP_RINGS = 12
FLAP_FEATHER = 32
# The 8K map's low frequencies are matched to the DCC bake (which the body albedo comes
# from) with a gain blurred at this resolution and sigma (~24 texels at 4K).
GAIN_SIZE = 1024
GAIN_SIGMA = 6.0
# Individual Typology Angle range mapped onto tone 0 (lightest) .. 1 (darkest).
ITA_LIGHT = 60.0
ITA_DARK = -60.0

Kind = Literal["color", "normal", "data"]
_SRGB_TO_LINEAR = np.where(
    np.arange(256) / 255.0 <= 0.04045,
    np.arange(256) / 255.0 / 12.92,
    ((np.arange(256) / 255.0 + 0.055) / 1.055) ** 2.4,
).astype(np.float32)


class TextureError(RuntimeError):
    """A source map is missing or malformed."""


# ---------------------------------------------------------------------------- pixels


def srgb_to_linear(pixels: NDArray[np.uint8]) -> NDArray[np.float32]:
    return _SRGB_TO_LINEAR[pixels]


def linear_to_srgb(values: NDArray[Any]) -> NDArray[np.uint8]:
    v = np.clip(np.asarray(values, dtype=np.float32), 0.0, 1.0)
    encoded = np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - 0.055)
    return np.round(encoded * 255.0).astype(np.uint8)


def load_image(path: Path, channels: int) -> NDArray[np.uint8]:
    """`(H, W, channels)` uint8 pixels (RGB or RGBA; extra channels dropped)."""
    if not path.is_file():
        raise TextureError(f"missing texture {path}")
    with Image.open(path) as image:
        mode = "RGBA" if channels == 4 else "RGB"
        return np.asarray(image.convert(mode))


def _decode_normals(pixels: NDArray[np.uint8]) -> NDArray[np.float32]:
    return pixels[..., :3].astype(np.float32) / 127.5 - 1.0


def _encode_normals(vectors: NDArray[np.float32]) -> NDArray[np.uint8]:
    length = np.linalg.norm(vectors, axis=-1, keepdims=True)
    unit = vectors / np.where(length > 1e-6, length, 1.0)
    unit[..., 2] = np.where(length[..., 0] > 1e-6, unit[..., 2], 1.0)
    return np.round(np.clip(unit * 127.5 + 127.5, 0, 255)).astype(np.uint8)


def downsample(pixels: NDArray[np.uint8], size: int, kind: Kind) -> NDArray[np.uint8]:
    """Box-filter a square image down by an integer factor (colour in linear light, normals
    as renormalised vectors). Processed in strips to bound memory on 8K inputs."""
    height, width = pixels.shape[:2]
    if height != width or height % size:
        raise TextureError(f"cannot box-filter {width}x{height} to {size}")
    factor = height // size
    if factor == 1:
        return pixels.copy()
    channels = pixels.shape[2]
    out = np.empty((size, size, channels), dtype=np.uint8)
    rows = max(1, 1024 // factor)
    for start in range(0, size, rows):
        stop = min(size, start + rows)
        strip = pixels[start * factor : stop * factor]
        if kind == "color":
            values = srgb_to_linear(strip[..., :3])
        elif kind == "normal":
            values = _decode_normals(strip)
        else:
            values = strip[..., :3].astype(np.float32) / 255.0
        shaped = values.reshape(stop - start, factor, size, factor, 3)
        mean = shaped.mean(axis=(1, 3))
        if kind == "color":
            out[start:stop, :, :3] = linear_to_srgb(mean)
        elif kind == "normal":
            out[start:stop, :, :3] = _encode_normals(mean)
        else:
            out[start:stop, :, :3] = np.round(mean * 255.0).astype(np.uint8)
        if channels == 4:
            alpha = strip[..., 3].astype(np.float32).reshape(stop - start, factor, size, factor)
            out[start:stop, :, 3] = np.round(alpha.mean(axis=(1, 3))).astype(np.uint8)
    return out


def flip_green(pixels: NDArray[np.uint8]) -> NDArray[np.uint8]:
    """DirectX (+Y down) normal map <-> glTF/OpenGL (+Y up)."""
    flipped = pixels.copy()
    flipped[..., 1] = 255 - flipped[..., 1]
    return flipped


def normal_convention(pixels: NDArray[np.uint8], size: int = 1024) -> tuple[str, float]:
    """Green convention of a tangent-space normal map, read from the data.

    A normal map baked from a height field is a gradient field, so its curl vanishes, but
    only when green is read with the right sign: with `p = nx/nz`, `q = ny/nz` in image
    rows/columns, `dp/drow + dq/dcol` vanishes for OpenGL maps (+Y up) and
    `dp/drow - dq/dcol` for DirectX maps (+Y down). Returns the convention and how many
    times larger the other residual is (MetaHuman skin, body, wrinkle and teeth maps read
    DirectX at 1.6-4x; the eye map reads OpenGL at 3.6x).
    """
    step = max(1, pixels.shape[0] // size)
    n = pixels[::step, ::step, :3].astype(np.float64) / 127.5 - 1.0
    nz = np.clip(n[..., 2], 0.2, None)
    p, q = n[..., 0] / nz, n[..., 1] / nz
    dp_drow = np.gradient(p, axis=0)
    dq_dcol = np.gradient(q, axis=1)
    mask = n[..., 2] > 0.3
    if not mask.any():
        return "directx", 1.0
    opengl = float(np.abs(dp_drow + dq_dcol)[mask].mean())
    directx = float(np.abs(dp_drow - dq_dcol)[mask].mean())
    if opengl < directx:
        return "opengl", directx / max(opengl, 1e-12)
    return "directx", opengl / max(directx, 1e-12)


def prepare(path: Path, size: int | None, kind: Kind, channels: int = 3) -> NDArray[np.uint8]:
    """Load, filter down to `size` (None keeps the native size) and bring normal maps to
    the glTF/OpenGL green convention (flipped only when the map reads DirectX)."""
    pixels = load_image(path, channels)
    if size is not None and pixels.shape[0] > size:
        pixels = downsample(pixels, size, kind)
    if kind == "normal":
        convention, margin = normal_convention(pixels)
        # Ambiguous maps keep Unreal's convention (DirectX).
        if convention == "directx" or margin < AMBIGUOUS_CONVENTION:
            pixels = flip_green(pixels)
    return pixels


def resize_float(values: NDArray[np.float32], size: int) -> NDArray[np.float32]:
    """Bicubic resize of a float image `(H, W)` or `(H, W, C)` to `size` x `size`."""
    if values.ndim == 2:
        image = Image.fromarray(np.ascontiguousarray(values, dtype=np.float32))
        return np.asarray(image.resize((size, size), Image.Resampling.BICUBIC))
    return np.stack([resize_float(values[..., c], size) for c in range(values.shape[2])], axis=-1)


def box_mean(values: NDArray[np.float32], size: int) -> NDArray[np.float32]:
    """Average a square float image down to `size` (integer factor)."""
    factor = values.shape[0] // size
    if factor <= 1:
        return values
    shape = (size, factor, size, factor, *values.shape[2:])
    return values.reshape(shape).mean(axis=(1, 3))


def flap_mask(dna: DnaFile, size: int, rings: int = FLAP_RINGS) -> NDArray[np.bool_]:
    """UV mask (top-left origin) of the head faces within `rings` rings of the head's lower
    open boundary, i.e. the neck and chest flap that meets the body."""
    head = next(m for m in dna.meshes_for_lod(0) if m.name.startswith("head_"))
    seam = neck_seam(head, Space.from_descriptor(dna.descriptor), lowest=True, rings=rings)
    in_band = np.zeros(len(head.positions), dtype=bool)
    in_band[seam["positions"]] = True
    band = np.all(in_band[head.layout_positions[head.triangles]], axis=1)
    return _uv_coverage(head, head.triangles[band], size)


def island_mask(dna: DnaFile, size: int) -> NDArray[np.bool_]:
    """UV mask (top-left origin) of every head face; texels off it are padding."""
    head = next(m for m in dna.meshes_for_lod(0) if m.name.startswith("head_"))
    return _uv_coverage(head, head.triangles, size)


def _uv_coverage(head: Mesh, triangles: NDArray[np.int64], size: int) -> NDArray[np.bool_]:
    uvs = head.uvs[head.layout_uvs].astype(np.float64)
    uvs[:, 1] = 1.0 - uvs[:, 1]
    pixels = uvs * size
    canvas = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(canvas)
    for triangle in triangles:
        draw.polygon([tuple(pixels[v]) for v in triangle], fill=255, outline=255)
    return np.asarray(canvas) > 0


def feathered(mask: NDArray[np.bool_], feather: float) -> NDArray[np.float32]:
    """1 inside the mask, smoothly falling to 0 over `feather` pixels outside it."""
    distance = distance_transform_edt(~mask)
    t = np.clip(1.0 - distance / feather, 0.0, 1.0)
    return (t * t * (3.0 - 2.0 * t)).astype(np.float32)


def low_frequency_gain(
    synth: NDArray[np.float32], reference: NDArray[np.float32], exclude: NDArray[np.bool_]
) -> NDArray[np.float32]:
    """Per-channel gain bringing the synth map's low frequencies to the reference bake,
    blurred with normalized convolution so excluded texels (the flap) do not leak in."""
    small_synth = box_mean(synth, GAIN_SIZE)
    small_reference = box_mean(reference, GAIN_SIZE)
    weight = 1.0 - box_mean(exclude.astype(np.float32), GAIN_SIZE)
    gains = []
    for c in range(3):
        numerator = gaussian_filter(small_reference[..., c] * weight, GAIN_SIGMA)
        denominator = gaussian_filter(small_synth[..., c] * weight, GAIN_SIGMA)
        gains.append(np.clip(numerator / np.maximum(denominator, 1e-4), 0.5, 2.0))
    return resize_float(np.stack(gains, axis=-1).astype(np.float32), synth.shape[0])


@dataclass(frozen=True)
class FaceAlbedo:
    base: NDArray[np.uint8]
    makeup: NDArray[np.uint8] | None
    makeup_share: float


def compose_face_albedo(
    synth: NDArray[np.uint8],
    dcc_base: NDArray[np.uint8],
    dcc_makeup: NDArray[np.uint8] | None,
    flap: NDArray[np.bool_],
) -> FaceAlbedo:
    """The face albedo: the 8K synthesized map (filtered to `synth`'s size) with its low
    frequencies matched to the DCC bake, the DCC bake itself in the neck/chest flap
    (feathered), and optionally the DCC makeup difference on top (the DCC makeup map in the
    flap). All blending happens in linear light."""
    size = synth.shape[0]
    synth_linear = srgb_to_linear(synth[..., :3])
    base_linear = srgb_to_linear(dcc_base[..., :3])
    base_up = resize_float(base_linear, size)
    weight = feathered(flap, FLAP_FEATHER * size / 4096)[..., None]
    graded = synth_linear * low_frequency_gain(synth_linear, base_up, flap)
    del synth_linear
    base = linear_to_srgb(graded * (1.0 - weight) + base_up * weight)
    if dcc_makeup is None:
        return FaceAlbedo(base, None, 0.0)
    makeup_linear = srgb_to_linear(dcc_makeup[..., :3])
    delta = makeup_linear - base_linear
    share = float((np.abs(delta).max(axis=-1) > MAKEUP_TEXEL_DELTA).mean())
    made_up = (graded + resize_float(delta, size)) * (1.0 - weight)
    made_up += resize_float(makeup_linear, size) * weight
    return FaceAlbedo(base, linear_to_srgb(made_up), share)


# ---------------------------------------------------------------------------- measurements


def _lab(rgb_linear: NDArray[Any]) -> tuple[float, float, float]:
    r, g, b = (float(v) for v in rgb_linear)
    x = 0.4124 * r + 0.3576 * g + 0.1805 * b
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = 0.0193 * r + 0.1192 * g + 0.9505 * b

    def f(t: float) -> float:
        return t ** (1 / 3) if t > (6 / 29) ** 3 else t / (3 * (6 / 29) ** 2) + 4 / 29

    fx, fy, fz = f(x / 0.95047), f(y), f(z / 1.08883)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def skin_tone(rgb_linear: NDArray[Any]) -> tuple[float, float]:
    """(tone 0 light .. 1 dark, Individual Typology Angle in degrees) of a skin albedo."""
    lightness, _, yellow = _lab(rgb_linear)
    ita = math.degrees(math.atan2(lightness - 50.0, yellow))
    tone = (ITA_LIGHT - ita) / (ITA_LIGHT - ITA_DARK)
    return float(min(1.0, max(0.0, tone))), ita


def hex_color(rgb_linear: NDArray[Any]) -> str:
    srgb = linear_to_srgb(np.asarray(rgb_linear, dtype=np.float32))
    return "#" + "".join(f"{int(v):02x}" for v in srgb.tolist())


def cheek_uvs(dna: DnaFile) -> NDArray[np.float64]:
    """Image-space UVs (top-left origin) of head vertices on both cheeks: 2-4 cm below each
    eye, slightly outward, in front, facing forward. MetaHuman DNAs are cm, +Y up, +Z front."""
    meshes = {m.name: m for m in dna.meshes_for_lod(0)}
    head = next(m for name, m in meshes.items() if name.startswith("head_"))
    eyes = [m for name, m in meshes.items() if name.startswith(("eyeLeft_", "eyeRight_"))]
    if len(eyes) != 2:
        raise TextureError("head DNA has no eye meshes to locate the cheeks")
    positions = head.positions.astype(np.float64)
    normals = head.normals.astype(np.float64)
    layout_normals = np.zeros_like(positions)
    np.add.at(layout_normals, head.layout_positions, normals[head.layout_normals])
    layout_normals /= np.maximum(np.linalg.norm(layout_normals, axis=1, keepdims=True), 1e-9)
    chosen = []
    for eye in eyes:
        center = eye.positions.astype(np.float64).mean(axis=0)
        near = (
            (np.abs(positions[:, 0] - 1.15 * center[0]) < 1.2)
            & (positions[:, 1] < center[1] - 2.0)
            & (positions[:, 1] > center[1] - 4.0)
            & (positions[:, 2] > center[2] - 1.0)
            & (layout_normals[:, 2] > 0.3)
        )
        chosen.append(np.flatnonzero(near))
    selected = np.concatenate(chosen)
    if len(selected) < 8:
        raise TextureError("found too few cheek vertices")
    is_selected = np.zeros(len(positions), dtype=bool)
    is_selected[selected] = True
    layouts = np.flatnonzero(is_selected[head.layout_positions])
    uvs = head.uvs[head.layout_uvs[layouts]].astype(np.float64)
    uvs[:, 1] = 1.0 - uvs[:, 1]
    return uvs


def sample_median(
    albedo: NDArray[np.uint8], uvs: NDArray[np.float64], radius: int = 4
) -> NDArray[np.float64]:
    """Median linear colour of `(2r+1)^2` texel patches around each UV (pores averaged out
    per patch, freckles and moles rejected by the median across patches)."""
    size = albedo.shape[0]
    centers = np.clip(np.round(uvs * size).astype(np.int64), radius, size - radius - 1)
    offsets = np.arange(-radius, radius + 1)
    rows = centers[:, 1, None, None] + offsets[None, :, None]
    cols = centers[:, 0, None, None] + offsets[None, None, :]
    patches = srgb_to_linear(albedo[rows, cols, :3])
    return np.median(patches.reshape(len(uvs), -1, 3).mean(axis=1), axis=0)


def iris_swatch(color: NDArray[np.uint8]) -> str:
    """Hex colour of the iris ring of an eye texture (iris centred, pupil in the middle)."""
    size = color.shape[0]
    yy, xx = np.mgrid[0:size, 0:size]
    radius = np.hypot(xx - (size - 1) / 2, yy - (size - 1) / 2) / size
    ring = (radius > 0.06) & (radius < 0.12)
    linear = srgb_to_linear(color[..., :3])[ring]
    return hex_color(np.median(linear, axis=0))


# ---------------------------------------------------------------------------- outputs


@dataclass
class TextureSet:
    """Files written for one preset, keyed by role, relative to the web root."""

    files: dict[str, str] = field(default_factory=dict)
    sizes: dict[str, int] = field(default_factory=dict)

    def add(self, role: str, path: Path, web_root: Path, size: int) -> None:
        self.files[role] = path.relative_to(web_root).as_posix()
        self.sizes[role] = size


@dataclass(frozen=True)
class PresetMaps:
    """Source maps of one preset (`raw/characters/<Name>`)."""

    name: str
    unit: Path

    @property
    def dcc(self) -> Path:
        return self.unit / "dcc" / self.name

    @property
    def maps(self) -> Path:
        return self.dcc / "Maps"

    @property
    def face(self) -> Path:
        return self.unit / "textures" / "face"

    @property
    def body(self) -> Path:
        return self.unit / "textures" / "body"

    @property
    def makeup(self) -> Path:
        return self.unit / "dcc_makeup" / self.name / "Maps" / "Head_Basecolor.png"

    def masks(self) -> list[Path]:
        masks = [self.dcc / "Masks" / f"{name}.tga" for name in MASK_ORDER]
        missing = [m.name for m in masks if not m.is_file()]
        if missing:
            raise TextureError(f"{self.name}: missing wrinkle masks {missing}")
        return masks

    def check(self) -> None:
        required = [
            self.face / "T_Face_Basecolor.png",
            self.face / "T_Face_Normal.png",
            *(
                self.maps / f"{name}.png"
                for name in (
                    "Head_SRMF",
                    "Head_Basecolor",
                    "Body_Basecolor",
                    "Body_Normal",
                    "Body_SRMF",
                    "Eyes_Color",
                    "Eyes_Normal",
                    "Teeth_Color",
                    "Teeth_Normal",
                    "Eyelashes_Color",
                    *(f"Head_Basecolor_Animated_CM{i}" for i in (1, 2, 3)),
                    *(f"Head_Normal_Animated_WM{i}" for i in (1, 2, 3)),
                )
            ),
        ]
        missing = [str(p.relative_to(self.unit)) for p in required if not p.is_file()]
        if missing:
            raise TextureError(f"{self.name}: missing maps {missing}")
        with Image.open(self.face / "T_Face_Basecolor.png") as face:
            if face.width < FACE_SIZE:
                raise TextureError(
                    f"{self.name}: face textures are {face.width} px, the export lacks the "
                    "high-resolution maps"
                )
        self.masks()

    @property
    def complete(self) -> bool:
        try:
            self.check()
        except TextureError:
            return False
        return True

    @property
    def has_head_maps(self) -> bool:
        return all(
            (self.maps / f"{source}.png").is_file() for source, *_ in MOUTH_EYE_MAPS.values()
        )


def underwear_texels(albedo: NDArray[np.uint8], mask: NDArray[np.float32]) -> NDArray[np.bool_]:
    """Texels of a baked body albedo that show the grey underwear: inside the underwear
    `mask` (H, W, C) and nearly colourless, plus a few texels around them. Skin inside the
    mask stays (a man's albedo has no top, though the mask has one)."""
    rgb = albedo[..., :3].astype(np.float32)
    peak = rgb.max(axis=-1)
    chroma = (peak - rgb.min(axis=-1)) / np.maximum(peak, 1.0)
    cloth = (mask.max(axis=-1) > UNDERWEAR_COVER) & (chroma < UNDERWEAR_GREY)
    if not cloth.any():
        return cloth
    reach = np.asarray(distance_transform_edt(~cloth))
    return reach <= UNDERWEAR_DILATE


def push_pull_fill(image: NDArray[np.float32], hole: NDArray[np.bool_]) -> NDArray[np.float32]:
    """Fill the `hole` texels of a square (H, W, C) image from the texels around them: a
    pyramid of the known texels' mean colour, then every level filled from the coarser one
    (push-pull). Known texels keep their exact values."""
    weight = (~hole).astype(np.float32)
    color = image * weight[..., None]
    pyramid: list[tuple[NDArray[np.float32], NDArray[np.float32]]] = []
    while True:
        pyramid.append((color, weight))
        size = weight.shape[0]
        if size <= 1:
            break
        half = size // 2
        color = color[: half * 2, : half * 2].reshape(half, 2, half, 2, -1).sum(axis=(1, 3))
        weight = weight[: half * 2, : half * 2].reshape(half, 2, half, 2).sum(axis=(1, 3))
    color, weight = pyramid[-1]
    filled = color / np.maximum(weight, 1e-6)[..., None]
    for color, weight in reversed(pyramid[:-1]):
        coarse = resize_float(filled, weight.shape[0])
        known = color / np.maximum(weight, 1e-6)[..., None]
        alpha = np.clip(weight, 0.0, 1.0)[..., None]
        filled = known * alpha + coarse * (1.0 - alpha)
    return np.where(hole[..., None], filled, image).astype(np.float32)


def bare_body_albedo(albedo: NDArray[np.uint8], mask: NDArray[np.float32]) -> NDArray[np.uint8]:
    """The DCC body albedo with its baked underwear filled from the skin around it."""
    hole = underwear_texels(albedo, mask)
    if not hole.any():
        return albedo
    filled = push_pull_fill(albedo[..., :3].astype(np.float32), hole)
    return np.clip(np.round(filled), 0, 255).astype(np.uint8)


def bare_body_srmf(
    srmf: NDArray[np.uint8], albedo: NDArray[np.uint8], mask: NDArray[np.float32]
) -> NDArray[np.uint8]:
    """The DCC body SRMF with its baked underwear filled from the skin around it, every
    channel, over the texels the `albedo` shows the underwear on (same size). The bake
    gives the cloth flat values (roughness 1, specular 0.5) that read as a matte band
    wherever a high-cut garment leaves that skin bare (the Clara bodysuit's leg openings)."""
    hole = underwear_texels(albedo, mask)
    if not hole.any():
        return srmf
    filled = push_pull_fill(srmf.astype(np.float32), hole)
    return np.clip(np.round(filled), 0, 255).astype(np.uint8)


def find_straps(albedo: NDArray[np.uint8], flap: NDArray[np.bool_]) -> NDArray[np.bool_] | None:
    """Texels of grey cloth in the neck/chest flap of a face albedo (the only part from the
    DCC bake, which shows the default top's straps), or None when there is none (a man's
    head)."""
    region = feathered(flap, FLAP_FEATHER * flap.shape[0] / 4096)[..., None]
    texels = underwear_texels(albedo, region)
    return texels if texels.any() else None


def fill_texels(
    image: NDArray[np.uint8], hole: NDArray[np.bool_], island: NDArray[np.bool_] | None = None
) -> NDArray[np.uint8]:
    """Fill the `hole` texels from the skin around them. Texels off the `island` (UV padding,
    often light) are not sources: a strap that reaches an island's edge would turn pale."""
    unknown = hole if island is None else hole | ~island
    filled = push_pull_fill(image[..., :3].astype(np.float32), unknown)
    filled = np.where(hole[..., None], filled, image[..., :3])
    return np.clip(np.round(filled), 0, 255).astype(np.uint8)


def strap_map(
    albedo: NDArray[np.uint8],
    normal: NDArray[np.uint8],
    flap: NDArray[np.bool_],
    island: NDArray[np.bool_],
) -> NDArray[np.uint8] | None:
    """The default top's straps of a DCC head bake as one RGBA map, since the head shader
    has a single sampler to spare: R the cloth's grey (sRGB), G and B its tangent normal (x
    and y, OpenGL), A its coverage. `albedo` and `normal` are the bake's maps and `flap` and
    `island` UV masks, all at one square size. None when the bake has no straps.

    The cloth is colourless, so a hem texel's chroma against the skin filled in under the
    strap is the skin's share of it (in linear light). Grey and normal are the cloth's own
    where it is solid and are spread STRAP_REACH texels past it, so filtering at the hem
    never mixes in skin; farther texels are flat and compress to nothing.
    """
    texels = find_straps(albedo, flap)
    if texels is None:
        return None
    seen = srgb_to_linear(albedo[..., :3])
    skin = srgb_to_linear(fill_texels(albedo, texels, island))
    seen_chroma = seen - seen.mean(axis=-1, keepdims=True)
    skin_chroma = skin - skin.mean(axis=-1, keepdims=True)
    skin_share = (seen_chroma * skin_chroma).sum(axis=-1) / np.maximum(
        (skin_chroma * skin_chroma).sum(axis=-1), 1e-6
    )
    cover = np.clip((1.0 - skin_share - STRAP_NOISE) / (1.0 - 2.0 * STRAP_NOISE), 0.0, 1.0)
    cover = np.where(texels, cover, 0.0)
    solid = cover >= STRAP_SOLID
    if not solid.any():
        return None
    grey = seen.mean(axis=-1)
    flat_grey = float(np.median(grey[solid]))
    near = np.asarray(distance_transform_edt(~solid)) <= STRAP_REACH
    grey = np.where(near, push_pull_fill(grey[..., None], ~solid)[..., 0], flat_grey)
    vectors = push_pull_fill(_decode_normals(normal), ~solid)
    vectors = np.where(near[..., None], vectors, np.array([0.0, 0.0, 1.0], dtype=np.float32))
    packed = np.empty((*cover.shape, 4), dtype=np.uint8)
    packed[..., 0] = linear_to_srgb(grey)
    packed[..., 1:3] = _encode_normals(vectors.astype(np.float32))[..., :2]
    packed[..., 3] = np.round(cover * 255.0).astype(np.uint8)
    return packed


def underwear_mask(maps: PresetMaps, size: int) -> NDArray[np.float32] | None:
    """The underwear mask's top and briefs channels (0..1) at `size`, if exported."""
    path = maps.body / UNDERWEAR_MASK
    if not path.is_file():
        return None
    pixels = load_image(path, 3)[..., :2].astype(np.float32) / 255.0
    return resize_float(pixels, size) if pixels.shape[0] != size else pixels


def write_underwear(maps: PresetMaps, web_root: Path) -> dict[str, str] | None:
    """Encode the shared underwear mask (RG), cloth albedo and normal once per distinct set."""
    sources = [
        maps.body / UNDERWEAR_MASK,
        maps.body / UNDERWEAR_ALBEDO,
        maps.body / UNDERWEAR_NORMAL,
    ]
    if not all(path.is_file() for path in sources):
        return None
    digest = hashlib.sha256(
        b"".join(path.read_bytes() for path in sources) + f"v{UNDERWEAR_VERSION}".encode()
    ).hexdigest()[:12]
    folder = web_root / "skins" / "underwear" / digest
    mask_path = folder / "mask.ktx2"
    albedo_path = folder / "albedo.ktx2"
    normal_path = folder / "normal.ktx2"
    if not mask_path.is_file():
        mask = load_image(sources[0], 3)
        if mask.shape[0] > BODY_SIZE:
            mask = downsample(mask, BODY_SIZE, "data")
        mask[..., 2] = 0
        encode_ktx2(mask, mask_path, MASK)
    if not albedo_path.is_file():
        encode_ktx2(prepare(sources[1], BODY_SIZE, "color"), albedo_path, COLOR)
    if not normal_path.is_file():
        encode_ktx2(prepare(sources[2], BODY_SIZE, "normal"), normal_path, NORMAL)
    return {
        "mask": mask_path.relative_to(web_root).as_posix(),
        "albedo": albedo_path.relative_to(web_root).as_posix(),
        "normal": normal_path.relative_to(web_root).as_posix(),
    }


def write_masks(maps: PresetMaps, web_root: Path) -> list[str]:
    """Encode the wrinkle masks once per distinct mask set; returns paths in MASK_ORDER."""
    masks = maps.masks()
    digest = hashlib.sha256(b"".join(m.read_bytes() for m in masks)).hexdigest()[:12]
    folder = web_root / "skins" / "masks" / digest
    files = []
    for mask in masks:
        channels = MASK_CHANNELS[mask.stem]
        with Image.open(mask) as image:
            if len(image.getbands()) != channels:
                raise TextureError(
                    f"{mask.name} has {image.mode} pixels, expected {channels} bands"
                )
        output = folder / f"{mask.stem}.ktx2"
        if not output.is_file():
            encode_ktx2(load_image(mask, channels), output, MASK)
        files.append(output.relative_to(web_root).as_posix())
    return files


def estimate_tone(maps: PresetMaps, dna: DnaFile) -> float | None:
    """Tone of whatever face albedo an incomplete export has (used to pick a stand-in skin)."""
    path = maps.face / "T_Face_Basecolor.png"
    if not path.is_file():
        return None
    albedo = load_image(path, 3)
    return skin_tone(sample_median(albedo, cheek_uvs(dna), radius=1))[0]


@dataclass
class TextureCache:
    """Per-texture build prints of one skin (`build/cache/skins/<Name>.json`), so a recipe
    change re-encodes only the maps it affects. Measurements made on the composed albedo
    (tone, swatch, makeup share) are cached with the albedo's print."""

    path: Path
    prints: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path) -> "TextureCache":
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            data = {}
        return cls(path, data if isinstance(data, dict) else {})

    def fresh(self, output: Path, print_: str) -> bool:
        entry = self.prints.get(output.name)
        return output.is_file() and isinstance(entry, dict) and entry.get("print") == print_

    def get(self, output: Path, key: str) -> object:
        entry = self.prints.get(output.name)
        return entry.get(key) if isinstance(entry, dict) else None

    def remember(self, output: Path, print_: str, **data: object) -> None:
        self.prints[output.name] = {"print": print_, **data}
        write_json(self.path, self.prints)


def _source_key(*paths: Path) -> list[Any]:
    """Identity of source files without hashing gigabytes: name, size, modification time."""
    keys: list[Any] = []
    for path in paths:
        stat = path.stat()
        keys.append([path.name, stat.st_size, stat.st_mtime_ns])
    return keys


def texture_print(recipe: Mapping[str, Any], *sources: Path) -> str:
    digest = hashlib.sha256(
        json.dumps({"recipe": recipe, "sources": _source_key(*sources)}, sort_keys=True).encode()
    )
    return digest.hexdigest()


@dataclass(frozen=True)
class MapJob:
    role: str
    file_name: str
    source: Path
    size: int
    kind: Kind
    settings: Ktx2Settings
    channels: int = 3

    def recipe(self) -> dict[str, Any]:
        return {
            "size": self.size,
            "kind": self.kind,
            "channels": self.channels,
            "settings": self.settings.key,
            "normals": "curl-detected-v2" if self.kind == "normal" else None,
        }


def skin_jobs(maps: PresetMaps) -> list[MapJob]:
    """Every skin map but the composed face albedo."""
    return [
        MapJob(
            "face_normal",
            "face_normal.ktx2",
            maps.face / "T_Face_Normal.png",
            FACE_SIZE,
            "normal",
            NORMAL,
        ),
        MapJob(
            "face_srmf",
            "face_srmf.ktx2",
            maps.maps / "Head_SRMF.png",
            FACE_SRMF_SIZE,
            "data",
            SRMF,
            4,
        ),
        *(
            MapJob(
                f"face_cm{i}",
                f"face_cm{i}.ktx2",
                maps.maps / f"Head_Basecolor_Animated_CM{i}.png",
                WRINKLE_SIZE,
                "color",
                COLOR,
            )
            for i in (1, 2, 3)
        ),
        *(
            MapJob(
                f"face_wm{i}",
                f"face_wm{i}.ktx2",
                maps.maps / f"Head_Normal_Animated_WM{i}.png",
                WRINKLE_SIZE,
                "normal",
                NORMAL,
            )
            for i in (1, 2, 3)
        ),
        MapJob(
            "body_normal",
            "body_normal.ktx2",
            # Bare skin; the DCC bake has the underwear's seams (see the module docstring).
            maps.body / BARE_BODY_NORMAL
            if (maps.body / BARE_BODY_NORMAL).is_file()
            else maps.maps / "Body_Normal.png",
            BODY_SIZE,
            "normal",
            NORMAL,
        ),
    ]


def albedo_recipe() -> dict[str, Any]:
    return {
        "size": FACE_SIZE,
        "settings": COLOR.key,
        "flap": [FLAP_RINGS, FLAP_FEATHER],
        "gain": [GAIN_SIZE, GAIN_SIGMA],
        "version": ALBEDO_VERSION,
    }


def convert_body_albedo(
    maps: PresetMaps, folder: Path, web_root: Path, cache: TextureCache, textures: TextureSet
) -> None:
    """`body_albedo.ktx2`: the DCC body albedo without its baked underwear."""
    output = folder / "body_albedo.ktx2"
    source = maps.maps / "Body_Basecolor.png"
    mask_source = maps.body / UNDERWEAR_MASK
    sources = [source, *([mask_source] if mask_source.is_file() else [])]
    recipe = {
        "size": BODY_SIZE,
        "settings": COLOR.key,
        "underwear": [UNDERWEAR_VERSION, UNDERWEAR_COVER, UNDERWEAR_GREY, UNDERWEAR_DILATE],
    }
    print_ = texture_print(recipe, *sources)
    if not cache.fresh(output, print_):
        albedo = prepare(source, BODY_SIZE, "color")
        mask = underwear_mask(maps, albedo.shape[0])
        if mask is not None:
            albedo = bare_body_albedo(albedo, mask)
        encode_ktx2(albedo, output, COLOR)
        cache.remember(output, print_)
    textures.add("body_albedo", output, web_root, output.stat().st_size)


def convert_body_srmf(
    maps: PresetMaps, folder: Path, web_root: Path, cache: TextureCache, textures: TextureSet
) -> None:
    """`body_srmf.ktx2`: the DCC body SRMF without its baked underwear (`bare_body_srmf`)."""
    output = folder / "body_srmf.ktx2"
    source = maps.maps / "Body_SRMF.png"
    albedo_source = maps.maps / "Body_Basecolor.png"
    mask_source = maps.body / UNDERWEAR_MASK
    sources = [source, albedo_source, *([mask_source] if mask_source.is_file() else [])]
    recipe = {
        "size": BODY_SIZE,
        "settings": SRMF.key,
        "underwear": [UNDERWEAR_VERSION, UNDERWEAR_COVER, UNDERWEAR_GREY, UNDERWEAR_DILATE],
    }
    print_ = texture_print(recipe, *sources)
    if not cache.fresh(output, print_):
        srmf = prepare(source, BODY_SIZE, "data", 4)
        mask = underwear_mask(maps, srmf.shape[0])
        if mask is not None:
            albedo = prepare(albedo_source, srmf.shape[0], "color")
            srmf = bare_body_srmf(srmf, albedo, mask)
        encode_ktx2(srmf, output, SRMF)
        cache.remember(output, print_)
    textures.add("body_srmf", output, web_root, output.stat().st_size)


def strap_recipe() -> dict[str, Any]:
    return {
        "size": STRAP_SIZE,
        "settings": MASK.key,
        "flap": [FLAP_RINGS, FLAP_FEATHER],
        "underwear": [UNDERWEAR_COVER, UNDERWEAR_GREY, UNDERWEAR_DILATE],
        "straps": [STRAP_VERSION, STRAP_NOISE, STRAP_SOLID, STRAP_REACH],
    }


def convert_straps(
    maps: PresetMaps,
    dna: DnaFile,
    folder: Path,
    web_root: Path,
    cache: TextureCache,
    textures: TextureSet,
) -> bool:
    """`face_underwear.ktx2`, the straps of the DCC head bake (see `strap_map`). False when
    the bake has none (a man's head)."""
    output = folder / "face_underwear.ktx2"
    albedo_source = maps.maps / "Head_Basecolor.png"
    normal_source = maps.maps / "Head_Normal.png"
    print_ = texture_print(strap_recipe(), albedo_source, normal_source, maps.dcc / "head.dna")
    has_straps = cache.get(output, "straps")
    if cache.get(output, "print") != print_ or (has_straps and not output.is_file()):
        albedo = prepare(albedo_source, STRAP_SIZE, "color")
        normal = prepare(normal_source, STRAP_SIZE, "normal")
        if normal.shape[:2] != albedo.shape[:2]:
            raise TextureError(
                f"{maps.name}: head normal is {normal.shape[0]} px, basecolor {albedo.shape[0]}"
            )
        size = albedo.shape[0]
        pixels = strap_map(albedo, normal, flap_mask(dna, size), island_mask(dna, size))
        if pixels is None:
            output.unlink(missing_ok=True)
        else:
            encode_ktx2(pixels, output, MASK)
        has_straps = pixels is not None
        cache.remember(output, print_, straps=has_straps)
    if not has_straps:
        return False
    textures.add("face_underwear", output, web_root, output.stat().st_size)
    return True


def convert_skin(
    maps: PresetMaps, dna: DnaFile, web_root: Path, cache: TextureCache | None = None
) -> dict[str, Any]:
    """Encode a preset's skin maps to `skins/<Name>/` and return its manifest skin entry
    (plus `stats` for the report). Maps whose print matches `cache` are kept as they are."""
    maps.check()
    cache = cache or TextureCache.load(
        web_root.parent / "build" / "cache" / "skins" / f"{maps.name}.json"
    )
    folder = web_root / "skins" / maps.name
    textures = TextureSet()

    albedo_path = folder / "face_albedo.ktx2"
    makeup_path = folder / "face_albedo_makeup.ktx2"
    sources = [
        maps.face / "T_Face_Basecolor.png",
        maps.maps / "Head_Basecolor.png",
        maps.dcc / "head.dna",
    ]
    if maps.makeup.is_file():
        sources.append(maps.makeup)
    print_ = texture_print(albedo_recipe(), *sources)
    measured = cache.get(albedo_path, "measurements")
    makeup_fresh = not cache.get(albedo_path, "makeup") or cache.fresh(makeup_path, print_)
    if cache.fresh(albedo_path, print_) and isinstance(measured, dict) and makeup_fresh:
        textures.add("face_albedo", albedo_path, web_root, albedo_path.stat().st_size)
        if cache.get(albedo_path, "makeup"):
            textures.add("makeup", makeup_path, web_root, makeup_path.stat().st_size)
        cheek = np.asarray(measured["cheek_linear"], dtype=np.float64)
        makeup_share = float(measured["makeup_share"])
    else:
        flap = flap_mask(dna, FACE_SIZE)
        albedo = compose_face_albedo(
            prepare(maps.face / "T_Face_Basecolor.png", FACE_SIZE, "color"),
            load_image(maps.maps / "Head_Basecolor.png", 3),
            load_image(maps.makeup, 3) if maps.makeup.is_file() else None,
            flap,
        )
        straps = find_straps(albedo.base, flap)
        island = island_mask(dna, FACE_SIZE) if straps is not None else None
        base = albedo.base if straps is None else fill_texels(albedo.base, straps, island)
        textures.add("face_albedo", albedo_path, web_root, encode_ktx2(base, albedo_path, COLOR))
        cheek = sample_median(base, cheek_uvs(dna))
        makeup_share = albedo.makeup_share
        has_makeup = albedo.makeup is not None and makeup_share >= MAKEUP_MIN_SHARE
        if has_makeup and albedo.makeup is not None:
            made_up = (
                albedo.makeup if straps is None else fill_texels(albedo.makeup, straps, island)
            )
            textures.add("makeup", makeup_path, web_root, encode_ktx2(made_up, makeup_path, COLOR))
            cache.remember(makeup_path, print_)
        cache.remember(
            albedo_path,
            print_,
            makeup=has_makeup,
            measurements={
                "cheek_linear": [float(v) for v in cheek],
                "makeup_share": makeup_share,
            },
        )
        del albedo, base
    tone, ita = skin_tone(cheek)
    has_straps = convert_straps(maps, dna, folder, web_root, cache, textures)

    for job in skin_jobs(maps):
        output = folder / job.file_name
        job_print = texture_print(job.recipe(), job.source)
        if cache.fresh(output, job_print):
            textures.add(job.role, output, web_root, output.stat().st_size)
            continue
        pixels = prepare(job.source, job.size, job.kind, job.channels)
        textures.add(job.role, output, web_root, encode_ktx2(pixels, output, job.settings))
        cache.remember(output, job_print)
    # Written before the SRMF bake was found to carry the cavity (see the module docstring).
    for retired in ("face_cavity.ktx2", "body_cavity.ktx2"):
        (folder / retired).unlink(missing_ok=True)
    convert_body_albedo(maps, folder, web_root, cache, textures)
    convert_body_srmf(maps, folder, web_root, cache, textures)
    masks = write_masks(maps, web_root)
    underwear = write_underwear(maps, web_root)

    files = textures.files
    entry: dict[str, Any] = {
        "id": f"skin.{maps.name}",
        "label": maps.name,
        "tone": round(tone, 4),
        "swatch": hex_color(cheek),
        "face": {
            "albedo": files["face_albedo"],
            "normal": files["face_normal"],
            "srmf": files["face_srmf"],
            "wrinkleColor": [files[f"face_cm{i}"] for i in (1, 2, 3)],
            "wrinkleNormal": [files[f"face_wm{i}"] for i in (1, 2, 3)],
            "wrinkleMasks": masks,
            **({"underwear": {"straps": files["face_underwear"]}} if has_straps else {}),
        },
        "body": {
            "albedo": files["body_albedo"],
            "normal": files["body_normal"],
            "srmf": files["body_srmf"],
            **({"underwear": underwear} if underwear else {}),
        },
    }
    if "makeup" in files:
        entry["makeupAlbedo"] = files["makeup"]
    entry["stats"] = {
        "cheek_linear": [round(float(v), 5) for v in cheek],
        "ita_degrees": round(ita, 2),
        "makeup_texel_share": round(makeup_share, 4),
        "bytes": dict(textures.sizes),
    }
    return entry


def convert_iris(maps: PresetMaps, web_root: Path) -> dict[str, Any]:
    folder = web_root / "irises" / maps.name
    color = prepare(maps.maps / "Eyes_Color.png", EYE_SIZE, "color")
    encode_ktx2(color, folder / "color.ktx2", COLOR)
    encode_ktx2(
        prepare(maps.maps / "Eyes_Normal.png", EYE_SIZE, "normal"), folder / "normal.ktx2", NORMAL
    )
    return {
        "id": f"iris.{maps.name}",
        "label": maps.name,
        "color": (folder / "color.ktx2").relative_to(web_root).as_posix(),
        "normal": (folder / "normal.ktx2").relative_to(web_root).as_posix(),
        "swatch": iris_swatch(color),
    }


MOUTH_EYE_MAPS: dict[str, tuple[str, int, Kind, Ktx2Settings, int]] = {
    # output file -> (DCC map, size, kind, settings, channels)
    "teeth_color.ktx2": ("Teeth_Color", EYE_SIZE, "color", COLOR, 3),
    "teeth_normal.ktx2": ("Teeth_Normal", EYE_SIZE, "normal", NORMAL, 3),
    "eyelashes_color.ktx2": ("Eyelashes_Color", EYE_SIZE, "color", COLOR, 4),
}


def convert_head_maps(maps: PresetMaps, folder: Path) -> dict[str, int]:
    """Teeth and eyelash maps the head GLB references, written into `folder`.
    Returns {file name: bytes}."""
    written = {}
    for file_name, (source, size, kind, settings, channels) in MOUTH_EYE_MAPS.items():
        written[file_name] = encode_ktx2(
            prepare(maps.maps / f"{source}.png", size, kind, channels), folder / file_name, settings
        )
    return written


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8", newline="\n")
    temporary.replace(path)


def remove_tree(path: Path, inside: Path) -> None:
    """Delete an obsolete output folder, refusing anything outside `inside`."""
    if path.exists() and path.resolve().is_relative_to(inside.resolve()):
        shutil.rmtree(path)
