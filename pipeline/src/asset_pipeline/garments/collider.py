"""The outfit-base body closed at the neck, for garments that reach it.

Unreal's outfit-base body has no neck: the MetaHuman head mesh carries the neck and the
top of the chest and shoulders down to the neck seam. Tops are sewn and draped against
the body and a head: a preset head is put on the web body as the runtime puts it
(`fit_audit.place_head`, seam snapped) and carried to the outfit-base body by the
displacement of the body skin nearest to it, so its seam meets the base body's neck edge.
"""

import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray
from scipy.spatial import ConvexHull, cKDTree

from asset_pipeline.garments import GarmentError
from asset_pipeline.garments.body import BaseBody
from asset_pipeline.mh import fit_audit
from asset_pipeline.mh.outfits import BodyFit, base_body_path

F64 = NDArray[np.float64]
I64 = NDArray[np.int64]

NECK_FACES = {"female": "face.Ada", "male": "face.Victor"}
FILL_REACH = 0.025  # metres: deepest crease `fill_front_and_back` fills
FILL_SMOOTH = 0.02  # metres: radius the fill's lift is averaged over
HEAD_REACH = 0.07  # metres of neck kept above the neck seam's top (no skull or jaw)


@dataclass(frozen=True, eq=False)
class Neck:
    positions: F64  # (V, 3) outfit-base frame
    triangles: I64  # (T, 3)
    seam_top: float  # highest point of the neck seam


def neck(archive: Path, gender: str, face: str | None = None) -> Neck:
    web = archive / "web"
    manifest = json.loads((web / "manifest.json").read_text(encoding="utf-8"))
    entry = next((b for b in manifest["bodies"] if b["gender"] == gender), None)
    wanted = face or NECK_FACES[gender]
    head_entry = next((f for f in manifest["faces"] if f["id"] == wanted), None)
    if entry is None or head_entry is None:
        raise GarmentError(f"no {gender} body or face {wanted} in the web manifest")
    body = fit_audit.load_body(web, entry)
    head = fit_audit.load_head(web, head_entry)
    if head.seam is None:
        raise GarmentError(f"{wanted} has no neck seam")
    rest, _ = fit_audit.place_head(
        fit_audit.rig_head(head, body), fit_audit.body_state(body, "neutral", {})
    )
    fit = BodyFit.load(web / entry["glb"], base_body_path(archive, gender), gender)
    distance, index = cKDTree(fit.positions).query(rest, k=8)
    weight = 1.0 / np.maximum(distance, 1e-4) ** 2
    shift = (fit.displacement[index] * weight[..., None]).sum(1) / weight.sum(1, keepdims=True)
    positions = rest - shift
    triangles = head.asset.mesh.triangles
    seam_top = float(positions[head.seam.boundary, 1].max())
    keep = (positions[triangles, 1] < seam_top + HEAD_REACH).all(1)
    return Neck(positions, triangles[keep].astype(np.int64), seam_top)


def closed_body(body: BaseBody, neck_part: Neck) -> tuple[F64, I64]:
    """Body and neck as one collider."""
    used = np.unique(neck_part.triangles)
    remap = np.full(len(neck_part.positions), -1, np.int64)
    remap[used] = np.arange(len(used)) + len(body.positions)
    return (
        np.concatenate([body.positions, neck_part.positions[used]]),
        np.concatenate([body.triangles, remap[neck_part.triangles]]),
    )


def fill_front_and_back(
    positions: F64,
    sections: Callable[[float], F64],
    region: NDArray[np.bool_],
    reach: float = FILL_REACH,
) -> F64:
    """The body with each horizontal section's front and back filled out to its convex
    hull inside `region`: cloth over the groin and the seat bridges the creases there
    (a fly front, a seat seam), as the hull of that height does."""
    out = positions.copy()
    for height in np.unique(np.round(positions[region, 1], 3)):
        rows = region & (np.round(positions[:, 1], 3) == height)
        section = sections(float(height))
        hull = section[ConvexHull(section).vertices]
        middle = float(hull[:, 1].mean())
        for sign in (1.0, -1.0):
            side = hull[sign * (hull[:, 1] - middle) > 0]
            if len(side) < 2:
                continue
            order = np.argsort(side[:, 0])
            here = rows & (sign * (positions[:, 2] - middle) > 0)
            edge = np.interp(positions[here, 0], side[order, 0], side[order, 1])
            # Creases only: skin further in than `reach` faces inward (under the
            # crotch, between the thighs) and stays.
            depth = sign * (edge - positions[here, 2])
            fill = (depth > 0) & (depth < reach)
            rows_here = np.flatnonzero(here)[fill]
            out[rows_here, 2] = edge[fill]
    # Rows are filled one height at a time: average the lift over the skin around each
    # vertex so the filled surface is smooth (a lone lifted vertex tents the cloth).
    lift = out[:, 2] - positions[:, 2]
    neighbours = cKDTree(positions).query_ball_point(positions[region], FILL_SMOOTH)
    smoothed = np.array([lift[n].mean() for n in neighbours])
    out[region, 2] = positions[region, 2] + smoothed
    return out
