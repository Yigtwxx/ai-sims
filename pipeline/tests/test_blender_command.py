from pathlib import Path

from asset_pipeline.blender import build_command
from asset_pipeline.config import Paths


def _paths() -> Paths:
    return Paths(
        blender_bin=Path("/bin/blender"),
        blender_scripts=Path("/repo/pipeline/blender_scripts"),
        out_dir=Path("/repo/pipeline/out"),
        web_assets=Path("/repo/web/public/assets"),
    )


def test_build_command_passes_script_args_after_separator():
    cmd = build_command(_paths(), "build_base.py", ["--gender", "male"])
    assert cmd[0] == "/bin/blender"
    assert "--background" in cmd
    sep = cmd.index("--")
    assert cmd[sep - 1] == "/repo/pipeline/blender_scripts/build_base.py"
    assert cmd[sep + 1 :] == ["--gender", "male"]


def test_build_command_fails_fast_on_python_errors():
    cmd = build_command(_paths(), "x.py", [])
    assert cmd[cmd.index("--python-exit-code") + 1] == "1"
