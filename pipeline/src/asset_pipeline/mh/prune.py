"""Remove curated-out assets from this machine: `asset-pipeline mh-prune`.

The curation screen (web app, dev only) writes the ids it hides to `web/curation.json`.
Pruning deletes everything only those assets use:

- their web outputs: the files their build stamps list and the manifest names, and the
  asset's own folder (thumbnail and bench leftovers included) once no kept asset has a
  file in it,
- the Unreal export units they were converted from,
- the Fab packages (and their import records) that nothing kept came from, where an
  export unit on disk that is not converted yet counts as kept unless its item is pruned,
- their build stamps.

The ids are added to `raw/pruned.json` before anything is deleted; the converter skips
them from then on (raw/ travels to the Mac, so the list does too), and the manifest is
rebuilt without them even when a deletion fails. A path that cannot be deleted (a file
another program holds open on Windows) is reported, the build stamps then stay so a
rerun still lists what is left, and the command exits non-zero.

Shared sources stay while anything kept uses them: a preset's export serves its face,
its skin and its iris, so it goes only when both the face and the skin are pruned (the
iris then goes with them unless a kept face wears it). The reference head grooms and
face clips are fitted on, and presets whose maps kept faces borrow, always stay.

Fab packages neither a catalogue asset nor an export unit on disk came from (e.g. a
skipped character) are listed too, and deleted only with `--unused-packages`. That list
needs every groom and outfit's export unit on disk (the package is read from it): while
any is missing (an export in progress moves it aside), no package counts as unused.

The default is a dry run that prints the plan, the space it frees and a plan digest;
`--apply --plan <digest>` deletes, and only if the plan is still exactly the one shown.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
from collections.abc import Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path

from asset_pipeline.mh.anim import Clip, describe, list_clip_units
from asset_pipeline.mh.build import FACE_REFERENCE, PRUNED_FILE, Builder, read_pruned
from asset_pipeline.mh.convert import archive_root
from asset_pipeline.mh.grooms import SLOTS, list_groom_units
from asset_pipeline.mh.manifest import LISTS, ManifestError
from asset_pipeline.mh.outfits import list_outfit_units
from asset_pipeline.mh.stamps import Stamps

COMMAND = "mh-prune"
CURATION_FILE = "curation.json"
FAB_PACKAGE = re.compile(r"/Game/Fab/([^/\"]+)/")
ASSET_FILE = re.compile(r"\.(glb|ktx2|json|webp|png|jpg|bin)$")
PRESET_KINDS = ("face", "skin", "iris")


class PruneError(RuntimeError):
    """The plan would touch something it must not."""


@dataclass
class Asset:
    """One catalogue entry and everything on disk it was built from or wrote."""

    id: str
    stamps: set[str] = field(default_factory=set)  # build stamp keys
    sources: set[str] = field(default_factory=set)  # archive-relative export units
    packages: set[str] = field(default_factory=set)  # Fab package names
    files: set[str] = field(default_factory=set)  # archive-relative files
    home: str | None = None  # archive-relative folder only this asset writes to
    unresolved: bool = False  # its export unit is missing, so its Fab package is unknown


@dataclass(frozen=True)
class Plan:
    archive: Path
    ids: tuple[str, ...]
    files: tuple[str, ...]
    folders: tuple[str, ...]
    sources: tuple[str, ...]
    packages: tuple[str, ...]
    stamps: tuple[str, ...]
    kept: tuple[tuple[str, str], ...]  # (path, why it stays)
    unknown: tuple[str, ...]  # hidden ids with nothing on disk
    unused: tuple[str, ...] = ()  # Fab packages nothing in the catalogue came from
    unresolved: tuple[str, ...] = ()  # assets whose Fab package cannot be read now

    @property
    def paths(self) -> tuple[str, ...]:
        """Every file and folder the plan deletes (stamps aside), archive-relative."""
        return (*self.files, *self.folders, *self.sources, *self.packages)

    @property
    def digest(self) -> str:
        """Short fingerprint of what the plan deletes, shown by the dry run and required
        by `--apply`, so a plan that changed since it was reviewed is never applied."""
        text = json.dumps([self.ids, self.paths, self.stamps], separators=(",", ":"))
        return hashlib.sha256(text.encode("utf-8")).hexdigest()[:10]


@dataclass(frozen=True)
class Applied:
    freed: int  # bytes
    failed: tuple[tuple[str, str], ...] = ()  # (archive-relative path, error) left on disk


# ---------------------------------------------------------------------------- inputs


def read_hidden(web: Path) -> set[str]:
    path = web / CURATION_FILE
    if not path.is_file():
        return set()
    data = json.loads(path.read_text(encoding="utf-8"))
    hidden = data.get("hidden", []) if isinstance(data, dict) else []
    return {str(i) for i in hidden if isinstance(i, str)}


def _packages_in(paths: Iterable[Path]) -> set[str]:
    found: set[str] = set()
    for path in paths:
        if path.is_file():
            found.update(FAB_PACKAGE.findall(path.read_text(encoding="utf-8", errors="replace")))
    return found


def _manifest_files(value: object) -> Iterator[str]:
    if isinstance(value, str):
        if ASSET_FILE.search(value) and "/" in value:
            yield value
    elif isinstance(value, Mapping):
        for item in value.values():
            yield from _manifest_files(item)
    elif isinstance(value, list):
        for item in value:
            yield from _manifest_files(item)


def unit_packages(archive: Path) -> dict[str, set[str]]:
    """Fab packages of every groom and outfit export unit on disk, by the id it converts
    to, whether it is converted yet or not."""
    found: dict[str, set[str]] = {}
    for unit in list_groom_units(archive):
        identifier = f"groom.{SLOTS[unit.parent.name]}.{unit.name}"
        found.setdefault(identifier, set()).update(_packages_in(unit.glob("*.json")))
    for outfit in list_outfit_units(archive):
        packages = _packages_in([outfit.folder / "outfit.json"])
        found.setdefault(f"outfit.{outfit.name}", set()).update(packages)
    return found


def catalogue(archive: Path) -> dict[str, Asset]:
    """Every asset the build stamps and the current manifest know of, by id. Stamps of
    kinds the curation never hides (bodies, lighting) still count, as kept references."""
    web = archive / "web"
    stamps = Stamps(archive)
    assets: dict[str, Asset] = {}

    def asset(identifier: str) -> Asset:
        return assets.setdefault(identifier, Asset(identifier))

    grooms = {unit.name: unit for unit in list_groom_units(archive)}
    outfits = {(unit.name, unit.gender): unit for unit in list_outfit_units(archive)}
    clips_root = archive / "raw" / "animations"
    clips: dict[str, Path] = {}
    for unit in list_clip_units(archive):
        try:
            kind = Clip.load(unit).kind
        except (OSError, ValueError, KeyError):
            continue
        clips[describe(unit.relative_to(clips_root), kind).file_stem] = unit

    def rel(path: Path) -> str:
        return path.relative_to(archive).as_posix()

    root = stamps.root
    for path in sorted(root.rglob("*.json")) if root.is_dir() else []:
        key = path.relative_to(root).with_suffix("").as_posix()
        data = stamps.read(key) or {}
        info = data.get("info", {}) if isinstance(data.get("info"), dict) else {}
        kind, _, rest = key.partition("/")
        if kind in ("faces", "skins", "irises"):
            prefix = {"faces": "face", "skins": "skin", "irises": "iris"}[kind]
            entry = asset(f"{prefix}.{rest}")
            entry.home = f"web/{kind}/{rest}"
            entry.sources.add(f"raw/characters/{rest}")
        elif kind == "grooms" and isinstance(info.get("groom"), dict):
            groom = info["groom"]
            entry = asset(str(groom["id"]))
            entry.home = "web/" + Path(str(groom.get("glb") or groom["painted"])).parent.as_posix()
            unit = grooms.get(rest.rsplit("/", 1)[-1])
            if unit is not None:
                entry.sources.add(rel(unit))
                entry.packages |= _packages_in(unit.glob("*.json"))
            else:
                entry.unresolved = True
        elif kind == "outfits" and isinstance(info.get("outfit"), dict):
            outfit = info["outfit"]
            entry = asset(str(outfit["id"]))
            entry.home = f"web/outfits/{outfit['name']}"
            unit = outfits.get((str(outfit["name"]), str(outfit["gender"])))
            if unit is not None:
                entry.sources.add(rel(unit.folder))
                entry.packages |= _packages_in([unit.folder / "outfit.json"])
            else:
                entry.unresolved = True
        elif kind == "animations" and isinstance(info.get("animation"), dict):
            entry = asset(str(info["animation"]["id"]))
            unit = clips.get(rest)
            if unit is not None:
                entry.sources.add(rel(unit))
        else:
            entry = asset(f"stamp:{key}")
        entry.stamps.add(key)
        entry.files.update(str(o) for o in data.get("outputs", []))

    manifest_path = web / "manifest.json"
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        for list_name in LISTS:
            for item in manifest.get(list_name, []):
                if not isinstance(item, Mapping) or "id" not in item:
                    continue
                entry = asset(str(item["id"]))
                for file in _manifest_files({k: v for k, v in item.items() if k != "id"}):
                    if (web / file).is_file():
                        entry.files.add(f"web/{file}")
    return assets


def _face_links(archive: Path) -> tuple[dict[str, str], dict[str, str]]:
    """(preset whose maps each face borrows, iris each face wears) from the stamps and
    the manifest, keyed by preset."""
    stamps = Stamps(archive)
    maps_from: dict[str, str] = {}
    root = stamps.root / "faces"
    for path in sorted(root.glob("*.json")) if root.is_dir() else []:
        source = stamps.info(f"faces/{path.stem}").get("maps_from")
        if isinstance(source, str) and source:
            maps_from[path.stem] = source
    irises: dict[str, str] = {}
    manifest_path = archive / "web" / "manifest.json"
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        for face in manifest.get("faces", []):
            if isinstance(face, Mapping) and face.get("defaultIris"):
                preset = str(face["id"]).removeprefix("face.")
                irises[preset] = str(face["defaultIris"])
    return maps_from, irises


# ---------------------------------------------------------------------------- plan


def _inside(path: str, folder: str) -> bool:
    return path == folder or path.startswith(folder.rstrip("/") + "/")


def _package_paths(archive: Path, names: Iterable[str]) -> list[str]:
    return sorted(
        p
        for name in names
        for p in (f"fab/{name}.mhpkg", f"fab/{name}", f"raw/fab_import/{name}")
        if (archive / p).exists()
    )


def unused_packages(
    archive: Path, assets: Mapping[str, Asset], exported: Iterable[str] = ()
) -> set[str]:
    """Packages in fab/ neither an asset nor an `exported` unit came from; none while any
    asset's package is unknown."""
    if any(a.unresolved for a in assets.values()):
        return set()
    used = {p for a in assets.values() for p in a.packages} | set(exported)
    folder = archive / "fab"
    names = {p.name.removesuffix(".mhpkg") for p in folder.iterdir()} if folder.is_dir() else set()
    return names - used


def plan_prune(archive: Path, hidden: Iterable[str], *, unused: bool = False) -> Plan:
    assets = catalogue(archive)
    pruned = {i for i in hidden if i in assets}
    unknown = sorted(set(hidden) - pruned - read_pruned(archive))
    maps_from, worn_irises = _face_links(archive)

    # A preset's iris goes with its face and skin unless a kept face wears it.
    for preset in {i.split(".", 1)[1] for i in pruned if i.startswith(("face.", "skin."))}:
        if f"face.{preset}" in pruned and f"skin.{preset}" in pruned:
            iris = f"iris.{preset}"
            wearers = [p for p, worn in worn_irises.items() if worn == iris]
            if iris in assets and all(f"face.{p}" in pruned for p in wearers):
                pruned.add(iris)

    kept = [a for i, a in assets.items() if i not in pruned]
    kept_files = {f for a in kept for f in a.files}
    kept_sources = {s for a in kept for s in a.sources}
    # An export unit not converted yet has no stamp, so only the unit names its package;
    # it still needs it (Unreal may be gone before it converts) unless its item is pruned.
    gone = pruned | read_pruned(archive)
    exported = {i: p for i, p in unit_packages(archive).items() if i not in gone}
    came_from: dict[str, set[str]] = {}
    for identifier, names in [*((a.id, a.packages) for a in kept), *exported.items()]:
        for package in names:
            came_from.setdefault(package, set()).add(identifier)
    notes: dict[str, str] = {}

    protected = {f"raw/characters/{FACE_REFERENCE}": "reference head for grooms and face clips"}
    for preset, source in maps_from.items():
        if f"face.{preset}" not in pruned:
            protected.setdefault(f"raw/characters/{source}", f"face.{preset} borrows its maps")

    folders: set[str] = set()
    files: set[str] = set()
    sources: set[str] = set()
    packages: set[str] = set()
    for identifier in sorted(pruned):
        entry = assets[identifier]
        if entry.home and not any(_inside(f, entry.home) for f in kept_files):
            folders.add(entry.home)
        files |= {f for f in entry.files if f not in kept_files}
        for source in entry.sources:
            if source in protected:
                notes[source] = protected[source]
            elif source in kept_sources:
                users = sorted(a.id for a in kept if source in a.sources)
                notes[source] = f"{', '.join(users)} still in the catalogue"
            else:
                sources.add(source)
        for package in entry.packages:
            if package in came_from:
                notes[f"fab/{package}"] = f"{', '.join(sorted(came_from[package]))} came from it"
            else:
                packages.add(package)

    files = {f for f in files if not any(_inside(f, d) for d in folders)}
    spare = unused_packages(archive, assets, (p for names in exported.values() for p in names))
    if unused:
        packages |= spare
    plan = Plan(
        archive=archive,
        ids=tuple(sorted(pruned)),
        files=tuple(sorted(f for f in files if (archive / f).is_file())),
        folders=tuple(sorted(d for d in folders if (archive / d).is_dir())),
        sources=tuple(sorted(s for s in sources if (archive / s).is_dir())),
        packages=tuple(_package_paths(archive, packages)),
        stamps=tuple(sorted(k for i in pruned for k in assets[i].stamps)),
        kept=tuple(sorted(notes.items())),
        unknown=tuple(unknown),
        unused=tuple(_package_paths(archive, spare)),
        unresolved=tuple(sorted(i for i, a in assets.items() if a.unresolved)),
    )
    for path in plan.paths:
        _check_target(archive, path)
    return plan


def _check_target(archive: Path, relative: str) -> None:
    """Only paths at least two levels inside the archive, and never through a link."""
    parts = Path(relative).parts
    if len(parts) < 2 or ".." in parts or Path(relative).is_absolute():
        raise PruneError(f"refusing to delete {relative!r}")
    target = archive / relative
    if target.resolve() != target.absolute() or not target.resolve().is_relative_to(
        archive.resolve()
    ):
        raise PruneError(f"refusing to delete {relative!r}: it leaves the archive")


# ---------------------------------------------------------------------------- apply


def size_of(path: Path) -> int:
    if path.is_file():
        return path.stat().st_size
    total = 0
    for folder, _, names in os.walk(path):
        for name in names:
            try:
                total += (Path(folder) / name).stat().st_size
            except OSError:
                continue
    return total


def apply_plan(plan: Plan) -> Applied:
    """Records the plan's ids, then deletes what it lists.

    The ids go to `raw/pruned.json` first, so an interrupted run still keeps the converter
    off them. A path that cannot be deleted does not stop the rest: it is collected in
    `failed`, and the plan's build stamps then stay so a rerun still lists what is left."""
    archive = plan.archive
    for relative in plan.paths:
        _check_target(archive, relative)
    record = archive / PRUNED_FILE
    ids = sorted(read_pruned(archive) | set(plan.ids))
    record.parent.mkdir(parents=True, exist_ok=True)
    temporary = record.with_suffix(".json.tmp")
    temporary.write_text(json.dumps({"ids": ids}, indent=2) + "\n", encoding="utf-8")
    temporary.replace(record)

    failed: list[tuple[str, str]] = []

    def note(_function: object, path: str | Path, error: BaseException) -> None:
        relative = Path(path).relative_to(archive).as_posix()
        # A folder that keeps a file it could not delete fails too; the file says why.
        if not any(_inside(f, relative) for f, _ in failed):
            failed.append((relative, str(error)))

    freed = 0
    for relative in plan.paths:
        target = archive / relative
        if not target.exists():
            continue
        size = size_of(target)
        if target.is_dir():
            shutil.rmtree(target, onexc=note)
        else:
            try:
                target.unlink()
            except OSError as error:
                note(None, target, error)
        freed += size - (size_of(target) if target.exists() else 0)
    if not failed:
        stamps = Stamps(archive)
        for key in plan.stamps:
            stamps.root.joinpath(f"{key}.json").unlink(missing_ok=True)
    return Applied(freed, tuple(failed))


# ---------------------------------------------------------------------------- report


def _gb(size: int) -> str:
    return f"{size / 1e9:6.2f} GB"


def report(plan: Plan, *, verbose: bool = False) -> list[str]:
    archive = plan.archive
    groups = {
        "web": (*plan.files, *plan.folders),
        "unreal": plan.sources,
        "fab": plan.packages,
    }
    lines = [f"{len(plan.ids)} assets to prune: {', '.join(plan.ids) or '-'}"]
    total = 0
    for name, paths in groups.items():
        size = sum(size_of(archive / p) for p in paths)
        total += size
        lines.append(f"  {name:7s} {len(paths):5d} paths  {_gb(size)}")
        if verbose or name != "web":
            lines += [f"          {p}" for p in paths]
    lines.append(f"  {'total':7s} {'':11s} {_gb(total)}")
    if plan.kept:
        lines.append("kept:")
        lines += [f"  {path}  ({why})" for path, why in plan.kept]
    spare = [p for p in plan.unused if p not in plan.packages]
    if spare:
        size = sum(size_of(archive / p) for p in spare)
        lines.append(f"unused Fab packages ({_gb(size).strip()}; --unused-packages deletes):")
        lines += [f"  {p}" for p in spare]
    if plan.unresolved:
        lines.append(
            "export units missing (an export may be running), so no Fab package counts as "
            f"unused: {', '.join(plan.unresolved)}"
        )
    if plan.unknown:
        lines.append(f"not in the catalogue (ignored): {', '.join(plan.unknown)}")
    return lines


# ---------------------------------------------------------------------------- CLI


def add_parser(subparsers: "argparse._SubParsersAction[argparse.ArgumentParser]") -> None:
    parser = subparsers.add_parser(
        COMMAND, help="Delete curated-out assets (web, Unreal exports, Fab packages)"
    )
    parser.add_argument("--archive", type=Path, help="MetaHumanArchive root (default: $MH_ARCHIVE)")
    parser.add_argument("--apply", action="store_true", help="delete (default: dry run)")
    parser.add_argument(
        "--plan", metavar="DIGEST", help="digest the dry run printed; --apply requires it"
    )
    parser.add_argument(
        "--unused-packages",
        action="store_true",
        help="also delete Fab packages nothing in the catalogue came from",
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="list every web file")


def run(args: argparse.Namespace) -> int:
    archive = args.archive or archive_root()
    hidden = read_hidden(archive / "web")
    if not hidden and not args.unused_packages:
        print(f"nothing hidden in {archive / 'web' / CURATION_FILE}")
        return 0
    plan = plan_prune(archive, hidden, unused=args.unused_packages)
    print("\n".join(report(plan, verbose=args.verbose)))
    if not plan.paths:
        return 0
    if not args.apply:
        print(f"dry run, plan {plan.digest}: rerun with --apply --plan {plan.digest} to delete")
        return 0
    if args.plan != plan.digest:
        print(
            f"refusing to delete: plan is {plan.digest}, not {args.plan!r}; review the plan "
            f"above and rerun with --apply --plan {plan.digest}",
            file=sys.stderr,
        )
        return 2
    applied = Applied(0)
    try:
        applied = apply_plan(plan)
        print(f"deleted {len(plan.paths)} paths, freed {applied.freed / 1e9:.2f} GB")
        for path, error in applied.failed:
            print(f"not deleted: {path} ({error})", file=sys.stderr)
        if applied.failed:
            print(
                f"{len(applied.failed)} files or folders not deleted (in use?); the build "
                "stamps stay: close what holds them and rerun mh-prune",
                file=sys.stderr,
            )
    finally:
        # The ids are recorded before anything is deleted, so the manifest drops them
        # even when the deletion stopped halfway.
        rebuilt = _rebuild_manifest(archive)
    return 0 if rebuilt and not applied.failed else 1


def _rebuild_manifest(archive: Path) -> bool:
    try:
        path = Builder(archive).manifest()
    except ManifestError as error:
        print(f"manifest not rebuilt: {error}", file=sys.stderr)
        return False
    print(f"manifest rebuilt: {path}")
    return True


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="asset-pipeline")
    add_parser(parser.add_subparsers(dest="command", required=True))
    return run(parser.parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
