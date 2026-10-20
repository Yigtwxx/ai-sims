"""Builds the anime asset manifest the web creator reads its options from."""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

Gender = Literal["female", "male", "unisex"]

PUBLIC_PREFIX = "/assets/vrm/parts"
GENDERS: tuple[Gender, ...] = ("female", "male", "unisex")


@dataclass(frozen=True)
class Sources:
    """Hand-maintained metadata about VRoid sources (pipeline/vroid_sources.json)."""

    entries: dict[str, dict[str, str]]

    @staticmethod
    def load(path: Path) -> "Sources":
        return Sources(entries=json.loads(path.read_text(encoding="utf-8"))["sources"])

    def gender(self, stem: str) -> Gender:
        gender = self.entries.get(stem, {}).get("gender", "unisex")
        if gender not in GENDERS:
            raise ValueError(f"Invalid gender {gender!r} for source {stem}")
        return gender  # type: ignore[return-value]

    def label(self, stem: str) -> str:
        return self.entries.get(stem, {}).get("label", stem.replace("_", " "))


def build_manifest(parts_dir: Path, sources: Sources) -> dict[str, object]:
    """Collect every split report into one manifest, sorted for stable diffs.

    "base" parts (face + skin body) become selectable faces; all other
    categories become wearable parts.
    """
    bases: list[dict[str, object]] = []
    parts: list[dict[str, object]] = []
    for report_path in sorted(parts_dir.glob("*.parts.json")):
        report = json.loads(report_path.read_text(encoding="utf-8"))
        stem = Path(report["source"]).stem
        for part in report["parts"]:
            entry = {
                "id": Path(part["file"]).stem,
                "category": part["category"],
                "gender": sources.gender(stem),
                "label": sources.label(stem),
                "source": stem,
                "url": f"{PUBLIC_PREFIX}/{part['file']}",
                "bytes": part["bytes"],
            }
            (bases if part["category"] == "base" else parts).append(entry)
    bases.sort(key=lambda b: str(b["id"]))
    parts.sort(key=lambda p: (str(p["category"]), str(p["id"])))
    return {"version": 1, "bases": bases, "parts": parts}


def write_manifest(parts_dir: Path, sources_path: Path, out: Path) -> dict[str, object]:
    manifest = build_manifest(parts_dir, Sources.load(sources_path))
    out.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return manifest
