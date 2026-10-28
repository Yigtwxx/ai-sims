"""MetaHuman asset manifest v2 (`web/manifest.json`), assembled from build stamps.

The contract is the zod schema in `web/src/lib/assets/manifest.ts`; `validate` mirrors its
rules so the converter fails before writing a manifest the web app would reject, and
`validate_with_zod` runs the real schema through Node when it is installed.

Ids are prefixed by kind (`face.Ada`, `skin.Ada`, `iris.Ada`, `anim.idle.stand`, ...)
because the web app's curation assumes ids are unique across categories.
"""

import json
import re
import shutil
import subprocess
from collections.abc import Iterable, Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
GENDERS = ("female", "male")
COMPAT = ("female", "male", "unisex")
BODY_PRESETS = ("slim", "average", "athletic", "curvy")
GROOM_SLOTS = ("hair", "eyebrows", "beard", "mustache", "eyelashes", "peachfuzz")
OUTFIT_CATEGORIES = ("top", "bottom", "shoes", "full")
PARAM_TYPES = ("float", "color", "bool", "int", "texture")
LISTS = ("faces", "skins", "bodies", "grooms", "outfits", "irises", "animations", "lighting")
SCHEMA = Path(__file__).resolve().parents[4] / "web" / "src" / "lib" / "assets" / "manifest.ts"
CHECKER = Path(__file__).resolve().parents[3] / "scripts" / "check_manifest.mjs"


class ManifestError(ValueError):
    """The manifest breaks the v2 contract."""


def _label_ok(label: object) -> bool:
    if isinstance(label, str):
        return bool(label)
    return (
        isinstance(label, dict)
        and isinstance(label.get("tr"), str)
        and isinstance(label.get("en"), str)
    )


def _file_ok(value: object) -> bool:
    return isinstance(value, str) and bool(value)


def validate(manifest: Mapping[str, Any], web_root: Path | None = None) -> list[str]:
    """Contract problems (empty when valid). With `web_root`, referenced files must exist."""
    problems: list[str] = []
    files: list[str] = []

    def need(condition: bool, message: str) -> None:
        if not condition:
            problems.append(message)

    def file(value: object, where: str, *, optional: bool = False) -> None:
        if value is None and optional:
            return
        need(_file_ok(value), f"{where}: expected a file path")
        if isinstance(value, str):
            files.append(value)

    need(manifest.get("version") == 2, "version must be 2")
    need(isinstance(manifest.get("generatedAt"), str), "generatedAt must be a string")
    for key in LISTS:
        need(isinstance(manifest.get(key, []), list), f"{key} must be a list")
    seen: dict[str, str] = {}
    for key in ("faces", "skins", "grooms", "outfits", "irises", "animations", "lighting"):
        for item in manifest.get(key, []):
            identifier = item.get("id")
            need(
                isinstance(identifier, str) and bool(ID.match(identifier)),
                f"{key}: bad id {identifier!r}",
            )
            if isinstance(identifier, str):
                need(
                    identifier not in seen,
                    f"id {identifier} used by {seen.get(identifier)} and {key}",
                )
                seen[identifier] = key
            need(_label_ok(item.get("label", "x")), f"{identifier}: bad label")

    skins = {s.get("id") for s in manifest.get("skins", [])}
    irises = {i.get("id") for i in manifest.get("irises", [])}
    for face in manifest.get("faces", []):
        where = f"face {face.get('id')}"
        need(face.get("gender") in GENDERS, f"{where}: gender")
        file(face.get("head"), where)
        file(face.get("thumbnail"), where, optional=True)
        need(
            face.get("defaultSkin") in skins,
            f"{where}: defaultSkin {face.get('defaultSkin')} is not a skin",
        )
        if face.get("defaultIris") is not None:
            need(face.get("defaultIris") in irises, f"{where}: defaultIris is not an iris")
    for skin in manifest.get("skins", []):
        where = f"skin {skin.get('id')}"
        tone = skin.get("tone")
        need(isinstance(tone, int | float) and 0 <= tone <= 1, f"{where}: tone outside 0..1")
        need(
            isinstance(skin.get("swatch"), str) and bool(HEX.match(skin["swatch"])),
            f"{where}: swatch",
        )
        face = skin.get("face", {})
        for role in ("albedo", "normal"):
            file(face.get(role), f"{where} face.{role}")
        file(face.get("srmf"), f"{where} face.srmf", optional=True)
        for role in ("wrinkleColor", "wrinkleNormal"):
            values = face.get(role, [])
            need(isinstance(values, list) and len(values) <= 3, f"{where}: {role} holds at most 3")
            for value in values:
                file(value, f"{where} face.{role}")
        for value in face.get("wrinkleMasks", []):
            file(value, f"{where} face.wrinkleMasks")
        body = skin.get("body", {})
        for role in ("albedo", "normal"):
            file(body.get(role), f"{where} body.{role}")
        file(body.get("srmf"), f"{where} body.srmf", optional=True)
        file(skin.get("makeupAlbedo"), f"{where} makeupAlbedo", optional=True)
    for body in manifest.get("bodies", []):
        where = f"body {body.get('gender')}"
        need(body.get("gender") in GENDERS, f"{where}: gender")
        file(body.get("glb"), where)
        sliders = body.get("sliders", [])
        need(isinstance(sliders, list) and len(sliders) >= 1, f"{where}: needs sliders")
        for slider in sliders:
            need(
                isinstance(slider.get("id"), str)
                and all(isinstance(slider.get(k), int | float) for k in ("min", "max", "default")),
                f"{where}: bad slider {slider}",
            )
        presets = body.get("presets", {})
        need(
            set(presets) <= set(BODY_PRESETS),
            f"{where}: unknown presets {set(presets) - set(BODY_PRESETS)}",
        )
    for groom in manifest.get("grooms", []):
        where = f"groom {groom.get('id')}"
        need(groom.get("slot") in GROOM_SLOTS, f"{where}: slot")
        need(groom.get("compat", "unisex") in COMPAT, f"{where}: compat")
        # Cards (`glb`), a head-UV map painted on the skin (`painted`), or both: long cards
        # over short hair painted from strands (`strand_paint`).
        need(bool(groom.get("glb")) or bool(groom.get("painted")), f"{where}: glb or painted")
        file(groom.get("glb"), where, optional=True)
        file(groom.get("painted"), where, optional=True)
        file(groom.get("thumbnail"), where, optional=True)
        for value in groom.get("textures", {}).values():
            file(value, f"{where} textures")
        for param in groom.get("params", []):
            need(
                param.get("type") in PARAM_TYPES and bool(param.get("name")),
                f"{where}: param {param}",
            )
    for outfit in manifest.get("outfits", []):
        where = f"outfit {outfit.get('id')}"
        need(outfit.get("category") in OUTFIT_CATEGORIES, f"{where}: category")
        need(outfit.get("compat", "unisex") in COMPAT, f"{where}: compat")
        files_by_gender = outfit.get("files", {})
        need(
            isinstance(files_by_gender, dict)
            and bool(files_by_gender)
            and set(files_by_gender) <= set(GENDERS),
            f"{where}: files must map female/male to GLBs",
        )
        for value in files_by_gender.values() if isinstance(files_by_gender, dict) else []:
            file(value, f"{where} files")
        file(outfit.get("thumbnail"), where, optional=True)
        for param in outfit.get("params", []):
            need(
                param.get("type") in PARAM_TYPES and bool(param.get("name")),
                f"{where}: param {param}",
            )
        for preset in outfit.get("tintPresets", []):
            need(
                isinstance(preset.get("id"), str) and bool(ID.match(preset["id"])),
                f"{where}: tint id",
            )
            need(_label_ok(preset.get("label", "x")), f"{where}: tint label")
            values = preset.get("values", {})
            need(
                isinstance(values, dict)
                and all(
                    isinstance(v, int | float) or (isinstance(v, str) and bool(HEX.match(v)))
                    for v in values.values()
                ),
                f"{where}: tint values",
            )
        need(
            all(isinstance(r, str) for r in outfit.get("hidesBodyRegions", [])),
            f"{where}: hidesBodyRegions",
        )
    for iris in manifest.get("irises", []):
        where = f"iris {iris.get('id')}"
        file(iris.get("color"), where)
        file(iris.get("normal"), where, optional=True)
        need(
            isinstance(iris.get("swatch"), str) and bool(HEX.match(iris["swatch"])),
            f"{where}: swatch",
        )
    for animation in manifest.get("animations", []):
        where = f"animation {animation.get('id')}"
        need(animation.get("kind") in ("body", "face"), f"{where}: kind")
        file(animation.get("file"), where)
        need(isinstance(animation.get("loop", True), bool), f"{where}: loop")
    for lighting in manifest.get("lighting", []):
        where = f"lighting {lighting.get('id')}"
        file(lighting.get("file"), where)
        file(lighting.get("environment"), where, optional=True)
    if web_root is not None:
        missing = sorted({f for f in files if not (web_root / f).is_file()})
        problems.extend(f"missing file {f}" for f in missing[:20])
    return problems


def validate_with_zod(path: Path, schema: Path = SCHEMA) -> str | None:
    """Run the web app's zod schema over a written manifest. Returns None when it parses,
    the issues otherwise; raises FileNotFoundError when Node or the schema is missing."""
    node = shutil.which("node")
    if node is None or not schema.is_file() or not CHECKER.is_file():
        raise FileNotFoundError("node, the web schema or scripts/check_manifest.mjs is missing")
    result = subprocess.run(
        [node, "--experimental-strip-types", "--no-warnings", str(CHECKER), str(schema), str(path)],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    if result.returncode == 0:
        return None
    return (result.stdout + result.stderr).strip()


def nearest_skin(tone: float | None, skins: Iterable[Mapping[str, Any]]) -> str | None:
    candidates = sorted(
        skins, key=lambda s: abs(float(s["tone"]) - (tone if tone is not None else 0.5))
    )
    return str(candidates[0]["id"]) if candidates else None


def assemble(
    faces: Iterable[Mapping[str, Any]],
    skins: Iterable[Mapping[str, Any]],
    irises: Iterable[Mapping[str, Any]],
    bodies: Iterable[Mapping[str, Any]],
    *,
    animations: Iterable[Mapping[str, Any]] = (),
    lighting: Iterable[Mapping[str, Any]] = (),
    grooms: Iterable[Mapping[str, Any]] = (),
    outfits: Iterable[Mapping[str, Any]] = (),
    face_tones: Mapping[str, float | None] | None = None,
    face_maps_from: Mapping[str, str | None] | None = None,
) -> dict[str, Any]:
    """The manifest from per-asset entries (build infos). Faces get their own preset's skin
    and iris when converted, else the skin closest in tone (`face_tones`). A face without
    an iris of its own wears the iris of the preset its skin came from, else of the preset
    its teeth and eyelash maps came from (`face_maps_from`). Faces without a known gender
    are left out (the contract needs one)."""
    skin_list = sorted(
        ({k: v for k, v in s.items() if k != "stats"} for s in skins),
        key=lambda s: (s["tone"], s["id"]),
    )
    iris_list = sorted((dict(i) for i in irises), key=lambda i: i["id"])
    skin_ids = {s["id"] for s in skin_list}
    iris_ids = {i["id"] for i in iris_list}
    face_list = []
    for face in sorted(faces, key=lambda f: f["id"]):
        if face.get("gender") not in GENDERS:
            continue
        preset = str(face["id"]).removeprefix("face.")
        entry = dict(face)
        own_skin = f"skin.{preset}"
        if own_skin in skin_ids:
            entry["defaultSkin"] = own_skin
        else:
            fallback = nearest_skin((face_tones or {}).get(preset), skin_list)
            if fallback is None:
                continue
            entry["defaultSkin"] = fallback
        borrowed = [
            str(entry["defaultSkin"]).removeprefix("skin."),
            (face_maps_from or {}).get(preset),
        ]
        for source in (preset, *borrowed):
            if source and f"iris.{source}" in iris_ids:
                entry["defaultIris"] = f"iris.{source}"
                break
        face_list.append(entry)
    return {
        "version": 2,
        "generatedAt": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "faces": face_list,
        "skins": skin_list,
        "bodies": sorted((dict(b) for b in bodies), key=lambda b: b["gender"]),
        "grooms": sorted((dict(g) for g in grooms), key=lambda g: (g["slot"], g["id"])),
        "outfits": sorted(
            (dict(o) for o in outfits),
            key=lambda o: (OUTFIT_CATEGORIES.index(o["category"]), o["id"]),
        ),
        "irises": iris_list,
        "animations": sorted((dict(a) for a in animations), key=lambda a: a["id"]),
        "lighting": sorted(
            (dict(entry) for entry in lighting), key=lambda entry: entry.get("order", 99)
        ),
    }


def write_manifest(manifest: Mapping[str, Any], path: Path, web_root: Path) -> None:
    clean = dict(manifest)
    clean["lighting"] = [
        {k: v for k, v in entry.items() if k != "order"} for entry in manifest.get("lighting", [])
    ]
    problems = validate(clean, web_root)
    if problems:
        raise ManifestError("; ".join(problems[:10]))
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(clean, indent=2) + "\n", encoding="utf-8", newline="\n")
    temporary.replace(path)
