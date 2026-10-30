"""The outfit-base body closed at the neck, for garments that reach it.

Unreal's outfit-base body has no neck: the MetaHuman head mesh carries the neck and the
top of the chest and shoulders down to the neck seam. Tops are sewn and draped against
the body and a head: a preset head is put on the web body as the runtime puts it
(`fit_audit.place_head`, seam snapped) and carried to the outfit-base body by the
displacement of the body skin nearest to it, so its seam meets the base body's neck edge.
"""

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray
from scipy.spatial import cKDTree

from asset_pipeline.garments import GarmentError
from asset_pipeline.garments.body import BaseBody
from asset_pipeline.mh import fit_audit
from asset_pipeline.mh.outfits import BodyFit, base_body_path

F64 = NDArray[np.float64]
I64 = NDArray[np.int64]

NECK_FACES = {"female": "face.Ada", "male": "face.Victor"}
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
