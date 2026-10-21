"""Texture preparation: filtering, normal-map conventions, skin measurements, albedo fix."""

import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from asset_pipeline.mh import ktx
from asset_pipeline.mh.textures import (
    TextureCache,
    bare_body_albedo,
    compose_face_albedo,
    downsample,
    feathered,
    fill_texels,
    find_straps,
    flip_green,
    hex_color,
    iris_swatch,
    linear_to_srgb,
    normal_convention,
    push_pull_fill,
    skin_tone,
    srgb_to_linear,
    strap_mask,
    underwear_texels,
)


def _height_field_normals(size: int, opengl: bool) -> np.ndarray:
    """Tangent-space normal map of a bumpy height field in either green convention."""
    rows, cols = np.mgrid[0:size, 0:size] / size
    height = 0.03 * np.sin(9 * cols) * np.cos(7 * rows) + 0.02 * np.sin(23 * cols + 13 * rows)
    d_col = np.gradient(height, axis=1) * size
    d_row = np.gradient(height, axis=0) * size
    # OpenGL: +Y up the image, i.e. against the row direction.
    ny = d_row if opengl else -d_row
    normals = np.stack([-d_col, ny, np.ones_like(height)], axis=-1)
    normals /= np.linalg.norm(normals, axis=-1, keepdims=True)
    return np.round(normals * 127.5 + 127.5).astype(np.uint8)


@pytest.mark.parametrize("opengl", [True, False])
def test_normal_convention_reads_the_green_sign(opengl: bool) -> None:
    pixels = _height_field_normals(512, opengl)
    convention, margin = normal_convention(pixels)
    assert convention == ("opengl" if opengl else "directx")
    assert margin > 2.0, f"margin {margin:.2f}"
    flipped, _ = normal_convention(flip_green(pixels))
    assert flipped != convention


def test_downsample_filters_colour_in_linear_light() -> None:
    pixels = np.zeros((4, 4, 3), dtype=np.uint8)
    pixels[::2, ::2] = 255  # a quarter of the texels white
    out = downsample(pixels, 2, "color")
    expected = linear_to_srgb(np.array([0.25, 0.25, 0.25]))
    assert np.all(out == expected), "box filter must average linear values, not sRGB codes"


def test_downsample_renormalises_normals() -> None:
    pixels = _height_field_normals(64, True)
    vectors = downsample(pixels, 16, "normal").astype(np.float64) / 127.5 - 1.0
    lengths = np.linalg.norm(vectors, axis=-1)
    assert np.all(np.abs(lengths - 1.0) < 0.02)


def test_srgb_round_trip_is_exact_for_codes() -> None:
    codes = np.arange(256, dtype=np.uint8)
    assert np.array_equal(linear_to_srgb(srgb_to_linear(codes)), codes)


def test_skin_tone_orders_light_to_dark() -> None:
    light, _ = skin_tone(srgb_to_linear(np.array([233, 196, 175], dtype=np.uint8)))
    medium, _ = skin_tone(srgb_to_linear(np.array([185, 135, 105], dtype=np.uint8)))
    dark, _ = skin_tone(srgb_to_linear(np.array([96, 60, 44], dtype=np.uint8)))
    assert 0.0 <= light < medium < dark <= 1.0


def test_hex_color_encodes_srgb() -> None:
    assert hex_color(np.array([1.0, 0.0, 0.0])) == "#ff0000"
    assert hex_color(srgb_to_linear(np.array([18, 52, 86], dtype=np.uint8))) == "#123456"


def test_iris_swatch_reads_the_ring_around_the_pupil() -> None:
    size = 256
    yy, xx = np.mgrid[0:size, 0:size]
    radius = np.hypot(xx - (size - 1) / 2, yy - (size - 1) / 2) / size
    image = np.full((size, size, 3), 230, dtype=np.uint8)  # sclera
    image[radius < 0.14] = (40, 90, 160)  # blue iris
    image[radius < 0.04] = 0  # pupil
    assert iris_swatch(image) == "#285aa0"


def test_feathered_mask_is_one_inside_and_fades_outside() -> None:
    mask = np.zeros((64, 64), dtype=bool)
    mask[:, :20] = True
    weight = feathered(mask, 8.0)
    assert np.all(weight[:, :20] == 1.0)
    assert np.all(np.diff(weight[0, 19:30]) <= 0) and weight[0, 28] == 0.0


def test_face_albedo_takes_the_bake_in_the_flap_and_its_levels_elsewhere() -> None:
    size = 256
    rng = np.random.default_rng(3)
    detail = rng.integers(-12, 12, size=(size, size, 1))
    synth = np.clip(150 + detail, 0, 255).astype(np.uint8).repeat(3, axis=2)
    bake = np.full((size // 2, size // 2, 3), 140, dtype=np.uint8)  # 2x smaller, darker
    bake[-16:] = (128, 128, 128)  # the painted top in the flap rows
    flap = np.zeros((size, size), dtype=bool)
    flap[-32:] = True
    result = compose_face_albedo(synth, bake, None, flap)
    top = srgb_to_linear(result.base[-24:, :, :3]).mean()
    assert abs(top - srgb_to_linear(np.array([128], dtype=np.uint8))[0]) < 0.01
    face = result.base[: size // 2].astype(np.float64)
    assert (
        abs(srgb_to_linear(result.base[: size // 2]).mean() - srgb_to_linear(bake[:64]).mean())
        < 0.01
    )
    assert face.std() > 3.0, "the synthesized detail survives the level match"
    assert result.makeup is None


def test_face_albedo_adds_the_makeup_difference() -> None:
    size = 128
    synth = np.full((size, size, 3), 150, dtype=np.uint8)
    bake = np.full((size // 2, size // 2, 3), 150, dtype=np.uint8)
    makeup = bake.copy()
    makeup[10:20, 10:40] = (160, 40, 60)  # lipstick
    flap = np.zeros((size, size), dtype=bool)
    result = compose_face_albedo(synth, bake, makeup, flap)
    assert result.makeup is not None and result.makeup_share > 0.05
    lips = result.makeup[24:36, 24:76].astype(np.int64)
    assert lips[..., 0].mean() > lips[..., 1].mean() + 60


def test_ktx2_settings_name_the_format_and_transfer() -> None:
    args = ktx.Ktx2Settings("srgb", rdo=1.0).arguments(3)
    assert args[:2] == ["--format", "R8G8B8_SRGB"] and "--generate-mipmap" in args
    assert ktx.Ktx2Settings("linear", rdo=None).arguments(4)[1] == "R8G8B8A8_UNORM"


@pytest.mark.skipif(not ktx.is_available(), reason="KTX-Software not installed")
def test_encode_ktx2_round_trips_through_ktx_extract(tmp_path: Path) -> None:
    rng = np.random.default_rng(5)
    image = rng.integers(0, 256, size=(64, 64, 3), dtype=np.uint8)
    image = np.repeat(np.repeat(image[::8, ::8], 8, axis=0), 8, axis=1)  # blocky, compressible
    output = tmp_path / "test.ktx2"
    size = ktx.encode_ktx2(image, output, ktx.Ktx2Settings("linear", rdo=None))
    assert size == output.stat().st_size > 0
    assert output.read_bytes()[:12] == b"\xabKTX 20\xbb\r\n\x1a\n"
    executable = ktx.ktx_executable()
    extracted = tmp_path / "out.png"
    result = subprocess.run(
        [str(executable), "extract", "--transcode", "rgba8", str(output), str(extracted)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    decoded = np.asarray(Image.open(extracted).convert("RGB")).astype(np.int64)
    assert np.abs(decoded - image).mean() < 3.0


def test_ktx_executable_honours_the_environment(tmp_path: Path, monkeypatch) -> None:
    name = "ktx.exe" if sys.platform == "win32" else "ktx"
    fake = tmp_path / name
    fake.write_bytes(b"")
    monkeypatch.setenv(ktx.KTX_TOOLS_ENV, str(tmp_path))
    assert ktx.ktx_executable() == fake


def test_texture_cache_keeps_maps_whose_print_matches(tmp_path: Path) -> None:
    cache = TextureCache.load(tmp_path / "cache" / "skin.json")
    output = tmp_path / "web" / "face_normal.ktx2"
    assert not cache.fresh(output, "a")
    output.parent.mkdir(parents=True)
    output.write_bytes(b"ktx")
    cache.remember(output, "a", measurements={"tone": 0.5})
    reloaded = TextureCache.load(tmp_path / "cache" / "skin.json")
    assert reloaded.fresh(output, "a") and not reloaded.fresh(output, "b")
    assert reloaded.get(output, "measurements") == {"tone": 0.5}
    output.unlink()
    assert not reloaded.fresh(output, "a"), "a deleted output is rebuilt"


def _skin_with_underwear(size: int = 64) -> tuple[np.ndarray, np.ndarray]:
    """Skin-coloured albedo with a grey cloth square; the mask covers the square and a skin
    strip beside it (a man's chest under the mask's top channel)."""
    albedo = np.empty((size, size, 3), dtype=np.uint8)
    albedo[:] = (150, 100, 80)
    albedo[16:32, 16:32] = (125, 125, 125)
    mask = np.zeros((size, size, 2), dtype=np.float32)
    mask[16:32, 16:32, 0] = 1.0
    mask[16:32, 40:48, 0] = 1.0
    return albedo, mask


def test_underwear_texels_take_the_grey_cloth_not_skin_under_the_mask() -> None:
    albedo, mask = _skin_with_underwear()
    texels = underwear_texels(albedo, mask)
    assert texels[16:32, 16:32].all(), "the grey cloth is underwear"
    assert texels[15, 20] and texels[20, 34], "a few texels past the hem go too"
    assert not texels[16:32, 40:48].any(), "skin under the mask stays"
    assert not texels[50:, 50:].any()


def test_push_pull_fill_takes_the_colour_around_the_hole() -> None:
    image = np.full((64, 64, 3), (150.0, 100.0, 80.0), dtype=np.float32)
    hole = np.zeros((64, 64), dtype=bool)
    hole[10:40, 10:40] = True
    image[hole] = 0.0
    filled = push_pull_fill(image, hole)
    np.testing.assert_allclose(filled[hole], np.tile([150.0, 100.0, 80.0], (900, 1)), atol=0.5)
    np.testing.assert_array_equal(filled[~hole], image[~hole])


def test_fill_texels_ignores_padding_off_the_uv_islands() -> None:
    # A strap reaches the island's edge; the light padding past it must not tint the fill.
    image = np.full((64, 64, 3), (90, 55, 40), dtype=np.uint8)
    island = np.ones((64, 64), dtype=bool)
    island[48:] = False
    image[~island] = (200, 190, 180)
    hole = np.zeros((64, 64), dtype=bool)
    hole[30:52, 20:30] = True
    filled = fill_texels(image, hole, island)
    worst = np.abs(filled[hole & island].astype(int) - (90, 55, 40)).max()
    assert worst <= 1, f"fill strays {worst} from the skin around the hole"
    np.testing.assert_array_equal(filled[~hole], image[~hole])


def test_bare_body_albedo_removes_the_cloth() -> None:
    albedo, mask = _skin_with_underwear()
    bare = bare_body_albedo(albedo, mask)
    np.testing.assert_allclose(bare[20, 20], (150, 100, 80), atol=1)
    np.testing.assert_array_equal(bare[16:32, 40:48], albedo[16:32, 40:48])


def test_find_straps_takes_grey_cloth_in_the_flap_only() -> None:
    albedo = np.empty((64, 64, 3), dtype=np.uint8)
    albedo[:] = (150, 100, 80)
    albedo[50:56, 10:20] = (128, 128, 128)  # a strap in the flap
    albedo[5:10, 10:20] = (128, 128, 128)  # grey outside the flap (not underwear)
    flap = np.zeros((64, 64), dtype=bool)
    flap[44:, :] = True
    straps = find_straps(albedo, flap)
    assert straps is not None
    assert straps.texels[50:56, 10:20].all()
    assert not straps.texels[5:10, 10:20].any()
    np.testing.assert_allclose(
        straps.color, srgb_to_linear(np.array([128, 128, 128]))[0], atol=1e-3
    )
    albedo[50:56, 10:20] = (150, 100, 80)
    assert find_straps(albedo, flap) is None


def test_strap_mask_averages_down_to_soft_edges() -> None:
    texels = np.zeros((8, 8), dtype=bool)
    texels[0:2, 0:2] = True
    texels[0:2, 2:3] = True
    mask = strap_mask(texels, 4)
    assert mask.shape == (4, 4, 3)
    assert mask[0, 0, 0] == 255 and mask[0, 1, 0] == 128 and mask[2, 2, 0] == 0
    assert not mask[..., 1:].any()
