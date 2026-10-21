"""Near-duplicate pre-pass: surface and motion measures, clustering, curation writes."""

import json
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from asset_pipeline.mh.similar import (
    Item,
    Motion,
    Pair,
    Proposal,
    aligned_distance,
    apply_proposals,
    judge_looks,
    look_difference,
    motion_distance,
    propose,
    sample_surface,
    shape,
    shape_distance,
    surface_distance,
)


def _square(size: float = 0.1, z: float = 0.0) -> tuple[np.ndarray, np.ndarray]:
    vertices = np.array([[0, 0, z], [size, 0, z], [size, size, z], [0, size, z]], dtype=float)
    return vertices, np.array([[0, 1, 2], [0, 2, 3]], dtype=np.int64)


def test_samples_lie_on_the_surface_and_repeat_for_a_seed() -> None:
    vertices, triangles = _square()
    points = sample_surface(vertices, triangles, count=500)
    assert np.allclose(points[:, 2], 0.0)
    assert points[:, :2].min() >= 0.0 and points[:, :2].max() <= 0.1
    assert np.array_equal(points, sample_surface(vertices, triangles, count=500))


def test_surface_distance_is_in_millimetres() -> None:
    flat = shape(*_square())
    assert surface_distance(flat, flat) == pytest.approx(0.0, abs=1e-9)
    lifted = shape(*_square(z=0.001))
    assert surface_distance(flat, lifted) == pytest.approx(1.0, abs=0.05)


def test_surfaces_of_different_area_are_never_duplicates() -> None:
    assert shape_distance(shape(*_square(0.1)), shape(*_square(0.2))) is None
    assert shape_distance(shape(*_square(0.1)), shape(*_square(0.105))) is not None


def test_clusters_need_every_member_close_and_keep_the_richest() -> None:
    items = [Item("a", "g", 1.0), Item("b", "g", 5.0), Item("c", "g", 2.0)]
    pairs = [Pair("a", "b", 0.1), Pair("b", "c", 0.2), Pair("a", "c", 9.0)]
    assert propose(items, pairs, 1.0, "g") == [Proposal("a", "b", 0.1, "g")]
    assert propose(items, pairs, 0.05, "g") == []


def _thumbnail(path: Path, brow: int) -> Path:
    pixels = np.full((64, 64, 3), 120, dtype=np.uint8)
    pixels[20:24, 10:54] = brow  # the only part two grooms on one head differ in
    Image.fromarray(pixels).save(path)
    return path


def test_thumbnails_differ_by_their_visible_change(tmp_path: Path) -> None:
    dark = _thumbnail(tmp_path / "dark.webp", 30)
    assert look_difference(dark, _thumbnail(tmp_path / "same.webp", 30)) == 0.0
    assert look_difference(dark, _thumbnail(tmp_path / "light.webp", 100)) == pytest.approx(70.0)
    assert look_difference(dark, tmp_path / "missing.webp") is None


def test_grooms_close_in_shape_but_not_in_look_are_kept(tmp_path: Path) -> None:
    items = [Item("a", "eyebrows", 1.0), Item("b", "eyebrows", 2.0), Item("c", "eyebrows", 3.0)]
    thumbnails = {
        "a": _thumbnail(tmp_path / "a.webp", 30),
        "b": _thumbnail(tmp_path / "b.webp", 31),
        "c": _thumbnail(tmp_path / "c.webp", 100),
    }
    pairs = judge_looks(
        [Pair("a", "b", 0.1), Pair("a", "c", 0.1), Pair("b", "c", 0.1)], 0.5, thumbnails
    )
    assert propose(items, pairs, 0.5, "eyebrows") == [Proposal("a", "b", 0.1, "eyebrows")]
    # Without thumbnails nothing in a groom slot is proposed.
    assert propose(items, [Pair("a", "b", 0.1)], 0.5, "eyebrows") == []


def _motion(frames: np.ndarray) -> Motion:
    mean = frames.mean(axis=0)
    mean /= np.linalg.norm(mean, axis=-1, keepdims=True)
    return Motion(frames, mean, np.zeros(frames.shape[1]), len(frames) / 15.0)


def _clip(seed: int, count: int = 60, joints: int = 4) -> np.ndarray:
    rng = np.random.default_rng(seed)
    angles = np.cumsum(rng.normal(0, 0.02, (count, joints)), axis=0)
    frames = np.zeros((count, joints, 4))
    frames[..., 0] = np.sin(angles / 2)  # rotations about x
    frames[..., 3] = np.cos(angles / 2)
    return frames


def test_a_shifted_loop_of_the_same_clip_aligns_to_zero() -> None:
    clip = _clip(1)
    shifted = np.roll(clip, 10, axis=0)
    assert aligned_distance(_motion(clip), _motion(shifted)) == pytest.approx(0.0, abs=1e-6)
    assert motion_distance(_motion(clip), _motion(clip)) == pytest.approx(0.0, abs=1e-6)
    assert motion_distance(_motion(clip), _motion(_clip(2))) > 1.0


def test_apply_keeps_user_choices_and_replaces_earlier_picks(tmp_path: Path) -> None:
    pick = {"keep": "k", "keepLabel": "K", "distance": 0.1, "unit": "mm"}
    (tmp_path / "curation.json").write_text(
        json.dumps(
            {
                "hidden": ["user.hidden", "old.pick"],
                # "restored" was picked before and shown again by the user.
                "auto": {"old.pick": pick, "restored": pick},
            }
        ),
        encoding="utf-8",
    )
    proposals = [Proposal("restored", "k", 0.2, "hair"), Proposal("new", "k", 0.3, "hair")]
    out = apply_proposals(tmp_path, proposals, {"k": "Kept"})

    assert out["hidden"] == ["new", "user.hidden"]
    assert sorted(out["auto"]) == ["new", "restored"]
    assert out["auto"]["new"] == {"keep": "k", "keepLabel": "Kept", "distance": 0.3, "unit": "mm"}
    assert json.loads((tmp_path / "curation.json").read_text(encoding="utf-8")) == out
