"""Command-line entry point: `uv run asset-pipeline <command>`."""

import argparse
import json
from pathlib import Path

from asset_pipeline.blender import run_blender
from asset_pipeline.config import Paths, load_paths
from asset_pipeline.manifest import write_manifest
from asset_pipeline.packs import PACKS, install, mpfb_data_dir


def _write_vrm_manifest(paths: Paths) -> None:
    vrm_dir = paths.web_assets / "vrm"
    manifest = write_manifest(
        vrm_dir / "parts",
        paths.blender_scripts.parent / "vroid_sources.json",
        vrm_dir / "manifest.json",
    )
    print(f"manifest: {len(manifest['bases'])} bases, {len(manifest['parts'])} parts")


def main(argv: list[str] | None = None) -> None:
    from asset_pipeline.mh import cli as mh_cli

    parser = argparse.ArgumentParser(prog="asset-pipeline")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("packs", help="Download and install MPFB asset packs (idempotent)")

    split = sub.add_parser("split-vrm", help="Split VRoid VRMs into per-category part VRMs")
    split.add_argument(
        "inputs", nargs="*", type=Path, help="VRM files (default: source/vroid/*.vrm)"
    )

    sub.add_parser("manifest", help="Rebuild web/public/assets/vrm/manifest.json from split parts")

    base = sub.add_parser("base", help="Generate base human GLB(s) with MPFB")
    base.add_argument("--gender", choices=["male", "female", "all"], default="all")

    ue = sub.add_parser("ue", help="Run a MetaHuman export job inside Unreal Editor (Windows)")
    ue.add_argument("job", help="Job name from pipeline/unreal/mh_export/jobs.py")
    ue.add_argument("--args", default="{}", help="Job options as a JSON object")
    ue.add_argument("--keep-open", action="store_true", help="Leave the editor open afterwards")
    mh_cli.add_parser(sub)
    ue.add_argument(
        "--until-done",
        action="store_true",
        help="Relaunch the editor while the job reports deferred units (use with a 'limit' arg)",
    )

    args = parser.parse_args(argv)
    paths = load_paths()
    paths.out_dir.mkdir(parents=True, exist_ok=True)

    if args.command == "packs":
        cache = paths.out_dir.parent / "cache" / "packs"
        for pack in PACKS:
            installed = install(pack, cache, mpfb_data_dir())
            print(f"{pack.name}: {'installed' if installed else 'already installed'}")
    elif args.command == "split-vrm":
        inputs = args.inputs or sorted(
            (paths.blender_scripts.parent / "source" / "vroid").glob("*.vrm")
        )
        if not inputs:
            parser.error("no VRM files given and source/vroid/ is empty")
        out_dir = paths.web_assets / "vrm" / "parts"
        # VRM licenses would otherwise pop a confirmation dialog in headless runs.
        env = {"BLENDER_VRM_AUTOMATIC_LICENSE_CONFIRMATION": "true"}
        for vrm in inputs:
            run_blender(
                paths,
                "split_vrm.py",
                ["--input", str(vrm.resolve()), "--out-dir", str(out_dir)],
                extra_env=env,
            )
        _write_vrm_manifest(paths)
    elif args.command == "manifest":
        _write_vrm_manifest(paths)
    elif args.command == mh_cli.COMMAND:
        raise SystemExit(mh_cli.run(args))
    elif args.command == "ue":
        from asset_pipeline.unreal import run_job

        job_args = json.loads(args.args)
        while True:
            result = run_job(args.job, job_args, quit_after=not args.keep_open)
            print(json.dumps(result.get("result"), indent=2), flush=True)
            report = result.get("result") or {}
            progressed = bool(report.get("done") or report.get("failed"))
            if not (args.until_done and report.get("deferred") and progressed):
                break
    elif args.command == "base":
        genders = ["male", "female"] if args.gender == "all" else [args.gender]
        for gender in genders:
            out_file = paths.out_dir / f"base_{gender}.glb"
            run_blender(paths, "build_base.py", ["--gender", gender, "--out", str(out_file)])
