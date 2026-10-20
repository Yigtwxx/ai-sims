"""Archive layout, resume markers and progress logs for the MetaHuman export.

Each exported unit (a character, a groom, an outfit) is written into a
`<name>.partial` directory first. Only after the export finished and a `done.json`
listing every file with its size and SHA-256 was written is the directory renamed
to its final name, so an interrupted overnight run never leaves a half-written
unit that looks complete.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import re
import shutil
import time
import traceback
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

DONE_FILE = "done.json"
PARTIAL_SUFFIX = ".partial"
_UNSAFE = re.compile(r"[^A-Za-z0-9_.-]+")
_HASH_CHUNK = 8 * 1024 * 1024


def default_root() -> Path:
    """Archive root: `MH_ARCHIVE` env var, else `~/MetaHumanArchive`."""
    return Path(os.environ.get("MH_ARCHIVE", str(Path.home() / "MetaHumanArchive")))


def safe_name(name: str) -> str:
    """Turn an asset name into a portable file or folder name."""
    cleaned = _UNSAFE.sub("_", name).strip("._")
    if not cleaned:
        raise ValueError(f"Name {name!r} has no usable characters")
    return cleaned


def now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass(frozen=True)
class Archive:
    """Folder layout of the export archive (see docs/metahuman-export.md)."""

    root: Path

    @property
    def raw(self) -> Path:
        return self.root / "raw"

    @property
    def slim(self) -> Path:
        return self.root / "slim"

    @property
    def logs(self) -> Path:
        return self.root / "logs"

    @property
    def skip_file(self) -> Path:
        """JSON list of unit names the user chose to leave out of the export."""
        return self.root / "skip.json"

    def unit_dir(self, kind: str, *parts: str) -> Path:
        """Final directory of one unit, e.g. `raw/characters/Ada`."""
        return self.raw.joinpath(safe_name(kind), *(safe_name(part) for part in parts))


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(_HASH_CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def file_records(directory: Path) -> list[dict[str, Any]]:
    """Every file under `directory` except the marker, sorted by relative path."""
    records = []
    for path in sorted(p for p in directory.rglob("*") if p.is_file()):
        rel = path.relative_to(directory).as_posix()
        if rel == DONE_FILE:
            continue
        records.append({"path": rel, "bytes": path.stat().st_size, "sha256": sha256_of(path)})
    return records


def drop_shared_files(baseline: Path, variant: Path) -> int:
    """Delete files in `variant` that are byte-identical to the same path in `baseline`.

    Used to keep only what a second export variant (e.g. baked makeup) changes.
    Empty folders left behind are removed; returns how many files were dropped.
    """
    dropped = 0
    for path in sorted(p for p in variant.rglob("*") if p.is_file()):
        twin = baseline / path.relative_to(variant)
        same_size = twin.is_file() and twin.stat().st_size == path.stat().st_size
        if same_size and sha256_of(twin) == sha256_of(path):
            path.unlink()
            dropped += 1
    for folder in sorted((p for p in variant.rglob("*") if p.is_dir()), reverse=True):
        if not any(folder.iterdir()):
            folder.rmdir()
    return dropped


def write_json(path: Path, payload: object) -> None:
    """Write JSON atomically so a crash never leaves a truncated file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(tmp, path)


def write_done(directory: Path, meta: dict[str, Any]) -> dict[str, Any]:
    """Record the unit's files; the marker is what makes a unit count as done."""
    files = file_records(directory)
    if not files:
        raise RuntimeError(f"Export produced no files in {directory}")
    payload = {
        "completed_at": now_iso(),
        "file_count": len(files),
        "total_bytes": sum(record["bytes"] for record in files),
        "files": files,
        "meta": meta,
    }
    write_json(directory / DONE_FILE, payload)
    return payload


def read_done(directory: Path) -> dict[str, Any] | None:
    marker = directory / DONE_FILE
    if not marker.is_file():
        return None
    return json.loads(marker.read_text(encoding="utf-8"))


def is_done(directory: Path) -> bool:
    """Cheap check used for resuming: marker present and every file has its size."""
    done = read_done(directory)
    if done is None:
        return False
    for record in done["files"]:
        path = directory / record["path"]
        if not path.is_file() or path.stat().st_size != record["bytes"]:
            return False
    return True


def verify_done(directory: Path) -> list[str]:
    """Full check against the recorded hashes; returns a list of problems."""
    done = read_done(directory)
    if done is None:
        return [f"{directory}: missing {DONE_FILE}"]
    problems = []
    for record in done["files"]:
        path = directory / record["path"]
        if not path.is_file():
            problems.append(f"{path}: missing")
        elif path.stat().st_size != record["bytes"]:
            problems.append(f"{path}: size changed")
        elif sha256_of(path) != record["sha256"]:
            problems.append(f"{path}: hash mismatch")
    return problems


class JobLog:
    """Append-only JSON-lines progress log, one line per event, flushed immediately."""

    def __init__(self, logs_dir: Path, job: str) -> None:
        logs_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        self.path = logs_dir / f"{safe_name(job)}-{stamp}.jsonl"
        self.job = job

    def event(self, status: str, unit: str | None = None, **fields: object) -> None:
        line = {"ts": now_iso(), "job": self.job, "status": status, "unit": unit, **fields}
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(line, sort_keys=True) + "\n")


@dataclass(frozen=True)
class Unit:
    """One independently resumable piece of the export.

    `export` receives an empty working directory, writes its files there and
    returns metadata that ends up in `done.json`.
    """

    name: str
    directory: Path
    export: Callable[[Path], dict[str, Any]]


@dataclass
class Summary:
    done: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    excluded: list[str] = field(default_factory=list)
    failed: dict[str, str] = field(default_factory=dict)
    deferred: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "done": self.done,
            "skipped": self.skipped,
            "excluded": self.excluded,
            "failed": self.failed,
            "deferred": self.deferred,
        }


class SkipList:
    """Unit names to leave out, re-read before every unit so it can change mid-run.

    A half-written edit (invalid JSON) keeps the last good list instead of
    stopping an overnight export.
    """

    def __init__(self, path: Path | None) -> None:
        self.path = path
        self._names: set[str] = set()

    def names(self) -> set[str]:
        if self.path is None or not self.path.is_file():
            return self._names
        with contextlib.suppress(json.JSONDecodeError, TypeError):
            self._names = set(json.loads(self.path.read_text(encoding="utf-8")))
        return self._names


def run_units(
    units: Iterable[Unit],
    log: JobLog,
    *,
    force: bool = False,
    skip: SkipList | None = None,
    limit: int | None = None,
) -> Summary:
    """Export every unit that is not already done; a failure never stops the run.

    `limit` caps how many units are exported (skipped and excluded ones don't
    count), so a long batch can run in several short-lived processes.
    """
    summary = Summary()
    skip = skip or SkipList(None)
    for unit in units:
        if limit is not None and len(summary.done) + len(summary.failed) >= limit:
            summary.deferred.append(unit.name)
            continue
        if unit.name in skip.names():
            summary.excluded.append(unit.name)
            log.event("excluded", unit.name)
            continue
        if not force and is_done(unit.directory):
            summary.skipped.append(unit.name)
            log.event("skipped", unit.name)
            continue
        partial = unit.directory.with_name(unit.directory.name + PARTIAL_SUFFIX)
        if partial.exists():
            shutil.rmtree(partial)
        partial.mkdir(parents=True)
        log.event("started", unit.name)
        started = time.monotonic()
        try:
            meta = unit.export(partial)
            done = write_done(partial, meta)
            if unit.directory.exists():
                shutil.rmtree(unit.directory)
            os.replace(partial, unit.directory)
        except Exception as exc:
            summary.failed[unit.name] = f"{type(exc).__name__}: {exc}"
            log.event(
                "failed",
                unit.name,
                error=summary.failed[unit.name],
                trace=traceback.format_exc(limit=8),
            )
            continue
        summary.done.append(unit.name)
        log.event(
            "done",
            unit.name,
            seconds=round(time.monotonic() - started, 1),
            files=done["file_count"],
            bytes=done["total_bytes"],
        )
    log.event("finished", None, **summary.as_dict())
    return summary
