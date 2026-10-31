"""Tailored trousers: the shorts' four-piece pattern run down to the ankle, narrowing to
the knee and hanging straight about the grain line (`LegPattern` with a knee point).

Details are drawn in the garment maps on the pattern UVs: the waistband join and belt
loops, slanted front pockets, a fly, welted back pockets and a pressed crease down the
middle of every leg piece. The hem is turned up and blind stitched (a stiff band, no
visible stitching).
"""

from pathlib import Path

import numpy as np

from asset_pipeline.garments.flat import F64, bezier, polyline
from asset_pipeline.garments.pack import GarmentLines, Look
from asset_pipeline.garments.shorts import PIECES, LegPattern, ShortsDraft, ShortsSpec, _inset

NAME = "AS_TailoredTrousers"
TWILL_TILE = 0.003  # metres of suiting twill one detail tile spans
HEATHER_TILE = 0.25  # metres of the wool's melange one macro tile spans
LOOP_WIDTH = 0.01  # belt loop
LOOP_BELOW = 0.008  # how far a loop reaches below the waistband
LOOPS_FRONT = (0.6,)  # belt loops along each piece's top, as shares of its width
LOOPS_BACK = (0.5, 0.06)
WELT_LIP = 0.005  # each of a welt pocket's two lips
WELT_BELOW = 0.07  # welt below the waistband
WELT_WIDTH = 0.13  # at most
POCKET_DEPTH = 0.16  # slanted pocket opening: from the waistband down the side seam
POCKET_IN = 0.045  # and in from the side seam at the top
CREASE_BACK_BELOW = 0.06  # the back crease stops this far under the crotch

TROUSERS_FEMALE = ShortsSpec(
    NAME,
    top_below_waist=0.035,
    above_ankle=0.008,
    top_ease=0.03,
    hip_ease=0.06,
    leg_ease=0.08,
    knee_ease=0.09,
    hem_girth=0.38,
    front_share=0.46,
    front_extension=0.035,
    back_extension=0.09,
    front_crotch_depth=0.06,
    back_crotch_depth=0.10,
    back_raise=0.025,
    crotch_drop=0.02,
    crotch_stiff=0.07,  # the front lies flat over the groin
    back_crotch_stiff=0.035,  # the seat seam follows the seat (stiffer, it pinches)
    side_stiff=0.015,
    thigh_shift_crotch=0.04,  # started out to the crotch, the seat pinches
    waistband=0.035,
    hem_band=0.04,
    spacing=0.012,
    gap=0.006,
)
TROUSERS_MALE = ShortsSpec(
    NAME,
    top_below_waist=0.045,
    above_ankle=0.0,
    top_ease=0.03,
    hip_ease=0.07,
    leg_ease=0.10,
    knee_ease=0.11,
    hem_girth=0.44,
    front_share=0.46,
    front_extension=0.045,
    back_extension=0.10,
    front_crotch_depth=0.07,
    back_crotch_depth=0.11,
    back_raise=0.03,
    crotch_drop=0.02,
    crotch_stiff=0.09,  # the fly front lies flat over the groin
    back_crotch_stiff=0.07,
    side_stiff=0.015,
    waistband=0.04,
    hem_band=0.04,
    spacing=0.012,
    gap=0.006,
)


def wool_look(archive: Path, gender: str, uv_metres: float) -> Look:
    """Worsted suiting: a fine twill face (Epic's denim twill, far finer and softer) and a
    faint melange."""
    flats = archive / "raw" / "outfits" / gender / "WI_OA_Flats" / "textures"
    tee = archive / "raw" / "outfits" / gender / "WI_OA_Crewneckt" / "textures"
    return Look(
        textures={
            "detailTex_normal": flats / "micro_weave_denim_N.png",
            "DetailTex_Variation": flats / "micro_weave_denim_diffuse.png",
            "MacroTex_Variation": tee / "macro_heather_04.png",
        },
        scalars={
            "DetailTex_UVTtiling": uv_metres / TWILL_TILE,
            "DetailTex_NormalStrength": 0.15,
            "DetailTex_VariationStrength": 0.03,
            "MacroTex_UvTiling": uv_metres / HEATHER_TILE,
            "MacroTexStrength": 0.12,
            "VariationExpLow": 1.0,
            "VariationExpHigh": 1.0,
        },
    )


WOOL_SWITCHES = {
    "DoPill": False,
    "DoFuzz": False,
    "DoWrinkles": False,
    "DoDetailVariation": True,
    "DoMacroVariation": True,
    "DoDetailNormal": True,
}


def _top_v(pattern: LegPattern, u: float) -> float:
    """Height of the piece's top edge at `u` (it rises toward the centre line)."""
    return pattern.top_v + pattern.raise_ * (1.0 - u / pattern.top_width)


def _side_u(pattern: LegPattern, v: float) -> float:
    side = {s.name: s.points for s in pattern.segments()}["side"]
    return float(np.interp(v, side[:, 1], side[:, 0]))


def _rectangle(u0: float, v0: float, u1: float, v1: float) -> F64:
    """Counter-clockwise outline (in a piece as drafted)."""
    return polyline((u0, v0), (u1, v0), (u1, v1), (u0, v1))


def trouser_details(
    pattern: LegPattern, spec: ShortsSpec, front: bool, fly: bool
) -> dict[str, list[F64]]:
    """Pattern-space detail lines of one piece, by kind: `seams`, `edges`, `stitches`,
    `creases` and `raised` outlines."""
    band = spec.waistband
    out: dict[str, list[F64]] = {k: [] for k in ("seams", "edges", "stitches", "creases")}
    out["raised"] = []
    grain = pattern.grain_u()
    crease_top = pattern.top_v - band - 0.01 if front else pattern.crotch_v - CREASE_BACK_BELOW
    out["creases"].append(polyline((grain, 0.004), (grain, crease_top)))
    for share in LOOPS_FRONT if front else LOOPS_BACK:
        u = share * pattern.top_width
        top = _top_v(pattern, u) - 0.002
        out["raised"].append(
            _rectangle(u - LOOP_WIDTH / 2, top - band - LOOP_BELOW, u + LOOP_WIDTH / 2, top)
        )
        for v in (top - 0.004, top - band - LOOP_BELOW + 0.004):
            out["stitches"].append(polyline((u - LOOP_WIDTH / 2, v), (u + LOOP_WIDTH / 2, v)))
    if front:
        top = _top_v(pattern, pattern.top_width) - band
        low = top - POCKET_DEPTH
        start = np.array([pattern.top_width - POCKET_IN, top])
        end = np.array([_side_u(pattern, low), low])
        opening = bezier(start, start + 0.3 * (end - start), end - np.array([0.004, -0.02]), end)
        out["edges"].append(opening)
        out["stitches"].append(_inset(opening, -0.006))
        out["stitches"].append(
            polyline((end[0] - 0.012, low + 0.004), (end[0] - 0.002, low + 0.004))
        )
        if fly:
            low_fly = max(pattern.crotch_v + pattern.crotch_depth, top - 0.17)
            out["stitches"].append(
                np.concatenate(
                    [
                        polyline((0.032, top), (0.032, low_fly + 0.03))[:-1],
                        bezier(
                            np.array([0.032, low_fly + 0.03]),
                            np.array([0.032, low_fly + 0.005]),
                            np.array([0.018, low_fly]),
                            np.array([0.0, low_fly - 0.004]),
                        ),
                    ]
                )
            )
        return out
    width = min(WELT_WIDTH, 0.55 * pattern.top_width)
    middle = 0.5 * pattern.top_width + 0.01
    v = _top_v(pattern, middle) - band - WELT_BELOW
    left, right = middle - width / 2, middle + width / 2
    out["raised"].append(_rectangle(left, v, right, v + WELT_LIP))
    out["raised"].append(_rectangle(left, v - WELT_LIP, right, v))
    out["seams"].append(polyline((left, v), (right, v)))
    for u in (left, right):
        out["stitches"].append(polyline((u, v - WELT_LIP - 0.002), (u, v + WELT_LIP + 0.002)))
    return out


def trousers_lines(draft: ShortsDraft, spec: ShortsSpec) -> GarmentLines:
    """Seams and finished edges of the pieces, the waistband join, and every piece's
    details (`trouser_details`) in UV space."""
    mesh = draft.mesh
    uv = mesh.uvs
    mm = 0.001 / mesh.uv_metres
    seams, edges, stitches, creases, raised = [], [], [], [], []
    for key, vertices in mesh.segments.items():
        (seams if mesh.sewn(*key) else edges).append(uv[vertices])
    for name in PIECES:
        seams.append(_inset(uv[mesh.segments[(name, "top")]], spec.waistband * 1000 * mm))
    for name, front in (("front_l", True), ("front_r", True), ("back_l", False), ("back_r", False)):
        pattern = draft.front if front else draft.back
        details = trouser_details(pattern, spec, front, name == "front_l")
        seams += [draft.to_uv(name, line) for line in details["seams"]]
        edges += [draft.to_uv(name, line) for line in details["edges"]]
        stitches += [draft.to_uv(name, line) for line in details["stitches"]]
        creases += [draft.to_uv(name, line) for line in details["creases"]]
        raised += [draft.to_uv(name, line) for line in details["raised"]]
    return GarmentLines(
        seams=seams,
        edges=edges,
        stitches=stitches,
        creases=creases,
        raised=raised,
        # Tone-on-tone thread: stitches dent and shade the cloth but take no colour of
        # their own (colour 2 stays out of the presets).
        stitch_strength=0.0,
        seam_shadow=0.3,
    )
