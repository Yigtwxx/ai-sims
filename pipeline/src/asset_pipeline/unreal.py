"""Launch MetaHuman export jobs inside Unreal Editor (Windows, one-time use).

Jobs live in `pipeline/unreal/mh_export` and run in the editor's embedded Python.
The editor is started with `-ExecutePythonScript` and closes itself when the job
ends; the job's progress goes to `<archive>/logs/*.jsonl` and its result to a JSON
file this module reads back.
"""

import json
import os
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

from asset_pipeline.config import PIPELINE_ROOT

_DEFAULT_UE_ROOT = r"C:\Program Files\Epic Games\UE_5.8"
_DEFAULT_PROJECT = (
    Path.home() / "Documents" / "Unreal Projects" / "AISimsExport" / "AISimsExport.uproject"
)
UNREAL_SCRIPTS = PIPELINE_ROOT / "unreal"


class UnrealError(RuntimeError):
    """Raised when the editor is missing or a job reports failure."""


@dataclass(frozen=True)
class UnrealPaths:
    editor: Path
    project: Path
    archive: Path

    @staticmethod
    def load() -> "UnrealPaths":
        ue_root = Path(os.environ.get("UE_ROOT", _DEFAULT_UE_ROOT))
        return UnrealPaths(
            editor=ue_root / "Engine" / "Binaries" / "Win64" / "UnrealEditor.exe",
            project=Path(os.environ.get("UE_PROJECT", str(_DEFAULT_PROJECT))),
            archive=Path(os.environ.get("MH_ARCHIVE", str(Path.home() / "MetaHumanArchive"))),
        )


def job_env(
    paths: UnrealPaths, job: str, args: dict[str, object], result: Path, quit_after: bool
) -> dict[str, str]:
    """Environment the editor-side `run_job.py` reads its instructions from."""
    return {
        "MH_JOB": job,
        "MH_JOB_ARGS": json.dumps(args),
        "MH_ARCHIVE": str(paths.archive),
        "MH_RESULT": str(result),
        "MH_SCRIPTS_DIR": str(UNREAL_SCRIPTS),
        "MH_QUIT": "1" if quit_after else "0",
    }


def build_command(paths: UnrealPaths) -> list[str]:
    script = (UNREAL_SCRIPTS / "run_job.py").as_posix()
    return [str(paths.editor), str(paths.project), f"-ExecutePythonScript={script}", "-nosplash"]


def run_job(
    job: str, args: dict[str, object] | None = None, *, quit_after: bool = True
) -> dict[str, object]:
    """Run one job in a fresh editor process and return its result record."""
    paths = UnrealPaths.load()
    for required in (paths.editor, paths.project):
        if not required.exists():
            raise UnrealError(f"Not found: {required} (set UE_ROOT / UE_PROJECT)")
    stamp = time.strftime("%Y%m%dT%H%M%S")
    result_path = paths.archive / "logs" / f"{job}-{stamp}-result.json"
    env = {**os.environ, **job_env(paths, job, args or {}, result_path, quit_after)}
    completed = subprocess.run(build_command(paths), env=env, check=False)
    if not result_path.is_file():
        raise UnrealError(
            f"Editor exited with {completed.returncode} before job {job!r} wrote a result"
        )
    result = json.loads(result_path.read_text(encoding="utf-8"))
    if not result.get("ok"):
        raise UnrealError(f"Job {job!r} failed: {result.get('error')}")
    return result
