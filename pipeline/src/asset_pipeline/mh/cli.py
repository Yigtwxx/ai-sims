"""`mh-convert` command: MetaHumanArchive raw exports -> web GLBs.

Standalone: `uv run --no-sync python -m asset_pipeline.mh mh-convert --character Ada`.
To expose it as `asset-pipeline mh-convert`, `asset_pipeline/cli.py` registers it with
`add_parser(sub)` and dispatches `args.command == "mh-convert"` to `run(args)`.
"""

import argparse
import sys
import time
from collections.abc import Sequence
from pathlib import Path

from asset_pipeline.mh.convert import (
    ConversionError,
    archive_root,
    convert_body,
    convert_head,
    write_ready_note,
)
from asset_pipeline.mh.gltf import GlbStats

COMMAND = "mh-convert"
GENDERS = ("female", "male")


def add_parser(
    subparsers: "argparse._SubParsersAction[argparse.ArgumentParser]",
) -> argparse.ArgumentParser:
    parser = subparsers.add_parser(COMMAND, help="Convert archived MetaHuman exports to web GLBs")
    parser.add_argument(
        "--character", action="append", default=[], help="character name (repeatable, or 'all')"
    )
    parser.add_argument("--bodies", action="store_true", help="convert the body basis GLBs")
    parser.add_argument("--gender", choices=GENDERS, action="append", help="bodies to convert")
    parser.add_argument("--archive", type=Path, help="MetaHumanArchive root (default: $MH_ARCHIVE)")
    parser.add_argument("--mapping", type=Path, help="ARKit mapping JSON (default: raw/arkit/)")
    parser.add_argument("--skin-from", help="character whose body maps the body GLB references")
    return parser


def _characters(archive: Path, requested: Sequence[str]) -> list[str]:
    if "all" not in requested:
        return list(requested)
    root = archive / "raw" / "characters"
    return sorted(p.name for p in root.iterdir() if (p / "done.json").is_file())


def _report(stats: GlbStats, seconds: float) -> None:
    print(f"{stats.path}  {stats.size / 1e6:.1f} MB  {len(stats.targets)} targets  {seconds:.1f}s")
    for kind, primitive in stats.primitives.items():
        print(
            f"  {kind:10s} {primitive.vertices:6d} vertices {primitive.triangles:6d} triangles "
            f"{primitive.targets_with_data:3d} targets with data, dropped weight <= "
            f"{primitive.max_dropped_weight:.3f}"
        )


def run(args: argparse.Namespace) -> int:
    archive = args.archive or archive_root()
    if not args.character and not args.bodies:
        print("nothing to do: pass --character NAME and/or --bodies", file=sys.stderr)
        return 2
    results: list[GlbStats] = []
    failures = 0
    jobs = [("head", name) for name in _characters(archive, args.character)]
    if args.bodies:
        jobs += [("body", gender) for gender in (args.gender or GENDERS)]
    for kind, name in jobs:
        started = time.perf_counter()
        try:
            if kind == "head":
                stats = convert_head(name, archive, mapping_path=args.mapping)
            else:
                stats = convert_body(name, archive, skin_from=args.skin_from)
        except ConversionError as error:
            failures += 1
            print(f"skipped {kind} {name}: {error}", file=sys.stderr)
            continue
        results.append(stats)
        _report(stats, time.perf_counter() - started)
    if results:
        print(f"note: {write_ready_note(archive)}")
    return 1 if failures and not results else 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m asset_pipeline.mh")
    add_parser(parser.add_subparsers(dest="command", required=True))
    return run(parser.parse_args(argv))
