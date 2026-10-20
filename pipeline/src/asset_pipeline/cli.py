"""Command-line entry point: `uv run asset-pipeline <command>`."""

import argparse

from asset_pipeline.blender import run_blender
from asset_pipeline.config import load_paths


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="asset-pipeline")
    sub = parser.add_subparsers(dest="command", required=True)

    base = sub.add_parser("base", help="Generate base human GLB(s) with MPFB")
    base.add_argument("--gender", choices=["male", "female", "all"], default="all")

    args = parser.parse_args(argv)
    paths = load_paths()
    paths.out_dir.mkdir(parents=True, exist_ok=True)

    if args.command == "base":
        genders = ["male", "female"] if args.gender == "all" else [args.gender]
        for gender in genders:
            out_file = paths.out_dir / f"base_{gender}.glb"
            run_blender(paths, "build_base.py", ["--gender", gender, "--out", str(out_file)])
