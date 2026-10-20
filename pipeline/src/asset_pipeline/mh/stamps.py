"""Incremental builds: skip an output whose inputs and converter settings did not change.

A stamp (`<archive>/build/stamps/<key>.json`) records the fingerprint an output was built
from and the files it wrote. Fingerprints combine the source units' `done.json` (the export
writes one per finished unit, with a sha256 per file, so hashing it covers every source
file without re-reading gigabytes of maps) with version strings of the converter steps.
Stamps live outside `web/` so nothing internal is served.
"""

import hashlib
import json
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DONE_FILE = "done.json"


def fingerprint(*parts: object) -> str:
    """sha256 over the parts: Paths contribute their bytes, everything else its JSON form."""
    digest = hashlib.sha256()
    for part in parts:
        if isinstance(part, Path):
            digest.update(part.as_posix().encode())
            digest.update(part.read_bytes() if part.is_file() else b"<missing>")
        else:
            digest.update(json.dumps(part, sort_keys=True, default=str).encode())
        digest.update(b"\0")
    return digest.hexdigest()


def done_file(unit: Path) -> Path:
    return unit / DONE_FILE


@dataclass(frozen=True)
class Stamps:
    archive: Path

    @property
    def root(self) -> Path:
        return self.archive / "build" / "stamps"

    def _path(self, key: str) -> Path:
        return self.root / f"{key}.json"

    def read(self, key: str) -> dict[str, Any] | None:
        path = self._path(key)
        if not path.is_file():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        return data if isinstance(data, dict) else None

    def is_current(self, key: str, print_: str) -> bool:
        """True when `key` was built from `print_` and every output it wrote still exists."""
        stamp = self.read(key)
        if not stamp or stamp.get("fingerprint") != print_:
            return False
        return all((self.archive / output).is_file() for output in stamp.get("outputs", []))

    def record(
        self, key: str, print_: str, outputs: Iterable[Path], info: dict[str, Any] | None = None
    ) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        stamp = {
            "fingerprint": print_,
            "outputs": sorted(p.relative_to(self.archive).as_posix() for p in outputs),
            "info": info or {},
        }
        temporary = path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(stamp, indent=2) + "\n", encoding="utf-8", newline="\n")
        temporary.replace(path)

    def info(self, key: str) -> dict[str, Any]:
        stamp = self.read(key) or {}
        info = stamp.get("info", {})
        return info if isinstance(info, dict) else {}
