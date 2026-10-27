"""Command-line entry point: `uv run asset-pipeline <command>`."""

import argparse
import json


def main(argv: list[str] | None = None) -> None:
    from asset_pipeline import transfer
    from asset_pipeline.garments import cli as garment_cli
    from asset_pipeline.mh import cli as mh_cli
    from asset_pipeline.mh import prune, similar

    parser = argparse.ArgumentParser(prog="asset-pipeline")
    sub = parser.add_subparsers(dest="command", required=True)

    ue = sub.add_parser("ue", help="Run a MetaHuman export job inside Unreal Editor (Windows)")
    ue.add_argument("job", help="Job name from pipeline/unreal/mh_export/jobs.py")
    ue.add_argument("--args", default="{}", help="Job options as a JSON object")
    ue.add_argument("--keep-open", action="store_true", help="Leave the editor open afterwards")
    mh_cli.add_parser(sub)
    prune.add_parser(sub)
    similar.add_parser(sub)
    transfer.add_parser(sub)
    garment_cli.add_parser(sub)
    ue.add_argument(
        "--until-done",
        action="store_true",
        help="Relaunch the editor while the job reports deferred units (use with a 'limit' arg)",
    )

    args = parser.parse_args(argv)

    if args.command == mh_cli.COMMAND:
        raise SystemExit(mh_cli.run(args))
    elif args.command == prune.COMMAND:
        raise SystemExit(prune.run(args))
    elif args.command == similar.COMMAND:
        raise SystemExit(similar.run(args))
    elif args.command == garment_cli.COMMAND:
        raise SystemExit(garment_cli.run(args))
    elif args.command == "serve-slim":
        raise SystemExit(transfer.run(args))
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
