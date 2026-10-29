"""`mh-convert` command: MetaHumanArchive raw exports -> web assets and manifest v2.

Standalone: `uv run --no-sync python -m asset_pipeline.mh mh-convert --all`. Registered as
`asset-pipeline mh-convert` by `asset_pipeline/cli.py` (`add_parser(sub)`, `run(args)`).

Everything is incremental (see `build.py`): re-running converts only new or changed units.
"""

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

from asset_pipeline.mh.build import Builder
from asset_pipeline.mh.convert import archive_root, write_ready_note
from asset_pipeline.mh.manifest import ManifestError, validate_with_zod

COMMAND = "mh-convert"
GENDERS = ("female", "male")
PARTS = ("heads", "skins", "irises")


def add_parser(
    subparsers: "argparse._SubParsersAction[argparse.ArgumentParser]",
) -> argparse.ArgumentParser:
    parser = subparsers.add_parser(
        COMMAND, help="Convert archived MetaHuman exports to web assets and the manifest"
    )
    parser.add_argument(
        "--character", action="append", default=[], help="preset name (repeatable, or 'all')"
    )
    parser.add_argument(
        "--parts",
        default=",".join(PARTS),
        help=f"per-preset outputs to build, comma separated (default: {','.join(PARTS)})",
    )
    parser.add_argument("--bodies", action="store_true", help="convert the body basis GLBs")
    parser.add_argument("--gender", choices=GENDERS, action="append", help="bodies to convert")
    parser.add_argument("--animations", action="store_true", help="convert animation clips")
    parser.add_argument("--clip", action="append", default=[], help="only these clip ids")
    parser.add_argument("--lighting", action="store_true", help="convert lighting rigs")
    parser.add_argument("--grooms", action="store_true", help="convert groom cards")
    parser.add_argument("--groom", action="append", default=[], help="only these groom styles")
    parser.add_argument(
        "--outfits", action="store_true", help="refit outfit garments onto the bodies"
    )
    parser.add_argument("--outfit", action="append", default=[], help="only these outfit names")
    parser.add_argument("--manifest", action="store_true", help="write web/manifest.json")
    parser.add_argument("--all", action="store_true", help="everything above, then the manifest")
    parser.add_argument("--force", action="store_true", help="rebuild even when up to date")
    parser.add_argument(
        "--no-compress", action="store_true", help="plain float GLBs (no quantization/meshopt)"
    )
    parser.add_argument("--archive", type=Path, help="MetaHumanArchive root (default: $MH_ARCHIVE)")
    return parser


def run(args: argparse.Namespace) -> int:
    archive = args.archive or archive_root()
    builder = Builder(archive, force=args.force, compress=not args.no_compress)
    everything = args.all
    characters = ["all"] if everything and not args.character else args.character
    parts = {part.strip() for part in args.parts.split(",") if part.strip()}
    unknown = parts - set(PARTS)
    if unknown:
        print(f"unknown --parts {sorted(unknown)}", file=sys.stderr)
        return 2
    selected = any(
        [
            characters,
            args.bodies,
            args.animations,
            args.lighting,
            args.grooms,
            args.outfits,
            args.manifest,
        ]
    )
    if not selected and not everything:
        print("nothing to do: pass --all or --character/--bodies/--animations/...", file=sys.stderr)
        return 2

    for name in builder.characters(characters) if characters else []:
        # Maps first: the head GLB references the teeth and eyelash maps it writes itself,
        # and the manifest needs the skin's tone to pick stand-ins.
        if "skins" in parts:
            builder.skin(name)
        if "irises" in parts:
            builder.iris(name)
        if "heads" in parts:
            builder.head(name)
    if args.bodies or everything:
        for gender in args.gender or GENDERS:
            builder.body(gender)
            builder.body_socks(gender)
    if args.animations or everything:
        builder.animations(args.clip)
    if args.lighting or everything:
        builder.lighting()
    if args.grooms or everything:
        builder.grooms(args.groom)
    if args.outfits or everything:
        builder.outfits(args.outfit)
    if args.manifest or everything:
        try:
            path = builder.manifest()
        except ManifestError as error:
            print(f"manifest not written: {error}", file=sys.stderr)
            return 1
        try:
            issues = validate_with_zod(path)
        except FileNotFoundError:
            print("note: zod check skipped (node or the web app not installed)")
        else:
            if issues:
                print(f"manifest fails the web schema:\n{issues}", file=sys.stderr)
                return 1
            print("manifest passes the web zod schema")
    if any(o.status == "built" for o in builder.outcomes):
        print(f"note: {write_ready_note(archive)}")
    failed = [o for o in builder.outcomes if o.status == "failed"]
    built = sum(o.status == "built" for o in builder.outcomes)
    skipped = sum(o.status == "skipped" for o in builder.outcomes)
    print(f"done: {built} built, {skipped} up to date, {len(failed)} failed")
    return 1 if failed and not built and not skipped else 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m asset_pipeline.mh")
    add_parser(parser.add_subparsers(dest="command", required=True))
    return run(parser.parse_args(argv))
