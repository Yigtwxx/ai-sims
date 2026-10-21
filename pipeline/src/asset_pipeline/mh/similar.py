"""Near-duplicate pre-pass over the converted catalogue, before the user curates.

Each category is compared in its own terms:

- grooms (per slot): the LOD0 card surfaces, all fitted to the same reference head,
  are sampled and compared point to point. The distance of a pair is the larger of
  the two directional mean nearest-point distances (mm), so a short style is never
  a duplicate of a long one that merely contains it. Cards whose total area differs
  by more than AREA_RATIO are never duplicates: brows and moustaches read by density
  as much as by outline.
- outfits: the same surface measure on the shared base body, per gender, within one
  category; a pair counts only when every gender both items exist for is close.
- faces: neutral LOD0 head meshes (same topology for every preset) from the DNA,
  centred, compared vertex to vertex (RMS, mm).
- body animations: per-joint local rotations sampled over the clip, compared frame
  by frame at the best time offset (mean joint angle, degrees). A cheap comparison
  of mean pose and motion range rules out most pairs first.

Thresholds are deliberately tight: the pass only removes what a viewer could not tell
apart; anything merely alike is left for the user. Geometry alone misses what the
textures carry (a dense brow and a sparse one share their cards), so a groom or outfit
pair also needs its thumbnails, rendered in one fixed pose, to match pixel for pixel
(LOOK_LIMIT); a pair without both thumbnails is never proposed.

Pairs under a category's threshold are clustered with complete linkage (every
member is close to every other member). Each cluster keeps its richest member
(most geometry, longest clip) and proposes the others; proposals are written to
curation.json under `auto` and added to `hidden`, where the curation screen shows
them as pre-pass picks the user can restore. Nothing is deleted here.
"""

from __future__ import annotations

import argparse
import json
import os
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray
from PIL import Image
from scipy.spatial import cKDTree

from asset_pipeline.mh.glb import accessor_array, accessor_values, read_glb

COMMAND = "mh-similar"
CURATION_FILE = "curation.json"
REPORT_FILE = Path("build") / "similar.json"
SAMPLES = 40_000
SEED = 7

F64 = NDArray[np.float64]

# Largest distance at which two items still count as the same thing to the eye.
# Chosen by inspecting the closest pairs of the real catalogue side by side
# (2026-10-21: hair styles 2.1 mm apart and tee sleeve variants 2.8 mm apart are
# visibly different; idle clips 1.1 deg apart are the same take).
THRESHOLDS: dict[str, float] = {
    "hair": 1.5,
    "eyebrows": 0.5,
    "beard": 1.0,
    "mustache": 0.6,
    "outfit": 1.5,
    "face": 1.0,
    "animation": 1.5,
}
UNITS = {"animation": "deg"}
AREA_RATIO = 1.25
# Largest 99th-percentile pixel difference (0-255) between two thumbnails that still
# reads as one look. The faintest visible brow difference in the catalogue (a shaded
# brow against a thin arch) measures 16; render noise stays well under 8.
LOOK_LIMIT = 8.0
LOOK_GROUPS = frozenset({"hair", "eyebrows", "beard", "mustache", "outfit"})
# Clip pairs whose mean pose or motion range differ more than this skip the aligned check.
MOTION_PREFILTER = 4.0

# Joints whose local rotations describe a body clip (present in every MetaHuman body).
CLIP_JOINTS = (
    "pelvis",
    "spine_01",
    "spine_02",
    "spine_03",
    "spine_04",
    "spine_05",
    "neck_01",
    "neck_02",
    "head",
    "clavicle_l",
    "clavicle_r",
    "upperarm_l",
    "upperarm_r",
    "lowerarm_l",
    "lowerarm_r",
    "hand_l",
    "hand_r",
    "thigh_l",
    "thigh_r",
    "calf_l",
    "calf_r",
    "foot_l",
    "foot_r",
)
CLIP_RATE = 15.0


class SimilarError(RuntimeError):
    """The catalogue cannot be compared (missing manifest or unreadable curation)."""


@dataclass(frozen=True)
class Item:
    id: str
    group: str
    richness: float
    label: str = ""


@dataclass(frozen=True)
class Pair:
    a: str
    b: str
    distance: float
    look: float | None = None  # thumbnail difference, for pairs under the threshold


@dataclass(frozen=True)
class Proposal:
    id: str
    keep: str
    distance: float
    group: str


@dataclass
class GroupResult:
    group: str
    threshold: float
    unit: str
    items: list[Item]
    pairs: list[Pair] = field(default_factory=list)
    proposals: list[Proposal] = field(default_factory=list)


# --- geometry ---------------------------------------------------------------------------


def _node_meshes(document: Mapping[str, Any]) -> list[int]:
    return [int(node["mesh"]) for node in document.get("nodes", []) if "mesh" in node]


def read_surface(
    path: Path, mesh_names: Sequence[str] | None = None
) -> tuple[F64, NDArray[np.int64]]:
    """Positions and triangles of the meshes in a GLB (all, or those named), in metres.

    Mesh nodes carry no transforms in the converter's output, so positions are used
    as stored."""
    document, binary = read_glb(path.read_bytes())
    vertices: list[F64] = []
    triangles: list[NDArray[np.int64]] = []
    offset = 0
    for index in _node_meshes(document):
        mesh = document["meshes"][index]
        if mesh_names is not None and mesh.get("name") not in mesh_names:
            continue
        for primitive in mesh["primitives"]:
            if primitive.get("mode", 4) != 4:
                continue
            positions = accessor_values(document, binary, primitive["attributes"]["POSITION"])
            if "indices" in primitive:
                indices = accessor_array(document, binary, primitive["indices"]).reshape(-1)
            else:
                indices = np.arange(len(positions))
            vertices.append(positions)
            triangles.append(indices.astype(np.int64).reshape(-1, 3) + offset)
            offset += len(positions)
    if not vertices:
        raise SimilarError(f"{path} has no triangle meshes")
    return np.concatenate(vertices), np.concatenate(triangles)


def sample_surface(
    vertices: F64, triangles: NDArray[np.int64], count: int = SAMPLES, seed: int = SEED
) -> F64:
    """Area-weighted random points on the triangles (deterministic for a seed)."""
    a, b, c = (vertices[triangles[:, k]] for k in range(3))
    areas = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
    total = areas.sum()
    if total <= 0:
        return vertices.copy()
    rng = np.random.default_rng(seed)
    chosen = rng.choice(len(triangles), size=count, p=areas / total)
    u, v = rng.random(count), rng.random(count)
    flip = u + v > 1
    u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    return a[chosen] + (b[chosen] - a[chosen]) * u[:, None] + (c[chosen] - a[chosen]) * v[:, None]


def surface_area(vertices: F64, triangles: NDArray[np.int64]) -> float:
    a, b, c = (vertices[triangles[:, k]] for k in range(3))
    return float(0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1).sum())


@dataclass(frozen=True)
class Shape:
    points: F64
    tree: cKDTree
    area: float  # square metres


def shape(vertices: F64, triangles: NDArray[np.int64]) -> Shape:
    points = sample_surface(vertices, triangles)
    return Shape(points, cKDTree(points), surface_area(vertices, triangles))


def surface_distance(first: Shape, second: Shape) -> float:
    """Larger of the two directional mean nearest-point distances, in millimetres."""
    there = first.tree.query(second.points, k=1)[0].mean()
    back = second.tree.query(first.points, k=1)[0].mean()
    return float(max(there, back) * 1000.0)


def shape_distance(first: Shape, second: Shape) -> float | None:
    """Surface distance, or None when the surface areas are too far apart to compare."""
    small, large = sorted((first.area, second.area))
    if small <= 0 or large / small > AREA_RATIO:
        return None
    return surface_distance(first, second)


# --- thumbnails ---------------------------------------------------------------------------


def look_difference(first: Path, second: Path) -> float | None:
    """99th-percentile per-pixel difference (mean over RGB, 0-255) of two thumbnails;
    None when either is missing or their sizes differ."""
    if not first.is_file() or not second.is_file():
        return None
    with Image.open(first) as a, Image.open(second) as b:
        pixels_a = np.asarray(a.convert("RGB"), dtype=np.float64)
        pixels_b = np.asarray(b.convert("RGB"), dtype=np.float64)
    if pixels_a.shape != pixels_b.shape:
        return None
    return float(np.percentile(np.abs(pixels_a - pixels_b).mean(axis=2), 99))


def judge_looks(
    pairs: Sequence[Pair], threshold: float, thumbnails: Mapping[str, Path]
) -> list[Pair]:
    """Pairs under the threshold with their thumbnail difference filled in."""
    judged = []
    for pair in pairs:
        if pair.distance <= threshold and pair.a in thumbnails and pair.b in thumbnails:
            look = look_difference(thumbnails[pair.a], thumbnails[pair.b])
            if look is not None:
                pair = Pair(pair.a, pair.b, pair.distance, round(look, 1))
        judged.append(pair)
    return judged


# --- animation ----------------------------------------------------------------------------


def _slerp_free_sample(times: F64, values: F64, at: F64) -> F64:
    """Per-component linear interpolation of unit quaternions, renormalized."""
    aligned = values.copy()
    for k in range(1, len(aligned)):
        if np.dot(aligned[k], aligned[k - 1]) < 0:
            aligned[k] = -aligned[k]
    sampled = np.stack([np.interp(at, times, aligned[:, i]) for i in range(4)], axis=1)
    return sampled / np.linalg.norm(sampled, axis=1, keepdims=True)


def _angle(a: F64, b: F64) -> F64:
    """Rotation angle between unit quaternions, degrees (sign-agnostic)."""
    dots = np.clip(np.abs(np.sum(a * b, axis=-1)), 0.0, 1.0)
    return np.degrees(2.0 * np.arccos(dots))


@dataclass(frozen=True)
class Motion:
    frames: F64  # (T, J, 4) local rotation per joint, sampled at CLIP_RATE
    mean: F64  # (J, 4) mean local rotation per joint
    swing: F64  # (J,) RMS angle from the mean per joint, degrees
    duration: float


def read_motion(path: Path, joints: Sequence[str] = CLIP_JOINTS) -> Motion | None:
    """Joint rotation statistics of a body clip; None when it lacks the joints."""
    document, binary = read_glb(path.read_bytes())
    animations = document.get("animations") or []
    if not animations:
        return None
    names = {i: node.get("name") for i, node in enumerate(document.get("nodes", []))}
    animation = animations[0]
    tracks: dict[str, tuple[F64, F64]] = {}
    end = 0.0
    for channel in animation["channels"]:
        if channel["target"].get("path") != "rotation":
            continue
        name = names.get(channel["target"].get("node"))
        if name not in joints:
            continue
        sampler = animation["samplers"][channel["sampler"]]
        times = accessor_values(document, binary, sampler["input"]).reshape(-1)
        values = accessor_values(document, binary, sampler["output"]).reshape(-1, 4)
        tracks[name] = (times, values)
        end = max(end, float(times[-1]))
    if len(tracks) < len(joints) * 0.75 or end <= 0:
        return None
    at = np.arange(0.0, end + 1e-9, 1.0 / CLIP_RATE)
    frames, means, swings = [], [], []
    for joint in joints:
        if joint in tracks:
            times, values = tracks[joint]
            sampled = _slerp_free_sample(times, values, at)
        else:
            sampled = np.tile([0.0, 0.0, 0.0, 1.0], (len(at), 1))
        signs = np.sign(sampled @ sampled[0])
        signs[signs == 0] = 1
        mean = (sampled * signs[:, None]).mean(axis=0)
        mean /= np.linalg.norm(mean)
        frames.append(sampled)
        means.append(mean)
        swings.append(float(np.sqrt(np.mean(_angle(sampled, mean[None, :]) ** 2))))
    return Motion(np.stack(frames, axis=1), np.array(means), np.array(swings), end)


def aligned_distance(first: Motion, second: Motion, step: int = 2) -> float:
    """Mean joint angle between the clips frame by frame, at the time offset (of the
    second, looped) where they agree best; over the shorter clip's length."""
    count = min(len(first.frames), len(second.frames))
    best = np.inf
    for shift in range(0, len(second.frames), step):
        rolled = np.roll(second.frames, -shift, axis=0)[:count]
        best = min(best, float(np.mean(_angle(first.frames[:count], rolled))))
    return best


def motion_distance(first: Motion, second: Motion) -> float:
    """Aligned frame distance in degrees. Pairs whose mean pose or motion range already
    differ by more than MOTION_PREFILTER return that cheaper figure instead."""
    pose = float(np.mean(_angle(first.mean, second.mean)))
    swing = float(np.mean(np.abs(first.swing - second.swing)))
    if max(pose, swing) > MOTION_PREFILTER:
        return max(pose, swing)
    return aligned_distance(first, second)


# --- clustering ---------------------------------------------------------------------------


def close_pairs(
    items: Sequence[Item], distance: Callable[[Item, Item], float | None]
) -> list[Pair]:
    pairs = []
    for i, first in enumerate(items):
        for second in items[i + 1 :]:
            value = distance(first, second)
            if value is not None:
                pairs.append(Pair(first.id, second.id, round(value, 3)))
    return sorted(pairs, key=lambda pair: pair.distance)


def _close(pair: Pair, threshold: float, group: str) -> bool:
    if pair.distance > threshold:
        return False
    if group not in LOOK_GROUPS:
        return True
    return pair.look is not None and pair.look <= LOOK_LIMIT


def propose(
    items: Sequence[Item], pairs: Iterable[Pair], threshold: float, group: str
) -> list[Proposal]:
    """Complete-linkage clusters of close pairs (under `threshold`, and for grooms and
    outfits matching thumbnails); each keeps its richest member."""
    close = [p for p in pairs if _close(p, threshold, group)]
    lookup = {(p.a, p.b): p.distance for p in close} | {(p.b, p.a): p.distance for p in close}
    rank = {item.id: (-item.richness, item.id) for item in items}
    clusters: list[list[str]] = []
    for pair in sorted(lookup.items(), key=lambda entry: entry[1]):
        (a, b), value = pair
        if value > threshold or a > b:
            continue
        home_a = next((c for c in clusters if a in c), None)
        home_b = next((c for c in clusters if b in c), None)
        if home_a is not None and home_a is home_b:
            continue
        merged = (home_a or [a]) + (home_b or [b])
        if all(lookup.get((x, y), np.inf) <= threshold for x in merged for y in merged if x != y):
            clusters = [c for c in clusters if c is not home_a and c is not home_b] + [merged]
    proposals = []
    for members in clusters:
        keep = min(members, key=rank.__getitem__)
        for member in sorted(members):
            if member != keep:
                proposals.append(Proposal(member, keep, lookup[(member, keep)], group))
    return proposals


# --- catalogue ----------------------------------------------------------------------------


def _manifest(archive: Path) -> dict[str, Any]:
    path = archive / "web" / "manifest.json"
    if not path.is_file():
        raise SimilarError(f"no manifest at {path}")
    data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return data


def _thumbnails(archive: Path, entries: Iterable[Mapping[str, Any]]) -> dict[str, Path]:
    web = archive / "web"
    return {e["id"]: web / e["thumbnail"] for e in entries if e.get("thumbnail")}


def _label(entry: Mapping[str, Any]) -> str:
    label = entry.get("label", "")
    return label.get("en", "") if isinstance(label, dict) else str(label)


def groom_groups(
    archive: Path, manifest: Mapping[str, Any], log: Callable[[str], None]
) -> list[GroupResult]:
    web = archive / "web"
    by_slot: dict[str, list[tuple[Item, Shape]]] = {}
    for entry in manifest.get("grooms", []):
        slot = entry.get("slot")
        if slot not in THRESHOLDS:
            continue
        vertices, triangles = read_surface(web / entry["glb"], ("cards_lod0",))
        item = Item(entry["id"], slot, float(len(triangles)), _label(entry))
        by_slot.setdefault(slot, []).append((item, shape(vertices, triangles)))
    thumbnails = _thumbnails(archive, manifest.get("grooms", []))
    results = []
    for slot, members in by_slot.items():
        log(f"compare {slot}: {len(members)} grooms")
        shapes = {item.id: surface for item, surface in members}
        items = [item for item, _ in members]
        pairs = close_pairs(items, lambda a, b, s=shapes: shape_distance(s[a.id], s[b.id]))
        results.append(_result(slot, items, pairs, thumbnails))
    return results


def outfit_group(
    archive: Path, manifest: Mapping[str, Any], log: Callable[[str], None]
) -> GroupResult:
    web = archive / "web"
    items: list[Item] = []
    shapes: dict[tuple[str, str], Shape] = {}
    categories: dict[str, str] = {}
    for entry in manifest.get("outfits", []):
        richness = 0.0
        for gender, relative in sorted(entry.get("files", {}).items()):
            vertices, triangles = read_surface(web / relative)
            shapes[(entry["id"], gender)] = shape(vertices, triangles)
            richness += len(triangles)
        items.append(Item(entry["id"], "outfit", richness, _label(entry)))
        categories[entry["id"]] = entry.get("category", "")
    log(f"compare outfit: {len(items)} outfits")

    def distance(a: Item, b: Item) -> float | None:
        if categories[a.id] != categories[b.id]:
            return None
        genders = [g for (i, g) in shapes if i == a.id and (b.id, g) in shapes]
        distances = [shape_distance(shapes[(a.id, g)], shapes[(b.id, g)]) for g in genders]
        if not distances or None in distances:
            return None
        return max(d for d in distances if d is not None)

    thumbnails = _thumbnails(archive, manifest.get("outfits", []))
    return _result("outfit", items, close_pairs(items, distance), thumbnails)


def face_group(
    archive: Path, manifest: Mapping[str, Any], log: Callable[[str], None]
) -> GroupResult:
    from asset_pipeline.mh.dna import read_dna

    shapes: dict[str, F64] = {}
    items = []
    for entry in manifest.get("faces", []):
        preset = entry["id"].split(".", 1)[1]
        path = archive / "raw" / "characters" / preset / "dcc" / preset / "head.dna"
        if not path.is_file():
            continue
        dna = read_dna(path, lods=[0], blend_shapes=False)
        head = dna.mesh(0)
        positions = np.asarray(head.positions, dtype=np.float64) * dna.descriptor.meters_per_unit
        shapes[entry["id"]] = positions - positions.mean(axis=0)
        items.append(Item(entry["id"], "face", 0.0, _label(entry)))
    log(f"compare face: {len(items)} heads")

    def distance(a: Item, b: Item) -> float | None:
        first, second = shapes[a.id], shapes[b.id]
        if first.shape != second.shape:
            return None
        return float(np.sqrt(np.mean(np.sum((first - second) ** 2, axis=1))) * 1000.0)

    return _result("face", items, close_pairs(items, distance))


def animation_group(
    archive: Path, manifest: Mapping[str, Any], log: Callable[[str], None]
) -> GroupResult:
    web = archive / "web"
    motions: dict[str, Motion] = {}
    items = []
    for entry in manifest.get("animations", []):
        if entry.get("kind") != "body":
            continue
        motion = read_motion(web / entry["file"])
        if motion is None:
            continue
        motions[entry["id"]] = motion
        items.append(Item(entry["id"], "animation", motion.duration, entry["id"]))
    log(f"compare animation: {len(items)} body clips")
    pairs = close_pairs(items, lambda a, b: motion_distance(motions[a.id], motions[b.id]))
    return _result("animation", items, pairs)


def _result(
    group: str,
    items: list[Item],
    pairs: list[Pair],
    thumbnails: Mapping[str, Path] | None = None,
) -> GroupResult:
    threshold = THRESHOLDS[group]
    if thumbnails is not None:
        pairs = judge_looks(pairs, threshold, thumbnails)
    return GroupResult(
        group,
        threshold,
        UNITS.get(group, "mm"),
        items,
        pairs,
        propose(items, pairs, threshold, group),
    )


GROUPS: dict[str, Callable[[Path, Mapping[str, Any], Callable[[str], None]], list[GroupResult]]] = {
    "grooms": groom_groups,
    "outfits": lambda archive, manifest, log: [outfit_group(archive, manifest, log)],
    "faces": lambda archive, manifest, log: [face_group(archive, manifest, log)],
    "animations": lambda archive, manifest, log: [animation_group(archive, manifest, log)],
}


# --- curation -------------------------------------------------------------------------------


def read_curation(web: Path) -> dict[str, Any]:
    path = web / CURATION_FILE
    if not path.is_file():
        return {"hidden": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise SimilarError(f"{path} is unreadable; fix or remove it first") from exc
    if not isinstance(data, dict) or not isinstance(data.get("hidden", []), list):
        raise SimilarError(f"{path} is not a curation file")
    return data


def apply_proposals(
    web: Path, proposals: Sequence[Proposal], labels: Mapping[str, str]
) -> dict[str, Any]:
    """Replace the pre-pass picks in curation.json and hide them.

    Earlier pre-pass picks are re-evaluated: one the pass no longer proposes leaves
    `hidden` again unless the user hid it too (it is not in `auto` then). Picks the
    user restored (in the previous `auto` but no longer hidden) stay visible."""
    curation = read_curation(web)
    hidden = set(curation.get("hidden", []))
    previous: dict[str, Any] = curation.get("auto", {}) or {}
    restored = {item for item in previous if item not in hidden}
    hidden -= set(previous)
    auto = {}
    for proposal in proposals:
        auto[proposal.id] = {
            "keep": proposal.keep,
            "keepLabel": labels.get(proposal.keep, proposal.keep),
            "distance": proposal.distance,
            "unit": UNITS.get(proposal.group, "mm"),
        }
        if proposal.id not in restored:
            hidden.add(proposal.id)
    out = {**curation, "hidden": sorted(hidden), "auto": dict(sorted(auto.items()))}
    path = web / CURATION_FILE
    temp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    temp.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    temp.replace(path)
    return out


def report(results: Sequence[GroupResult], closest: int = 6) -> list[str]:
    lines = []
    for result in results:
        unit = result.unit
        lines.append(
            f"{result.group:<10} {len(result.items):>3} items, {len(result.proposals)} proposed "
            f"(threshold {result.threshold} {unit})"
        )
        for proposal in result.proposals:
            lines.append(f"    hide {proposal.id}  ~ {proposal.keep}  {proposal.distance} {unit}")
        for pair in result.pairs:
            if pair.distance <= result.threshold and not _close(
                pair, result.threshold, result.group
            ):
                look = "no thumbnails" if pair.look is None else f"thumbnails differ by {pair.look}"
                lines.append(f"    kept {pair.a} ~ {pair.b}  {pair.distance} {unit}, {look}")
        shown = [p for p in result.pairs if p.distance > result.threshold][:closest]
        for pair in shown:
            lines.append(f"    near {pair.a} ~ {pair.b}  {pair.distance} {unit}")
    return lines


def write_report(archive: Path, results: Sequence[GroupResult]) -> Path:
    path = archive / REPORT_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {
        result.group: {
            "threshold": result.threshold,
            "unit": result.unit,
            "proposals": [vars(p) for p in result.proposals],
            "pairs": [vars(p) for p in result.pairs[:200]],
        }
        for result in results
    }
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return path


def add_parser(sub: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    parser = sub.add_parser(
        COMMAND, help="propose near-duplicate assets for the curation pre-pass (no deletion)"
    )
    parser.add_argument("--archive", type=Path, default=None)
    parser.add_argument(
        "--only", choices=sorted(GROUPS), action="append", help="compare these categories only"
    )
    parser.add_argument(
        "--apply", action="store_true", help="write the proposals into curation.json"
    )


def run(args: argparse.Namespace) -> int:
    from asset_pipeline.mh.convert import archive_root

    archive = args.archive or archive_root()
    try:
        manifest = _manifest(archive)
        results: list[GroupResult] = []
        for name in args.only or sorted(GROUPS):
            results.extend(GROUPS[name](archive, manifest, print))
        print("\n".join(report(results)))
        print(f"report: {write_report(archive, results)}")
        if args.apply:
            if args.only:
                raise SimilarError("--apply needs every category (drop --only)")
            labels = {
                entry["id"]: _label(entry)
                for key in ("faces", "grooms", "outfits", "animations")
                for entry in manifest.get(key, [])
            }
            proposals = [p for r in results for p in r.proposals]
            curation = apply_proposals(archive / "web", proposals, labels)
            print(
                f"curation: {len(curation['auto'])} pre-pass picks, "
                f"{len(curation['hidden'])} hidden"
            )
    except SimilarError as exc:
        print(f"error: {exc}")
        return 1
    return 0
