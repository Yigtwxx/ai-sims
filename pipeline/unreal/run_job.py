"""Editor entry point: `UnrealEditor.exe <project> -ExecutePythonScript=<this file>`.

The launcher (`uv run asset-pipeline ue <job>`) passes everything through the
environment so no quoting survives the Windows command line:

- MH_JOB: job name (see mh_export.jobs)
- MH_JOB_ARGS: JSON object with job options
- MH_ARCHIVE: archive root
- MH_RESULT: path the job result JSON is written to
- MH_QUIT: "1" closes the editor when the job ends
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from pathlib import Path

sys.path.insert(0, os.environ.get("MH_SCRIPTS_DIR", str(Path(__file__).resolve().parent)))

import unreal

from mh_export import jobs
from mh_export.archive import Archive, default_root, now_iso, write_json


def main() -> None:
    job = os.environ["MH_JOB"]
    args = json.loads(os.environ.get("MH_JOB_ARGS", "{}"))
    archive = Archive(default_root())
    result_path = Path(os.environ.get("MH_RESULT", str(archive.logs / f"{job}-result.json")))
    result: dict[str, object] = {"job": job, "args": args, "started_at": now_iso()}
    try:
        result["result"] = jobs.get(job)(archive, args)
        result["ok"] = True
    except Exception as exc:
        result["ok"] = False
        result["error"] = f"{type(exc).__name__}: {exc}"
        result["trace"] = traceback.format_exc(limit=12)
        unreal.log_error(f"[mh_export] {job} failed: {result['error']}")
    result["finished_at"] = now_iso()
    write_json(result_path, result)
    if os.environ.get("MH_QUIT") == "1":
        unreal.SystemLibrary.quit_editor()


main()
