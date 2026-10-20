"""MetaHuman Creator lighting levels (`raw/lighting/<Level>/lighting.json`) -> light rigs.

Output (`web/lighting/<id>.json`), in the asset space (metres, +Y up, the character stands
at the origin facing +Z, as in the levels where it faces Unreal's +Y):

    {"id", "label", "level",
     "units": {...},
     "exposure": {"scale", "method", "bias", "toneCurveAmount", ...},
     "lights": [{"name", "type": "point"|"spot"|"rect"|"directional",
                 "position", "direction", "color", "colorHex", "intensity",
                 "range", "innerConeAngle", "outerConeAngle", "width", "height",
                 "luminance", "castShadow", "sourceRadius", "softSourceRadius",
                 "specularScale", "diffuseScale"}],
     "sky": {"intensity", "cubemap"}}

Units: point/spot/rect `intensity` in candela (rect lights also give `luminance` in nits,
the three.js RectAreaLight unit), directional in lux; `color` is linear RGB including the
colour temperature when the light uses one; angles are half-angles in radians (like
KHR_lights_punctual); `direction` is where the light shines. Unreal's display value is
`scene luminance (cd/m2) * exposure.scale` (manual exposure, EV100 0: 1 / 1.2 * 2^bias);
with these rigs the tone curve is off (`toneCurveAmount` 0).
"""

import json
import math
import re
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

UNITLESS_TO_CANDELA = 16.0 / 10000.0  # Unreal ULocalLightComponent::GetUnitsConversionFactor
LIGHT_TYPES = {
    "PointLightComponent": "point",
    "SpotLightComponent": "spot",
    "RectLightComponent": "rect",
    "DirectionalLightComponent": "directional",
}
# Rigs listed first in the manifest; the rest follow by name.
ORDER = ("Studio", "Portrait")


def unreal_point(values: Sequence[float]) -> list[float]:
    """Unreal world (cm, X fwd, Y right, Z up) -> asset space (m): (x, z, y) / 100."""
    x, y, z = (float(v) for v in values)
    return [round(x / 100, 5), round(z / 100, 5), round(y / 100, 5)]


def unreal_direction(pitch_yaw_roll: Sequence[float]) -> list[float]:
    """Forward (+X) of an Unreal rotator (degrees), in asset space."""
    pitch, yaw, _ = (math.radians(float(v)) for v in pitch_yaw_roll)
    forward = (math.cos(pitch) * math.cos(yaw), math.cos(pitch) * math.sin(yaw), math.sin(pitch))
    return [round(forward[0], 6), round(forward[2], 6), round(forward[1], 6)]


def parse_fcolor(text: str) -> list[float]:
    """`(B=255,G=255,R=255,A=255)` (sRGB bytes) -> linear RGB."""
    channels = dict(re.findall(r"([RGBA])=(\d+)", text))
    values = []
    for key in "RGB":
        c = int(channels.get(key, 255)) / 255.0
        values.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return values


def color_temperature(kelvin: float) -> list[float]:
    """Unreal's FLinearColor::MakeFromColorTemperature (Planckian locus, BT.709)."""
    t = min(max(kelvin, 1000.0), 15000.0)
    u = (0.860117757 + 1.54118254e-4 * t + 1.28641212e-7 * t * t) / (
        1.0 + 8.42420235e-4 * t + 7.08145163e-7 * t * t
    )
    v = (0.317398726 + 4.22806245e-5 * t + 4.20481691e-8 * t * t) / (
        1.0 - 2.89741816e-5 * t + 1.61456053e-7 * t * t
    )
    x = 3.0 * u / (2.0 * u - 8.0 * v + 4.0)
    y = 2.0 * v / (2.0 * u - 8.0 * v + 4.0)
    z = 1.0 - x - y
    big_x, big_y, big_z = x / y, 1.0, z / y
    return [
        3.2404542 * big_x - 1.5371385 * big_y - 0.4985314 * big_z,
        -0.9692660 * big_x + 1.8760108 * big_y + 0.0415560 * big_z,
        0.0556434 * big_x - 0.2040259 * big_y + 1.0572252 * big_z,
    ]


def _number(component: Mapping[str, Any], key: str, default: float) -> float:
    """A numeric property; the export stores {"error": ...} for properties a class lacks."""
    value = component.get(key, default)
    return (
        float(value) if isinstance(value, int | float) and not isinstance(value, bool) else default
    )


def to_candela(intensity: float, units: str, kind: str, outer_cone_deg: float) -> float:
    if "CANDELAS" in units:
        return intensity
    if "LUMENS" in units:
        if kind == "spot":
            solid = 2.0 * math.pi * (1.0 - math.cos(math.radians(outer_cone_deg)))
            return intensity / solid
        return intensity / (4.0 * math.pi)
    if "EV" in units:
        return 2.0 ** (intensity - 3.0)
    return intensity * UNITLESS_TO_CANDELA


def _hex(linear: list[float]) -> str:
    peak = max(max(linear), 1e-9)
    normalized = [min(max(c / peak, 0.0), 1.0) for c in linear]
    encoded = [12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055 for c in normalized]
    return "#" + "".join(f"{round(c * 255):02x}" for c in encoded)


def _settings_value(settings: str, key: str) -> str | None:
    if f"bOverride_{key}=True" not in settings:
        return None
    match = re.search(rf"(?<![A-Za-z_]){key}=([^,()]+)", settings)
    return match.group(1) if match else None


def exposure(actors: list[dict[str, Any]]) -> dict[str, Any]:
    for actor in actors:
        if actor.get("class") == "PostProcessVolume" and isinstance(actor.get("settings"), str):
            settings = actor["settings"]
            method = _settings_value(settings, "AutoExposureMethod") or "AEM_Histogram"
            bias = float(_settings_value(settings, "AutoExposureBias") or 0.0)
            physical = (
                _settings_value(settings, "AutoExposureApplyPhysicalCameraExposure") or "True"
            ) == "True"
            tone = _settings_value(settings, "ToneCurveAmount")
            return {
                "method": "manual" if method == "AEM_Manual" else "auto",
                "bias": bias,
                "applyPhysicalCamera": physical,
                "scale": round(2.0**bias / 1.2, 6)
                if method == "AEM_Manual" and not physical
                else None,
                "toneCurveAmount": float(tone) if tone is not None else 1.0,
                "note": "display = luminance (cd/m2) * scale; Unreal manual exposure at EV100 0",
            }
    return {"method": "auto", "scale": None, "note": "no post-process volume in the level"}


def convert_level(level_dir: Path) -> dict[str, Any]:
    """Light rig of one level."""
    data = json.loads((level_dir / "lighting.json").read_text(encoding="utf-8"))
    actors = data.get("actors", [])
    lights: list[dict[str, Any]] = []
    sky: dict[str, Any] | None = None
    for actor in actors:
        transform = actor.get("transform", {})
        for component in actor.get("components", []):
            cls = component.get("class", "")
            if cls == "SkyLightComponent":
                sky = {
                    "intensity": _number(component, "intensity", 1.0),
                    "cubemap": component.get("cubemap"),
                    "note": "cubemap not exported; use an HDRI environment",
                }
                continue
            kind = LIGHT_TYPES.get(cls)
            if kind is None or component.get("visible") is False:
                continue
            if component.get("affects_world") is False:
                continue
            color = parse_fcolor(str(component.get("light_color", "")))
            if component.get("use_temperature") is True:
                tint = color_temperature(_number(component, "temperature", 6500.0))
                color = [c * t for c, t in zip(color, tint, strict=True)]
            outer = _number(component, "outer_cone_angle", 44.0)
            inner = _number(component, "inner_cone_angle", 0.0)
            units = str(component.get("intensity_units", ""))
            intensity = _number(component, "intensity", 0.0)
            light: dict[str, Any] = {
                "name": actor.get("name", ""),
                "type": kind,
                "position": unreal_point(transform.get("location", [0, 0, 0])),
                "direction": unreal_direction(transform.get("rotation_pyr", [0, 0, 0])),
                "color": [round(c, 6) for c in color],
                "colorHex": _hex(color),
                "castShadow": bool(component.get("cast_shadows", False)),
                "specularScale": _number(component, "specular_scale", 1.0),
                "diffuseScale": _number(component, "diffuse_scale", 1.0),
                "sourceRadius": round(_number(component, "source_radius", 0.0) / 100, 4),
                "softSourceRadius": round(_number(component, "soft_source_radius", 0.0) / 100, 4),
            }
            if kind == "directional":
                light["intensity"] = intensity  # lux
            else:
                light["intensity"] = round(to_candela(intensity, units, kind, outer), 6)
                radius = _number(component, "attenuation_radius", 0.0)
                if radius > 0:
                    light["range"] = round(radius / 100, 3)
            if kind == "spot":
                light["innerConeAngle"] = round(math.radians(min(inner, outer)), 6)
                light["outerConeAngle"] = round(math.radians(outer), 6)
            if kind == "rect":
                width = _number(component, "source_width", 0.0) / 100
                height = _number(component, "source_height", 0.0) / 100
                light["width"], light["height"] = round(width, 4), round(height, 4)
                if width > 0 and height > 0:
                    light["luminance"] = round(light["intensity"] / (width * height), 6)
            lights.append(light)
    name = level_dir.name
    rig: dict[str, Any] = {
        "id": f"light.{_slug(name)}",
        "label": name,
        "level": data.get("level", ""),
        "units": {
            "position": "m, +Y up, character at the origin facing +Z",
            "intensity": "cd (point, spot, rect), lux (directional)",
            "luminance": "nits (rect lights)",
            "color": "linear RGB",
            "angles": "radians, half-angles",
        },
        "exposure": exposure(actors),
        "lights": lights,
    }
    if sky:
        rig["sky"] = sky
    return rig


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", re.sub(r"(?<=[a-z])(?=[A-Z])", "_", name).lower()).strip("_")


def list_levels(archive: Path) -> list[Path]:
    root = archive / "raw" / "lighting"
    if not root.is_dir():
        return []
    return sorted(
        p for p in root.iterdir() if (p / "lighting.json").is_file() and (p / "done.json").is_file()
    )


def manifest_entry(rig: dict[str, Any], file: str) -> dict[str, Any]:
    order = ORDER.index(rig["label"]) if rig["label"] in ORDER else len(ORDER)
    return {"id": rig["id"], "label": rig["label"], "file": file, "order": order}


def has_lights(rig: dict[str, Any]) -> bool:
    """False for levels without a meaningful light (e.g. the base environment)."""
    return any(light["type"] != "point" or light["intensity"] > 0.01 for light in rig["lights"])
