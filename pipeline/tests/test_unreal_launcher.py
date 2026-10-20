import json
from pathlib import Path

from asset_pipeline.unreal import UNREAL_SCRIPTS, UnrealPaths, build_command, job_env


def _paths() -> UnrealPaths:
    return UnrealPaths(
        editor=Path("C:/UE/Engine/Binaries/Win64/UnrealEditor.exe"),
        project=Path("C:/Projects/AISimsExport/AISimsExport.uproject"),
        archive=Path("C:/Archive"),
    )


def test_build_command_runs_the_job_entry_script_in_the_project():
    cmd = build_command(_paths())
    assert cmd[0].endswith("UnrealEditor.exe")
    assert cmd[1].endswith("AISimsExport.uproject")
    assert f"-ExecutePythonScript={(UNREAL_SCRIPTS / 'run_job.py').as_posix()}" in cmd


def test_job_env_passes_options_as_json_and_quit_flag():
    env = job_env(
        _paths(), "arkit", {"force": True}, Path("C:/Archive/logs/r.json"), quit_after=False
    )
    assert env["MH_JOB"] == "arkit"
    assert json.loads(env["MH_JOB_ARGS"]) == {"force": True}
    assert env["MH_QUIT"] == "0"
    assert Path(env["MH_SCRIPTS_DIR"]) == UNREAL_SCRIPTS
    assert Path(env["MH_ARCHIVE"]) == Path("C:/Archive")
