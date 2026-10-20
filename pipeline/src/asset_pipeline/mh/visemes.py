# Turkish letters (ı, ö, ü, ş, ç) in the docs and comments are intentional.
# ruff: noqa: RUF002, RUF003
"""Viseme recipes in raw MetaHuman control space.

Each Oculus viseme is a set of `CTRL_expressions.*` raw control values evaluated through
RigLogic over the rest pose, so PSD correctives fire as they do in Unreal. Values are 0..1.
The web lip-sync maps Turkish letters onto these (`web/src/features/lipsync/turkish.ts`):
a->aa, e->E, ı/i->I, o/ö->O, u/ü->U, m/b/p->PP, f/v->FF, t/d->DD, n/l->nn, r->RR, s/z->SS,
ş/ç/c/j->CH, k/g/h->kk.

Tuned with the mouth metrics of `qa.py` (gap = upper/lower lip contact distance, width =
corner distance vs rest, protrusion = forward lip motion, all in cm) on Ada and checked on
Aera and Aoi; the values noted per viseme are Ada's. `test_mh_bake.py` keeps them within
limits. Facts used:

- `mouthLipsTogether*` closes the lips relative to the jaw: it does nothing with the jaw
  shut but seals them while the jaw is open (that is how ARKit mouthClose works too).
- `mouthLowerLipBite` / `RollIn` / `TowardsTeeth` bring the lower lip under the upper
  incisors; any jaw opening pulls it away again.
- `mouthLipsTowards` protrudes without opening; `mouthFunnel` protrudes and opens;
  `mouthLipsPurse` narrows the mouth.
- `tongueTipUp` reaches the alveolar ridge (~1 cm above the incisal edge); `tongueOut` 0.3
  puts the tip ~4 mm past the incisors; `tongueUp` lifts the whole tongue.
"""

RECIPES_VERSION = 3
CONTROL = "CTRL_expressions."


def _both(control: str, value: float) -> dict[str, float]:
    """Left and right variants (`<control>L`, `<control>R`)."""
    return {f"{CONTROL}{control}L": value, f"{CONTROL}{control}R": value}


def _quad(control: str, value: float) -> dict[str, float]:
    """The four lip quadrants (`UL`, `UR`, `DL`, `DR`)."""
    return {f"{CONTROL}{control}{side}": value for side in ("UL", "UR", "DL", "DR")}


def _one(control: str, value: float) -> dict[str, float]:
    return {f"{CONTROL}{control}": value}


VISEME_RECIPES: dict[str, dict[str, float]] = {
    # Silence: the neutral face (all-zero target, kept so the runtime finds every name).
    "sil": {},
    # m, b, p: lips sealed (contact gaps equal the rest closure) with the teeth just apart,
    # and a light press that rolls the lips slightly forward.
    "PP": {
        **_one("jawOpen", 0.05),
        **_quad("mouthLipsTogether", 1.0),
        **_both("mouthLipsPress", 0.4),
    },
    # f, v: lower lip on the upper incisal edge (Ada 0.2 mm, Aera 0.3 mm, Aoi 0.5 mm), upper
    # lip lifted so the teeth show.
    "FF": {
        **_one("jawOpen", 0.04),
        **_both("mouthLowerLipBite", 0.5),
        **_both("mouthLowerLipRollIn", 0.35),
        **_both("mouthUpperLipRaise", 0.3),
    },
    # th (loanwords): tongue tip ~4 mm past the incisors at their height.
    "TH": {
        **_one("jawOpen", 0.12),
        **_one("tongueOut", 0.28),
        **_both("mouthUpperLipRaise", 0.15),
    },
    # t, d: tongue tip on the alveolar ridge (+1.0 cm), lips parted ~0.5 cm.
    "DD": {
        **_one("jawOpen", 0.12),
        **_one("tongueTipUp", 0.9),
        **_one("tongueUp", 0.15),
        **_both("mouthStretch", 0.15),
    },
    # k, g, h: jaw a little open, tongue tip down behind the lower teeth, back raised.
    "kk": {
        **_one("jawOpen", 0.2),
        **_one("tongueUp", 0.4),
        **_one("tongueTipDown", 0.6),
        **_one("tongueIn", 0.3),
        **_both("mouthStretch", 0.15),
    },
    # ş, ç, c, j: lips protruded (+4.4 mm) with a small opening, corners in (91 %).
    "CH": {
        **_one("jawOpen", 0.06),
        **_quad("mouthLipsTowards", 0.5),
        **_quad("mouthFunnel", 0.25),
        **_quad("mouthLipsPurse", 0.2),
        **_both("mouthUpperLipRaise", 0.1),
    },
    # s, z: teeth almost together, lips spread (113 %) and parted to show them.
    "SS": {
        **_one("jawOpen", 0.04),
        **_both("mouthStretch", 0.3),
        **_both("mouthCornerPull", 0.1),
        **_both("mouthUpperLipRaise", 0.15),
        **_both("mouthLowerLipDepress", 0.15),
    },
    # n, l: tongue tip up near the ridge (+0.85 cm), relaxed lips parted ~0.5 cm.
    "nn": {
        **_one("jawOpen", 0.12),
        **_one("tongueTipUp", 0.85),
        **_one("tongueUp", 0.1),
        **_both("mouthStretch", 0.1),
    },
    # r (Turkish tap): tongue tip raised, lips slightly forward and rounded.
    "RR": {
        **_one("jawOpen", 0.15),
        **_quad("mouthFunnel", 0.2),
        **_quad("mouthLipsTowards", 0.25),
        **_one("tongueTipUp", 0.6),
    },
    # a: open jaw (~2.0 cm lip opening).
    "aa": {
        **_one("jawOpen", 0.6),
        **_both("mouthLowerLipDepress", 0.2),
        **_both("mouthStretch", 0.1),
    },
    # e: half-open jaw (~1.2 cm), mouth widened (113 %).
    "E": {
        **_one("jawOpen", 0.3),
        **_both("mouthStretch", 0.35),
        **_both("mouthCornerPull", 0.15),
        **_both("mouthUpperLipRaise", 0.1),
    },
    # i, ı, y: small opening (~0.8 cm), widest mouth (120 %).
    "I": {
        **_one("jawOpen", 0.12),
        **_both("mouthStretch", 0.45),
        **_both("mouthCornerPull", 0.25),
        **_both("mouthUpperLipRaise", 0.15),
        **_both("mouthLowerLipDepress", 0.1),
    },
    # o, ö: open rounded lips (width 76 % (Aera 67 %, Aoi 82 %), ~1.2 cm opening, +3.4 mm
    # forward), clearly more open than U.
    "O": {
        **_one("jawOpen", 0.28),
        **_quad("mouthFunnel", 0.65),
        **_quad("mouthLipsPurse", 0.45),
        **_quad("mouthLipsTowards", 0.4),
        **_both("mouthCornerNarrow", 0.45),
    },
    # u, ü: tight protruded rounding (width 68 %, ~0.45 cm opening, +5.4 mm forward).
    "U": {
        **_one("jawOpen", 0.12),
        **_quad("mouthLipsPurse", 0.8),
        **_quad("mouthFunnel", 0.5),
        **_quad("mouthLipsTowards", 0.5),
        **_both("mouthCornerNarrow", 0.4),
    },
}

VISEME_NAMES: tuple[str, ...] = tuple(VISEME_RECIPES)
